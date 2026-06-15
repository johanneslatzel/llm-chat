import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import { Hook } from '../hooks/hook.js';
import { HookBuilderBase, HasHooks } from '../hooks/hook-builder.js';
import { PromptComponent, PromptContainer, type ComponentJSON } from './system-prompt.js';

/** Role of a single message in the conversation. */
export enum ChatRole {
    System = 'system',
    User = 'user',
    Assistant = 'assistant',
    Tool = 'tool',
    Reasoning = 'reasoning'
}

/** Where a chat message originated from. */
export enum ChatMessageOrigin {
    User = 'user',
    Model = 'model',
    Hook = 'hook',
    Tool = 'tool',
    System = 'system'
}

/** Why the model stopped generating. */
export enum FinishReason {
    Stop = 'stop',
    ToolCalls = 'tool_calls',
    Length = 'length',
    Aborted = 'aborted'
}

/** A function call requested by the model. */
export type ToolCall = {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
};

/** A single message in the conversation history. */
export type ChatMessage = {
    role: ChatRole;
    content: string;
    createdAt: Date;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
    origin: ChatMessageOrigin;
};

type ChatMessageJSON = Omit<ChatMessage, 'createdAt'> & { createdAt: string };

/** Serialized chat format produced by {@link ChatInterface.toJSON} and accepted by {@link Chat.fromJSON}. */
export type ChatJSON = {
    sessionId?: string;
    systemPrompt: ComponentJSON | null;
    messages: ChatMessageJSON[];
};

export type ChatMatch = {
    message: ChatMessage;
    matches: RegExpExecArray;
};

// --- Public-facing interface ---

/** Add messages to a chat or queue. All methods are async for mutex-safety. */
export interface MessageWriter {
    user(content: string): Promise<void>;
    assistant(content: string, tool_calls?: ToolCall[]): Promise<void>;
    tool(content: string, tool_call_id: string): Promise<void>;
    reasoning(content: string): Promise<void>;
}

/** Like {@link MessageWriter}, but each method requires an explicit origin. Used by hooks. */
export interface HookMessageWriter {
    user(content: string, origin: ChatMessageOrigin): Promise<void>;
    assistant(
        content: string,
        tool_calls: ToolCall[] | undefined,
        origin: ChatMessageOrigin
    ): Promise<void>;
    tool(content: string, tool_call_id: string, origin: ChatMessageOrigin): Promise<void>;
    reasoning(content: string, origin: ChatMessageOrigin): Promise<void>;
}

/** Build and inspect chat message history. Passed to hooks and used by services. */
export interface ChatInterface extends HasHooks<ChatHookBuilder>, MessageWriter {
    /** Access the composable system prompt builder. */
    system(): PromptContainer;
    /**
     * Return conversation messages (user, assistant, tool, reasoning).
     * Does NOT include the system message — use {@link getSystem} for that.
     */
    messages(): ChatMessage[];
    toJSON(): ChatJSON;
    /** Return the system message, or `null` if none has been set. */
    getSystem(): ChatMessage | null;
    hook(): ChatHookBuilder;
    /**
     * Remove all conversation messages and clear the system prompt tree.
     * Also clears message hook listeners unless `retainHooks` is `true`.
     */
    clear(retainHooks?: boolean): void;
}

// --- Concrete implementation ---

/** Concrete chat implementation. Stores messages and provides serialization. */
export class Chat implements ChatInterface {
    /** Unique session identifier. */
    sessionId: string = randomUUID();
    private _systemPrompt = new PromptContainer('');

    /** @inheritDoc */
    getSystem(): ChatMessage | null {
        return this._systemPrompt.hasContent() ? this._systemPrompt.message() : null;
    }

    /** @inheritDoc */
    system(): PromptContainer {
        return this._systemPrompt;
    }
    private _messages: ChatMessage[] = [];
    private _messageListeners = new Set<(message: ChatMessage) => void>();
    private _mutex = new Mutex();

    /** @inheritDoc */
    async user(content: string): Promise<void> {
        const message: ChatMessage = {
            role: ChatRole.User,
            content,
            createdAt: new Date(),
            origin: ChatMessageOrigin.User
        };
        await this._mutex.runExclusive(() => this._messages.push(message));
        this._emitMessage(message);
    }

    /** @inheritDoc */
    async assistant(content: string, tool_calls?: ToolCall[]): Promise<void> {
        const message: ChatMessage = {
            role: ChatRole.Assistant,
            content,
            createdAt: new Date(),
            origin: ChatMessageOrigin.Model,
            ...(tool_calls ? { tool_calls } : {})
        };
        await this._mutex.runExclusive(() => this._messages.push(message));
        this._emitMessage(message);
    }

    /** @inheritDoc */
    async tool(content: string, tool_call_id: string): Promise<void> {
        const message: ChatMessage = {
            role: ChatRole.Tool,
            content,
            tool_call_id,
            createdAt: new Date(),
            origin: ChatMessageOrigin.Tool
        };
        await this._mutex.runExclusive(() => this._messages.push(message));
        this._emitMessage(message);
    }

    /** @inheritDoc */
    async reasoning(content: string): Promise<void> {
        const message: ChatMessage = {
            role: ChatRole.Reasoning,
            content,
            createdAt: new Date(),
            origin: ChatMessageOrigin.Model
        };
        await this._mutex.runExclusive(() => this._messages.push(message));
        this._emitMessage(message);
    }

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
            this._emitMessage(msg);
        }
    }

    /** @inheritDoc */
    messages(): ChatMessage[] {
        return [...this._messages];
    }

    /** Remove all conversation messages and clear the system prompt tree.
     *  After calling this, {@link getSystem} returns `null` and
     *  {@link messages} is empty. The system prompt container is cleared
     *  in-place (children are removed, title is reset). If tool tutorials
     *  were registered, call `service.resetTutorials()` afterwards to
     *  re-populate the `tutorials` child container.
     *  When `retainHooks` is `true`, message hook listeners are preserved. */
    clear(retainHooks?: boolean): void {
        this._systemPrompt.clear();
        this._messages = [];
        if (!retainHooks) this._messageListeners.clear();
    }

    /** @inheritDoc */
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

    /** Restore a chat from previously serialized JSON. */
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

    /** @inheritDoc */
    hook(): ChatHookBuilder {
        return new ChatHookBuilder(this);
    }

    // --- Internal message listener system ---

    onMessage(handler: (message: ChatMessage) => void): void {
        this._messageListeners.add(handler);
    }

    offMessage(handler: (message: ChatMessage) => void): void {
        this._messageListeners.delete(handler);
    }

    private _emitMessage(message: ChatMessage): void {
        this._messageListeners.forEach((fn) => fn(message));
    }
}

// --- Standalone fromJSON ---

/** Deserialize a chat from JSON. Shorthand for {@link Chat.fromJSON}. */
export function chatFromJSON(data: ChatJSON): ChatInterface {
    return Chat.fromJSON(data);
}

// --- Hook builders ---

/** Builder for chat message hooks. Start with {@link message} to filter by role. */
export class ChatHookBuilder {
    constructor(private _chat: Chat) {}

    /** Filter messages by role(s). Returns a builder to set regex/maxTriggers. */
    message(...roles: ChatRole[]): MessageHookBuilder {
        return new MessageHookBuilder(this._chat, roles.length > 0 ? roles : undefined);
    }
}

/** Builder that configures a message hook with optional regex and max triggers. */
export class MessageHookBuilder extends HookBuilderBase<
    (message: ChatMessage, matches: RegExpExecArray) => void
> {
    private _regex?: string | RegExp;
    private _maxTriggers?: number;

    constructor(
        private _chat: Chat,
        private _roles?: ChatRole[]
    ) {
        super();
    }

    /** Only fire when the message content matches this pattern. */
    regex(pattern: string | RegExp): this {
        this._regex = pattern;
        return this;
    }

    /** Maximum number of times the hook should fire (default: unlimited). */
    maxTriggers(n: number): this {
        this._maxTriggers = n;
        return this;
    }

    /** Register the hook callback. The hook fires immediately when a matching message is added. */
    do(callback: (message: ChatMessage, matches: RegExpExecArray) => void): Hook {
        return new MessageHook(this._chat, callback, this._roles, this._regex, this._maxTriggers);
    }
}

// --- Hook implementations ---

class MessageHook extends Hook {
    private _chat: Chat;
    private _callback: (message: ChatMessage, matches: RegExpExecArray) => void;
    private _triggerCount = 0;
    private _maxTriggers: number;
    private _roles: ChatRole[] | undefined;
    private _regex: RegExp | undefined;

    constructor(
        chat: Chat,
        callback: (message: ChatMessage, matches: RegExpExecArray) => void,
        roles?: ChatRole[],
        regex?: string | RegExp,
        maxTriggers?: number
    ) {
        super();
        this._chat = chat;
        this._callback = callback;
        this._maxTriggers = maxTriggers ?? Infinity;
        this._roles = roles;
        this._regex = typeof regex === 'string' ? new RegExp(regex) : regex;
        chat.onMessage(this._onMessage);
    }

    private _onMessage = (message: ChatMessage): void => {
        if (this.isDisposed()) return;
        if (this._triggerCount >= this._maxTriggers) return;
        this._triggerCount++;
        const match = this.tryMatch(message);
        if (match) {
            this.safeInvoke(() => this._callback(match.message, match.matches));
        }
    };

    private tryMatch(message: ChatMessage): ChatMatch | null {
        if (this._roles && !this._roles.includes(message.role)) return null;
        if (!this._roles && !this._regex) return null;
        if (this._regex) {
            const matches = this._regex.exec(message.content);
            if (!matches) return null;
            return { message, matches };
        }
        const execArray = [message.content] as unknown as RegExpExecArray;
        execArray.index = 0;
        execArray.input = message.content;
        return { message, matches: execArray };
    }

    protected onDispose(): void {
        this._chat.offMessage(this._onMessage);
    }
}
