import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import { PromptComponent, PromptContainer } from './system-prompt.js';
import {
    ChatInterface,
    ChatMessage,
    ChatMessageOrigin,
    ChatRole,
    ChatJSON,
    type ToolCall
} from './types.js';
import { ChatHookBuilder } from './hooks.js';

/** Thread-safe chat implementation with system prompt support, message buffering, and hook integration. */
export class Chat implements ChatInterface {
    /** Unique session identifier assigned on construction. */
    sessionId: string = randomUUID();
    private _systemPrompt = new PromptContainer('');

    getSystem(): ChatMessage | null {
        return this._systemPrompt.hasContent() ? this._systemPrompt.message() : null;
    }

    system(): PromptContainer {
        return this._systemPrompt;
    }
    private _messages: ChatMessage[] = [];
    private _messageListeners = new Set<(message: ChatMessage) => void>();
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
        return [...this._messages];
    }

    clear(retainHooks?: boolean): void {
        this._systemPrompt.clear();
        this._messages = [];
        if (!retainHooks) this._messageListeners.clear();
    }

    toJSON(): ChatJSON {
        return {
            sessionId: this.sessionId,
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
            chat.sessionId = data.sessionId;
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
        for (const fn of this._messageListeners) await fn(message);
    }
}

/** Convenience function that deserialises a chat from JSON. */
export function chatFromJSON(data: ChatJSON): ChatInterface {
    return Chat.fromJSON(data);
}
