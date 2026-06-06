import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { Chat, ChatInterface, FinishReason, ToolCall } from './chat.js';
import { ChunkStream, ChunkStreamInterface } from './stream.js';
import { ToolSuite, ToolSuiteInterface } from '../tools/suite.js';

/** Discriminant for stream event types yielded by a {@link ChatService}. */
export enum StreamEventType {
    Content = 'content',
    ToolCallDelta = 'tool_call_delta',
    Finish = 'finish',
    Reasoning = 'reasoning'
}

/** A single event yielded by a service's internal stream iterator. */
export type StreamEvent =
    | { type: StreamEventType.Content; text: string }
    | {
          type: StreamEventType.ToolCallDelta;
          index: number;
          id?: string;
          name?: string;
          arguments?: string;
      }
    | { type: StreamEventType.Finish; reason: FinishReason }
    | { type: StreamEventType.Reasoning; text: string };

/** Configuration for a {@link ChatService}. All fields can be set via environment variables. */
export class ChatServiceConfiguration {
    /** Maximum number of tool-call rounds before the loop is interrupted (env: `LLM_CHAT_MAX_TOOL_CALL_ROUNDS`, default: 10). */
    maxToolCallRounds: number = (() => {
        const raw = process.env.LLM_CHAT_MAX_TOOL_CALL_ROUNDS;
        if (raw === undefined || raw === '') return 10;
        const parsed = parseInt(raw, 10);
        return isNaN(parsed) ? 10 : parsed;
    })();
    /** Path to a file whose contents are loaded as the system prompt (env: `LLM_CHAT_SYSTEM_PROMPT`). */
    systemPromptPath: string = process.env.LLM_CHAT_SYSTEM_PROMPT ?? '';
    /** Comma-separated paths to files whose contents are loaded as user messages (env: `LLM_CHAT_USER_PROMPTS`). */
    userPromptPaths: string[] = (process.env.LLM_CHAT_USER_PROMPTS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Base class for LLM service providers. Handles the tool-call loop, prompt file loading, and concurrency. */
export abstract class ChatService {
    private _contextLoaded = false;
    private _sendMutex = new Mutex();
    private _chunkStream = new ChunkStream();
    /** The underlying chat instance. Access to read/write messages directly. */
    public readonly chatImpl: Chat = new Chat();
    /** Internal tool registry. */
    protected _tools = new ToolSuite();

    protected constructor(
        private config: ChatServiceConfiguration = new ChatServiceConfiguration()
    ) {}

    /** Access the tool registry to register tools before calling {@link send}. */
    tools(): ToolSuiteInterface {
        return this._tools;
    }

    /** Access the chat interface to build message history. */
    chat(): ChatInterface {
        return this.chatImpl;
    }

    /** Access the chunk stream produced by the last {@link send} call. */
    stream(): ChunkStreamInterface {
        return this._chunkStream;
    }

    protected abstract createStream(): AsyncIterable<StreamEvent>;

    private async _send(): Promise<void> {
        this._chunkStream.clear();
        if (
            !this._contextLoaded &&
            (this.config.systemPromptPath || this.config.userPromptPaths.length > 0)
        ) {
            await this.loadPromptFiles();
            this._contextLoaded = true;
        }
        await this.sendLoop(0);
    }

    /** Send the current chat to the provider and process the response (mutex-guarded). */
    async send(): Promise<void> {
        await this._sendMutex.runExclusive(() => this._send());
    }

    /**
     * Atomically run a mutation (e.g. inject a message) and optionally re-send.
     * @param fn        - Function that mutates chat state (runs under the send mutex).
     * @param sendAfter - Whether to re-send after the mutation (default: `true`).
     */
    async interrupt(fn: () => void | Promise<void>, sendAfter?: boolean): Promise<void> {
        await this._sendMutex.runExclusive(async () => {
            await fn();
            if (sendAfter !== false) {
                await this._send();
            }
        });
    }

    private async loadPromptFiles(): Promise<void> {
        if (this.config.systemPromptPath) {
            const absPath = path.resolve(process.cwd(), this.config.systemPromptPath);
            try {
                const content = await readFile(absPath, 'utf-8');
                this.chatImpl.system(content);
            } catch {
                console.warn(`Failed to load system prompt file: ${absPath}`);
            }
        }
        for (const relPath of this.config.userPromptPaths) {
            const absPath = path.resolve(process.cwd(), relPath);
            try {
                const content = await readFile(absPath, 'utf-8');
                this.chatImpl.user(content);
            } catch {
                console.warn(`Failed to load user prompt file: ${absPath}`);
            }
        }
    }

    private async sendLoop(iteration: number): Promise<void> {
        let content = '';
        let reasoningContent = '';
        const toolCallAccumulators = new Map<
            number,
            {
                id: string;
                name: string;
                arguments: string;
            }
        >();

        for await (const event of this.createStream()) {
            switch (event.type) {
                case StreamEventType.Content:
                    content += event.text;
                    this._chunkStream.addContentChunk(event.text);
                    break;

                case StreamEventType.ToolCallDelta:
                    this.accumulateToolCall(toolCallAccumulators, event);
                    this._chunkStream.addToolCallDeltaChunk(
                        event.arguments || '',
                        event.index,
                        event.id,
                        event.name
                    );
                    break;

                case StreamEventType.Finish:
                    this._chunkStream.addFinishChunk(event.reason);
                    await this.handleFinish(
                        content,
                        reasoningContent,
                        toolCallAccumulators,
                        event.reason,
                        iteration
                    );
                    return;

                case StreamEventType.Reasoning:
                    reasoningContent += event.text;
                    this._chunkStream.addReasoningChunk(event.text);
                    break;
            }
        }

        // Stream ended without an explicit Finish event
        const hasToolCalls = toolCallAccumulators.size > 0;
        if (content || reasoningContent || hasToolCalls) {
            const reason = hasToolCalls ? FinishReason.ToolCalls : FinishReason.Stop;
            this._chunkStream.addFinishChunk(reason, true);
            await this.handleFinish(
                content,
                reasoningContent,
                toolCallAccumulators,
                reason,
                iteration
            );
        }
    }

    private accumulateToolCall(
        accs: Map<number, { id: string; name: string; arguments: string }>,
        event: { index: number; id?: string; name?: string; arguments?: string }
    ): void {
        let acc = accs.get(event.index);
        if (!acc) {
            acc = { id: '', name: '', arguments: '' };
            accs.set(event.index, acc);
        }
        if (event.id) acc.id += event.id;
        if (event.name) acc.name += event.name;
        if (event.arguments) acc.arguments += event.arguments;
    }

    private async handleFinish(
        content: string,
        reasoningContent: string,
        toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }>,
        reason: FinishReason,
        iteration: number
    ): Promise<void> {
        // Ordering guarantee: FinishChunk was already pushed to _chunkStream before this call.
        // Stream hooks fired. Now append completed messages to chat.

        if (reasoningContent) {
            this.chatImpl.reasoning(reasoningContent);
        }

        if (reason === FinishReason.Stop || reason === FinishReason.Length) {
            if (content) {
                this.chatImpl.assistant(content);
            }
            return;
        }

        if (reason === FinishReason.ToolCalls) {
            if (iteration >= this.config.maxToolCallRounds) {
                this.chatImpl.assistant(content);
                this.chatImpl.user(
                    'Your tool call loop was interrupted after reaching the maximum number of rounds. Please summarize your progress so far and continue without further tool calls.'
                );
                await this.sendLoop(iteration + 1);
                return;
            }

            const toolCalls: ToolCall[] = [];
            for (const acc of toolCallAccumulators.values()) {
                toolCalls.push({
                    id: acc.id,
                    type: 'function',
                    function: { name: acc.name, arguments: acc.arguments }
                });
            }

            this.chatImpl.assistant(content, toolCalls);

            for (const tc of toolCalls) {
                const result = await this._tools.executeTool(
                    tc.function.name,
                    tc.function.arguments
                );
                this.chatImpl.tool(result.result, tc.id);
            }

            await this.sendLoop(iteration + 1);
        }
    }
}
