import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { Chat, ChatInterface, FinishReason, ToolCall } from './chat.js';
import { ToolSuite, ToolSuiteInterface } from '../tools/suite.js';

export enum StreamEventType {
    Content = 'content',
    ToolCallDelta = 'tool_call_delta',
    Finish = 'finish',
    Reasoning = 'reasoning'
}

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

export class ChatServiceConfiguration {
    maxToolCallRounds: number = (() => {
        const raw = process.env.LLM_CHAT_MAX_TOOL_CALL_ROUNDS;
        if (raw === undefined || raw === '') return 10;
        const parsed = parseInt(raw, 10);
        return isNaN(parsed) ? 10 : parsed;
    })();
    systemPromptPath: string = process.env.LLM_CHAT_SYSTEM_PROMPT ?? '';
    userPromptPaths: string[] = (process.env.LLM_CHAT_USER_PROMPTS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

export abstract class ChatService {
    private _contextLoaded = false;
    private _sendMutex = new Mutex();
    public readonly chatImpl: Chat = new Chat();
    protected _tools = new ToolSuite();

    protected constructor(
        private config: ChatServiceConfiguration = new ChatServiceConfiguration()
    ) {}

    tools(): ToolSuiteInterface {
        return this._tools;
    }

    /** Returns the public-facing chat handle with a narrowed API. */
    chat(): ChatInterface {
        return this.chatImpl;
    }

    protected abstract createStream(): AsyncIterable<StreamEvent>;

    private async _send(): Promise<void> {
        if (
            !this._contextLoaded &&
            (this.config.systemPromptPath || this.config.userPromptPaths.length > 0)
        ) {
            await this.loadPromptFiles();
            this._contextLoaded = true;
        }
        await this.sendLoop(0);
    }

    async send(): Promise<void> {
        await this._sendMutex.runExclusive(() => this._send());
    }

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
                    this.chatImpl.chunk(event.text);
                    break;

                case StreamEventType.ToolCallDelta:
                    this.accumulateToolCall(toolCallAccumulators, event);
                    break;

                case StreamEventType.Finish:
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
                    break;
            }
        }

        if (reasoningContent) {
            this.chatImpl.reasoning(reasoningContent);
        }
        if (content) {
            this.chatImpl.assistant(content);
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
        if (reasoningContent) {
            this.chatImpl.reasoning(reasoningContent);
        }

        this.chatImpl.finish(reason);

        if (reason === FinishReason.Stop || reason === FinishReason.Length) {
            this.chatImpl.assistant(content);
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
                try {
                    const result = await this._tools.executeTool(
                        tc.function.name,
                        tc.function.arguments
                    );
                    this.chatImpl.tool(result.result, tc.id);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.chatImpl.tool(`Error: ${msg}`, tc.id);
                }
            }

            await this.sendLoop(iteration + 1);
        }
    }
}
