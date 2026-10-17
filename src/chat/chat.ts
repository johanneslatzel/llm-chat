import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import { PromptComponent, PromptContainer } from './system-prompt.js';
import {
    ChatInterface,
    ChatMessage,
    ChatMessageOrigin,
    ChatRole,
    ChatJSON,
    HandoffStrategy,
    type ToolCall
} from './types.js';
import { ChatHookBuilder } from './hooks.js';

/** Thread-safe chat implementation with system prompt support, message buffering, and hook integration. */
export class Chat implements ChatInterface {
    private _sessionId: string = randomUUID();

    /** Unique session identifier (UUID) assigned on construction. */
    sessionId(): string {
        return this._sessionId;
    }
    private _systemPrompt = new PromptContainer('');
    private _systemResolver: (() => ChatMessage | undefined) | null = null;

    getSystem(): ChatMessage | null {
        const override = this._systemResolver?.();
        if (override !== undefined) return override;
        return this._systemPrompt.hasContent() ? this._systemPrompt.message() : null;
    }

    system(): PromptContainer {
        return this._systemPrompt;
    }

    /**
     * @internal Installed by {@link ChatService}. Returns a system message that
     * overrides the prompt tree, or `undefined` to fall back to the tree.
     */
    setSystemResolver(resolver: (() => ChatMessage | undefined) | null): void {
        this._systemResolver = resolver;
    }
    private _messages: ChatMessage[] = [];
    private _historicMessages: ChatMessage[] = [];
    private _messageListeners = new Set<(message: ChatMessage) => void>();
    private _silent = false;
    private _mutex = new Mutex();

    async user(content: string): Promise<void> {
        const message: ChatMessage = {
            role: ChatRole.User,
            content,
            createdAt: new Date(),
            origin: ChatMessageOrigin.User
        };
        await this._mutex.runExclusive(() => this._messages.push(message));
        await this._emitMessage(message);
    }

    async assistant(content: string, tool_calls?: ToolCall[]): Promise<void> {
        const message: ChatMessage = {
            role: ChatRole.Assistant,
            content,
            createdAt: new Date(),
            origin: ChatMessageOrigin.Model,
            ...(tool_calls ? { tool_calls } : {})
        };
        await this._mutex.runExclusive(() => this._messages.push(message));
        await this._emitMessage(message);
    }

    async tool(content: string, tool_call_id: string): Promise<void> {
        const message: ChatMessage = {
            role: ChatRole.Tool,
            content,
            tool_call_id,
            createdAt: new Date(),
            origin: ChatMessageOrigin.Tool
        };
        await this._mutex.runExclusive(() => this._messages.push(message));
        await this._emitMessage(message);
    }

    async reasoning(content: string): Promise<void> {
        const message: ChatMessage = {
            role: ChatRole.Reasoning,
            content,
            createdAt: new Date(),
            origin: ChatMessageOrigin.Model
        };
        await this._mutex.runExclusive(() => this._messages.push(message));
        await this._emitMessage(message);
    }

    /** Bulk-append messages (system messages are rejected — use {@link system()} instead). */
    async addAll(messages: ChatMessage[]): Promise<void> {
        const toEmit: ChatMessage[] = [];
        await this._mutex.runExclusive(() => {
            for (const msg of messages) {
                if (msg.role === ChatRole.System) {
                    throw new Error(
                        'Cannot add system messages via addAll. Use chat.system().add() instead.'
                    );
                }
                this._messages.push(msg);
                toEmit.push(msg);
            }
        });
        for (const msg of toEmit) {
            await this._emitMessage(msg);
        }
    }

    messages(): ChatMessage[] {
        return deepCopyMessages(this._messages);
    }

    /** @internal Direct access to the internal message array (bypasses deep copy). */
    _rawMessages(): ChatMessage[] {
        return this._messages;
    }

    clear(retainHooks?: boolean): void {
        this._systemPrompt.clear();
        this.clearMessages();
        if (!retainHooks) this._messageListeners.clear();
    }

    silent(enable: boolean): void {
        this._silent = enable;
    }

    clearMessages(): void {
        this._messages = [];
        this._historicMessages = [];
    }

    historicMessages(): ChatMessage[] {
        return deepCopyMessages(this._historicMessages);
    }

    async handoff(strategy: HandoffStrategy): Promise<void> {
        const compacted = strategy.apply(this);
        this._historicMessages.push(...this._messages);
        this.silent(true);
        try {
            this._messages = [];
            await this.addAll(compacted);
        } finally {
            this.silent(false);
        }
    }

    toJSON(): ChatJSON {
        return {
            sessionId: this._sessionId,
            systemPrompt: this._systemPrompt.hasContent() ? this._systemPrompt.toJSON() : null,
            messages: this._messages.map((m) => ({
                ...m,
                createdAt: m.createdAt.toISOString()
            }))
        };
    }

    /** Deserialise a chat from JSON. */
    static fromJSON(data: ChatJSON): Chat {
        const chat = new Chat();
        if (data.sessionId) {
            chat._sessionId = data.sessionId;
        }
        chat._messages = data.messages.map((m) => ({
            ...m,
            createdAt: new Date(m.createdAt)
        }));
        if (data.systemPrompt) {
            chat._systemPrompt = PromptComponent.fromJSON(data.systemPrompt) as PromptContainer;
        }
        return chat;
    }

    hook(): ChatHookBuilder {
        return new ChatHookBuilder(this);
    }

    /** Subscribe to new messages (used internally by hooks). */
    onMessage(handler: (message: ChatMessage) => void): void {
        this._messageListeners.add(handler);
    }

    /** Unsubscribe a message handler. */
    offMessage(handler: (message: ChatMessage) => void): void {
        this._messageListeners.delete(handler);
    }

    private async _emitMessage(message: ChatMessage): Promise<void> {
        if (this._silent) return;
        for (const fn of this._messageListeners) await fn(message);
    }
}

/** Convenience function that deserialises a chat from JSON. */
export function chatFromJSON(data: ChatJSON): ChatInterface {
    return Chat.fromJSON(data);
}

/** Deep-copy an array of chat messages (clones Date, tool_calls, and function objects). */
export function deepCopyMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((m) => ({
        ...m,
        createdAt: new Date(m.createdAt),
        ...(m.tool_calls
            ? { tool_calls: m.tool_calls.map((tc) => ({ ...tc, function: { ...tc.function } })) }
            : {})
    }));
}
