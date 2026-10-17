import { readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { envInt, envOptionalString, envString } from '../env.js';
import { Chat } from '../chat/chat.js';
import {
    ChatInterface,
    ChatMessageOrigin,
    ChatRole,
    FinishReason,
    MessageWriter,
    ToolCall
} from '../chat/types.js';
import { TokenEstimator, CharCountEstimator } from '../chat/token-estimator.js';
import { MessageQueue } from '../chat/queue.js';
import { ChunkStream } from './stream.js';
import type { ChunkStreamInterface, CompletionUsage } from './stream-types.js';
import { ToolSuite, ToolSuiteInterface } from '../tools/suite.js';
import { JsonHookRegistry, type JsonHookInfo, type JsonHookControls } from '../hooks/json-hooks.js';
import { ServiceEvent, ServiceHookBuilder } from './service-hooks.js';

/** Discriminant for stream event types yielded by a {@link ChatService}. */
export enum StreamEventType {
    Content = 'content',
    ToolCallDelta = 'tool_call_delta',
    Usage = 'usage',
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
    | { type: StreamEventType.Usage; usage: CompletionUsage }
    | { type: StreamEventType.Finish; reason: FinishReason }
    | { type: StreamEventType.Reasoning; text: string };
/** Configuration for a {@link ChatService}. All fields can be set via environment variables. */
export class ChatServiceConfiguration {
    /** Maximum number of tool-call rounds before the loop is interrupted (env: `LLM_CHAT_MAX_TOOL_CALL_ROUNDS`, default: 10). */
    maxToolCallRounds: number = envInt('LLM_CHAT_MAX_TOOL_CALL_ROUNDS', 10);
    /** Directory containing system prompt files (*.md, *.txt). Each file is loaded as a component under the `general` container, with the filename (without extension) as the prompt ID (env: `LLM_CHAT_SYSTEM_PROMPT_DIR`). Priority: env var > config value > fallback to `./prompts/`. The directory is only read if it exists; it is never created and no default files are written. */
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

    /** Directory containing `.json` hook definition files. Priority: env var (`LLM_CHAT_HOOKS_DIR`) > config value > `undefined` (no hooks loaded). */
    get hooksDir(): string | undefined {
        return envOptionalString('LLM_CHAT_HOOKS_DIR') ?? this._hooksDir;
    }

    set hooksDir(value: string | undefined) {
        this._hooksDir = value;
    }
    /** When set, this flat string overrides the system prompt tree. File-based system prompts are not loaded while it is set, and the string is sent directly as the system (or developer) message instead of `chat.getSystem()`. */
    systemPrompt?: string;
    /** Trim leading and trailing whitespace from assistant and reasoning content before storing (default: `false`). */
    trimMessages?: boolean = false;
    /** Context window size hint in tokens (default: `0` = unlimited). When > 0,
     *  the value is used by {@link ChatService.isContextWindowExceeded} as the
     *  threshold for token estimation. This is a hint, not a hard limit —
     *  the service does not enforce it automatically (env: `LLM_CHAT_CONTEXT_WINDOW_SIZE_HINT`). */
    contextWindowSizeHint: number = envInt('LLM_CHAT_CONTEXT_WINDOW_SIZE_HINT', 0, 0);
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
    private _serviceListeners = new Map<string, Set<Function>>();
    private _sendReentrant = false;
    private _pendingReentrant = false;

    protected constructor(
        protected config: ChatServiceConfiguration = new ChatServiceConfiguration()
    ) {
        this._tools.setTutorialContainer(this.chatImpl.system().child('tutorials'));
        this.chatImpl.setSystemResolver(() =>
            this.config.systemPrompt
                ? {
                      role: ChatRole.System,
                      content: this.config.systemPrompt,
                      createdAt: new Date(),
                      origin: ChatMessageOrigin.System
                  }
                : undefined
        );
    }

    /** Access the tool registry to register tools before calling {@link send}. */
    tools(): ToolSuiteInterface {
        return this._tools;
    }

    /** Subscribe to a service event. Internal — use {@link hook} instead. */
    on(event: string, handler: Function): void {
        if (!this._serviceListeners.has(event)) {
            this._serviceListeners.set(event, new Set());
        }
        this._serviceListeners.get(event)!.add(handler);
    }

    /** Unsubscribe a service event handler. */
    off(event: string, handler: Function): void {
        this._serviceListeners.get(event)?.delete(handler);
    }

    private async _emit(event: string, ...args: any[]): Promise<void> {
        const listeners = this._serviceListeners.get(event);
        if (listeners) {
            for (const fn of listeners) await fn(...args);
        }
    }

    /** Build service lifecycle hooks. */
    hook(): ServiceHookBuilder {
        return new ServiceHookBuilder(this);
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

    /**
     * Executes a registered tool and queues its result as assistant+tool
     * messages without firing tool hooks. Does **not** call {@link interrupt}
     * or {@link send} — the caller is responsible for flushing (e.g. via
     * {@link setNeedsResend} in a hook, or by calling {@link send} directly).
     *
     * @param toolName  Name of the registered tool.
     * @param args      Arguments to pass to the tool.
     * @throws          If no tool is registered with `toolName`.
     */
    public async injectToolCall(toolName: string, args: Record<string, unknown>): Promise<void> {
        const tool = this._tools.get(toolName);
        if (!tool) throw new Error(`No tool registered with name '${toolName}'`);

        const id = `${toolName}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
        const toolCall: ToolCall = {
            id,
            type: 'function',
            function: { name: toolName, arguments: JSON.stringify(args) }
        };

        const results = await this._tools.executeTool(toolName, JSON.stringify(args), true);

        await this._messageQueue.assistant('', [toolCall]);
        for (const r of results) {
            await this._messageQueue.tool(r.result, id);
        }
    }

    /** Access the chunk stream produced by the last {@link send} call. */
    stream(): ChunkStreamInterface {
        return this._chunkStream;
    }

    /**
     * Estimate the total token count for the full context that would be sent
     * to the LLM on the next {@link send}. Includes the composed system prompt,
     * all conversation messages, queued (not yet drained) messages, and
     * serialized tool definitions.
     *
     * @param estimator - Optional token estimator strategy. Defaults to
     *                    {@link CharCountEstimator} (chars / 4).
     */
    async estimateTokens(estimator?: TokenEstimator): Promise<number> {
        const est = estimator ?? new CharCountEstimator();
        let total = 0;

        const systemMessage = this.chatImpl.getSystem();
        if (systemMessage) {
            total += est.estimate(systemMessage.content);
        }

        for (const msg of this.chatImpl._rawMessages()) {
            total += est.estimate(msg.content);
        }

        const queued = await this._messageQueue.messages();
        for (const msg of queued) {
            total += est.estimate(msg.content);
        }

        for (const tool of this._tools.getTools()) {
            total += est.estimate(JSON.stringify(tool));
        }

        return total;
    }

    /**
     * Check whether the estimated context token count exceeds the configured
     * {@link ChatServiceConfiguration.contextWindowSizeHint context window size hint}.
     * Returns `false` when the context window size is `0` (unlimited).
     *
     * @param estimator - Optional token estimator strategy. Defaults to
     *                    {@link CharCountEstimator} (chars / 4).
     */
    async isContextWindowExceeded(estimator?: TokenEstimator): Promise<boolean> {
        const limit = this.config.contextWindowSizeHint;
        if (limit <= 0) return false;
        return (await this.estimateTokens(estimator)) > limit;
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
     *  the request is automatically retried.
     *
     *  Hook callbacks may safely call `send()` reentrantly — the call is
     *  deferred and runs as an additional loop iteration. */
    async send(): Promise<void> {
        if (this._sendReentrant) {
            this._pendingReentrant = true;
            return;
        }

        await this._sendMutex.runExclusive(async () => {
            this._sendReentrant = true;
            this._pendingReentrant = false;
            try {
                await this._drainQueue();

                await this._emit(ServiceEvent.BeforeSendLoop);

                do {
                    this._needsResend = false;
                    this._pendingReentrant = false;

                    await this._drainQueue();

                    await this._emit(ServiceEvent.BeforeSend);

                    await this._drainQueue();

                    await this._send();

                    await this._emit(ServiceEvent.AfterSend);
                } while (this._needsResend || this._pendingReentrant);

                this._pendingReentrant = false;

                await this._emit(ServiceEvent.AfterSendLoop);

                await this._drainQueue();
            } finally {
                this._sendReentrant = false;
            }
        });
    }

    /** Drain the message queue into chat history. */
    private async _drainQueue(): Promise<void> {
        const queued = await this._messageQueue.drain();
        await this.chatImpl.addAll(queued);
    }

    /**
     * Abort any in-flight LLM request. When `needsResend` is `true`, sets an
     * internal flag so that {@link send} automatically retries the request.
     */
    interrupt(needsResend?: boolean): void {
        this._abortController?.abort();
        this._needsResend = !!needsResend;
    }

    /** Load or reload the system prompt files from `config.systemPromptDir`
     *  into the `general` container. Safe to call multiple times: clears the
     *  existing `general` container before re-reading. */
    private async loadSystemPromptFiles(): Promise<void> {
        this.chatImpl.system().child('general').clear();
        const dir = this.config.systemPromptDir;
        if (!dir) return;
        const absDir = path.resolve(process.cwd(), dir);
        let entries: Dirent[];
        try {
            entries = await readdir(absDir, { withFileTypes: true });
        } catch {
            return;
        }
        const files = entries
            .filter((e) => e.isFile() && /\.(md|txt)$/i.test(e.name))
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const file of files) {
            const content = await readFile(path.join(absDir, file.name), 'utf-8');
            const name = path.basename(file.name, path.extname(file.name));
            this.chatImpl.system().child('general').prompt(name).setContent(content);
        }
    }

    /** Load user prompt files configured in `config.userPromptPaths` as user messages. */
    private async loadUserPromptFiles(): Promise<void> {
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

    /** Load or reload prompt files from `config.systemPromptDir` into the
     *  `general` container, and load user prompt files configured in
     *  `config.userPromptPaths`. Safe to call multiple times: clears and
     *  re-reads the `general` container. */
    async loadPromptFiles(): Promise<void> {
        await this.loadSystemPromptFiles();
        await this.loadUserPromptFiles();
    }

    /** Eagerly load prompt files and mark the context as loaded.
     *  Idempotent: subsequent calls are no-ops. Call this before the first
     *  {@link send} to resolve the full system prompt upfront, allowing
     *  callers to inspect or display it (e.g. a `/system` command). When a flat
     *  {@link ChatServiceConfiguration.systemPrompt} is configured, file-based
     *  system prompts are skipped. */
    async init(): Promise<void> {
        if (this._contextLoaded) return;
        this._contextLoaded = true;
        if (!this.config.systemPrompt) {
            await this.loadSystemPromptFiles();
        }
        await this.loadUserPromptFiles();
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
        let usage: CompletionUsage | undefined;
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

                    case StreamEventType.Usage:
                        usage = event.usage;
                        this._chunkStream.addUsageChunk(event.usage);
                        break;

                    case StreamEventType.Finish:
                        this._chunkStream.addFinishChunk(event.reason);
                        await this.handleFinish(
                            content,
                            reasoningContent,
                            toolCallAccumulators,
                            event.reason,
                            iteration,
                            usage
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
                    ...(usage ? { usage } : {}),
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
                iteration,
                usage
            );
        } else {
            this._chunkStream.addSummary({
                content: '',
                reasoning: '',
                toolCallCount: 0,
                finishReason: FinishReason.Stop,
                ...(usage ? { usage } : {}),
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
        iteration: number,
        usage?: CompletionUsage
    ): Promise<void> {
        // Ordering guarantee: FinishChunk was already pushed to _chunkStream before this call.
        // Stream hooks fired. Now append completed messages to chat.

        this._chunkStream.addSummary({
            content,
            reasoning: reasoningContent,
            toolCallCount: toolCallAccumulators.size,
            finishReason: reason,
            ...(usage ? { usage } : {}),
            timestamp: new Date()
        });

        const trimmed = (s: string) => (this.config.trimMessages ? s.trim() : s);

        if (reasoningContent) {
            await this.chatImpl.reasoning(trimmed(reasoningContent));
        }

        if (reason === FinishReason.Stop || reason === FinishReason.Length) {
            if (content) {
                await this.chatImpl.assistant(trimmed(content));
            }
            return;
        }

        if (reason === FinishReason.ToolCalls) {
            if (iteration >= this.config.maxToolCallRounds) {
                await this.chatImpl.assistant(trimmed(content));
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

            await this.chatImpl.assistant(trimmed(content), toolCalls);

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
