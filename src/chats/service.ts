import { readFile, readdir, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { envInt, envOptionalString, envString } from '../env.js';
import { Chat, ChatInterface, FinishReason, MessageWriter, ToolCall } from './chat.js';
import { MessageQueue } from './queue.js';
import { ChunkStream, ChunkStreamInterface } from './stream.js';
import { ToolSuite, ToolSuiteInterface } from '../tools/suite.js';
import { JsonHookRegistry, type JsonHookInfo, type JsonHookControls } from '../hooks/json-hooks.js';

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

/**
 * Default prompt IDs created as empty `.md` files when the system prompt
 * directory is first initialised.
 *
 * These categories are derived from real-world system prompts collected at
 * https://github.com/dontriskit/awesome-ai-system-prompts
 */
export enum SystemPromptId {
    /** Role & identity — who the AI is, who created it, its purpose. */
    Persona = 'persona',
    /** General instructions & constraints — behavioral rules, meta-instructions, dos/donts. */
    Rules = 'rules',
    /** Tone & interaction style — how to communicate, adapt to the user. */
    Behavior = 'behavior',
    /** Domain-specific knowledge — tech stack, libraries, conventions, best practices. */
    Domain = 'domain',
    /** System context — OS, platform, IDE, sandbox, capabilities. */
    Environment = 'environment',
    /** Refusal protocols & alignment — what to refuse, how to refuse, content policies. */
    Safety = 'safety',
    /** Planning & thinking — step-by-step reasoning, agent loops, planning phases. */
    Reasoning = 'reasoning',
    /** Task definitions — what the AI excels at, broad task categories. */
    Capabilities = 'capabilities'
}

/** Configuration for a {@link ChatService}. All fields can be set via environment variables. */
export class ChatServiceConfiguration {
    /** Maximum number of tool-call rounds before the loop is interrupted (env: `LLM_CHAT_MAX_TOOL_CALL_ROUNDS`, default: 10). */
    maxToolCallRounds: number = envInt('LLM_CHAT_MAX_TOOL_CALL_ROUNDS', 10);
    /** Directory containing system prompt files (*.md, *.txt). Each file is loaded as a component under the `general` container, with the filename (without extension) as the prompt ID (env: `LLM_CHAT_SYSTEM_PROMPT_DIR`). Priority: env var > config value > fallback to `./prompts/`. */
    private _systemPromptDir?: string;

    get systemPromptDir(): string {
        return envString('LLM_CHAT_SYSTEM_PROMPT_DIR', this._systemPromptDir ?? './prompts/');
    }

    set systemPromptDir(value: string) {
        this._systemPromptDir = value;
    }
    /** Comma-separated paths to files whose contents are loaded as user messages (env: `LLM_CHAT_USER_PROMPTS`). */
    userPromptPaths: string[] = envString('LLM_CHAT_USER_PROMPTS', '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    private _hooksDir: string | undefined = undefined;

    /** Directory containing `.json` hook definition files. Priority: config value > env var (`LLM_CHAT_HOOKS_DIR`) > `undefined` (no hooks loaded). */
    get hooksDir(): string | undefined {
        return envOptionalString('LLM_CHAT_HOOKS_DIR') ?? this._hooksDir;
    }

    set hooksDir(value: string | undefined) {
        this._hooksDir = value;
    }
}

/** Base class for LLM service providers. Handles the tool-call loop, prompt file loading, and concurrency. */
export abstract class ChatService implements JsonHookControls {
    private _contextLoaded = false;
    private _sendMutex = new Mutex();
    private _chunkStream = new ChunkStream();
    private _abortController: AbortController | null = null;
    private _messageQueue = new MessageQueue();
    private _needsResend = false;
    /** The underlying chat instance. Access to read/write messages directly. */
    public readonly chatImpl: Chat = new Chat();
    /** Internal tool registry. */
    protected _tools = new ToolSuite();
    private _jsonHookRegistry = new JsonHookRegistry(this._messageQueue, this);

    protected constructor(
        private config: ChatServiceConfiguration = new ChatServiceConfiguration()
    ) {
        this._tools.setTutorialContainer(this.chatImpl.system().child('tutorials'));
    }

    /** Access the tool registry to register tools before calling {@link send}. */
    tools(): ToolSuiteInterface {
        return this._tools;
    }

    /** Access the chat interface to build message history. */
    chat(): ChatInterface {
        return this.chatImpl;
    }

    /** Access the message queue to stage messages for the next {@link send}. */
    queue(): MessageWriter {
        return this._messageQueue;
    }

    /** Set the resend flag so that the next {@link send} retries the request.
     *  This can be useful in custom hook actions that need to re-send after
     *  modifying the chat or queue, without aborting the current stream. */
    setNeedsResend(): void {
        this._needsResend = true;
    }

    /** Access the chunk stream produced by the last {@link send} call. */
    stream(): ChunkStreamInterface {
        return this._chunkStream;
    }

    /** Load or reload JSON hook files from the configured hooks directory. */
    async loadJsonHooks(): Promise<void> {
        const dir = this.config.hooksDir;
        if (!dir) return;
        await this._jsonHookRegistry.load(dir, {
            chat: this.chatImpl,
            stream: this._chunkStream,
            tools: this._tools
        });
    }

    /** Return metadata for all currently registered JSON hooks. */
    getJsonHooks(): readonly JsonHookInfo[] {
        return this._jsonHookRegistry.hookInfos;
    }

    /** Full reset — clears chat, stream, tools, JSON hooks, and tutorials.
     *  Resets `_contextLoaded` so the next {@link send} re-runs `init()`. */
    clear(): void {
        this._jsonHookRegistry.clear();
        this._chunkStream.clear();
        this.chatImpl.clear();
        this._tools.clear();
        this.resetTutorials();
        this._contextLoaded = false;
    }

    protected abstract createStream(signal?: AbortSignal): AsyncIterable<StreamEvent>;

    private async _send(): Promise<void> {
        this._abortController = new AbortController();
        try {
            this._chunkStream.clear(true);
            await this.init();
            await this.sendLoop(0);
        } finally {
            this._abortController = null;
        }
    }

    /** Send the current chat to the provider and process the response (mutex-guarded).
     *  Drains the message queue first. If a hook calls {@link interrupt} with
     *  `resend: true` (or {@link setNeedsResend} is called) during the send,
     *  the request is automatically retried. */
    async send(): Promise<void> {
        await this._sendMutex.runExclusive(async () => {
            do {
                this._needsResend = false;
                const queued = await this._messageQueue.clear();
                if (queued.length > 0) {
                    await this.chatImpl.addAll(queued);
                }
                await this._send();
            } while (this._needsResend);
        });
    }

    /**
     * Abort any in-flight LLM request. When `needsResend` is `true`, sets an
     * internal flag so that {@link send} automatically retries the request.
     */
    interrupt(needsResend?: boolean): void {
        this._abortController?.abort();
        this._needsResend = !!needsResend;
    }

    /** Load or reload prompt files from `config.systemPromptDir` into the
     *  `general` container. Safe to call multiple times — clears the existing
     *  `general` container before re-reading. Also loads user prompt files
     *  configured in `config.userPromptPaths`. */
    async loadPromptFiles(): Promise<void> {
        this.chatImpl.system().child('general').clear();
        if (this.config.systemPromptDir) {
            const absDir = path.resolve(process.cwd(), this.config.systemPromptDir);
            await mkdir(absDir, { recursive: true });

            const defaults = Object.values(SystemPromptId);
            for (const id of defaults) {
                const filePath = path.join(absDir, `${id}.md`);
                try {
                    await access(filePath);
                } catch {
                    await writeFile(filePath, '', 'utf-8');
                }
            }

            const entries = await readdir(absDir, { withFileTypes: true });
            const files = entries
                .filter((e) => e.isFile() && /\.(md|txt)$/i.test(e.name))
                .sort((a, b) => a.name.localeCompare(b.name));
            for (const file of files) {
                const content = await readFile(path.join(absDir, file.name), 'utf-8');
                const name = path.basename(file.name, path.extname(file.name));
                this.chatImpl.system().child('general').prompt(name).setContent(content);
            }
        }
        for (const relPath of this.config.userPromptPaths) {
            const absPath = path.resolve(process.cwd(), relPath);
            try {
                const content = await readFile(absPath, 'utf-8');
                await this.chatImpl.user(content);
            } catch {
                console.warn(`Failed to load user prompt file: ${absPath}`);
            }
        }
    }

    /** Eagerly load prompt files and mark the context as loaded.
     *  Idempotent — subsequent calls are no-ops. Call this before the first
     *  {@link send} to resolve the full system prompt upfront, allowing
     *  callers to inspect or display it (e.g. a `/system` command). */
    async init(): Promise<void> {
        if (this._contextLoaded) return;
        this._contextLoaded = true;
        await this.loadPromptFiles();
        await this.loadJsonHooks();
    }

    /** Re-wire the tutorial container and rebuild tutorial entries after
     *  {@link Chat.clear}. Must be called after `chat.clear()` to re-attach
     *  tool tutorials to the fresh system prompt tree. */
    resetTutorials(): void {
        this._tools.setTutorialContainer(this.chatImpl.system().child('tutorials'));
        this._tools.rebuildTutorials();
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

        if (this._abortController?.signal.aborted) {
            return;
        }

        try {
            for await (const event of this.createStream(this._abortController?.signal)) {
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
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                this._chunkStream.addFinishChunk(FinishReason.Aborted);
                this._chunkStream.addSummary({
                    content,
                    reasoning: reasoningContent,
                    toolCallCount: toolCallAccumulators.size,
                    finishReason: FinishReason.Aborted,
                    timestamp: new Date()
                });
                return;
            }
            throw err;
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
        } else {
            this._chunkStream.addSummary({
                content: '',
                reasoning: '',
                toolCallCount: 0,
                finishReason: FinishReason.Stop,
                timestamp: new Date()
            });
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

        this._chunkStream.addSummary({
            content,
            reasoning: reasoningContent,
            toolCallCount: toolCallAccumulators.size,
            finishReason: reason,
            timestamp: new Date()
        });

        if (reasoningContent) {
            await this.chatImpl.reasoning(reasoningContent);
        }

        if (reason === FinishReason.Stop || reason === FinishReason.Length) {
            if (content) {
                await this.chatImpl.assistant(content);
            }
            return;
        }

        if (reason === FinishReason.ToolCalls) {
            if (iteration >= this.config.maxToolCallRounds) {
                await this.chatImpl.assistant(content);
                await this.chatImpl.user(
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

            await this.chatImpl.assistant(content, toolCalls);

            for (const tc of toolCalls) {
                const results = await this._tools.executeTool(
                    tc.function.name,
                    tc.function.arguments
                );
                for (const entry of results) {
                    await this.chatImpl.tool(entry.result, tc.id);
                }
            }

            await this.sendLoop(iteration + 1);
        }
    }
}
