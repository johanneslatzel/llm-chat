import { Hook } from '../hooks/hook.js';
import { HookBuilderBase, HasHooks } from '../hooks/hook-builder.js';

export enum ChatRole {
    System = 'system',
    User = 'user',
    Assistant = 'assistant',
    Tool = 'tool',
    Reasoning = 'reasoning'
}

export enum FinishReason {
    Stop = 'stop',
    ToolCalls = 'tool_calls',
    Length = 'length'
}

export type ToolCall = {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
};

export type ChatMessage = {
    role: ChatRole;
    content: string;
    createdAt: Date;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
};

type ChatMessageJSON = Omit<ChatMessage, 'createdAt'> & { createdAt: string };

export type ChatJSON = {
    systemMessage: ChatMessageJSON | null;
    messages: ChatMessageJSON[];
};

export type ChatMatch = {
    message: ChatMessage;
    matches: RegExpExecArray;
};

// --- Public-facing interface ---

export interface ChatInterface extends HasHooks<ChatHookBuilder> {
    user(content: string): void;
    system(content: string): void;
    assistant(content: string, tool_calls?: ToolCall[]): void;
    tool(content: string, tool_call_id: string): void;
    messages(): ChatMessage[];
    toJSON(): ChatJSON;
    hook(): ChatHookBuilder;
}

// --- Concrete implementation ---

export class Chat implements ChatInterface {
    private systemMessage: ChatMessage | null = null;
    private _messages: ChatMessage[] = [];
    private _messageListeners = new Set<(message: ChatMessage) => void>();

    system(content: string): void {
        if (this.systemMessage) {
            this.systemMessage.content = content;
        } else {
            this.systemMessage = { role: ChatRole.System, content, createdAt: new Date() };
        }
    }

    user(content: string): void {
        const message: ChatMessage = { role: ChatRole.User, content, createdAt: new Date() };
        this._messages.push(message);
        this._emitMessage(message);
    }

    assistant(content: string, tool_calls?: ToolCall[]): void {
        const message: ChatMessage = {
            role: ChatRole.Assistant,
            content,
            createdAt: new Date(),
            ...(tool_calls ? { tool_calls } : {})
        };
        this._messages.push(message);
        this._emitMessage(message);
    }

    tool(content: string, tool_call_id: string): void {
        const message: ChatMessage = {
            role: ChatRole.Tool,
            content,
            tool_call_id,
            createdAt: new Date()
        };
        this._messages.push(message);
        this._emitMessage(message);
    }

    reasoning(content: string): void {
        const message: ChatMessage = { role: ChatRole.Reasoning, content, createdAt: new Date() };
        this._messages.push(message);
        this._emitMessage(message);
    }

    messages(): ChatMessage[] {
        return this.systemMessage ? [this.systemMessage, ...this._messages] : [...this._messages];
    }

    clear(): void {
        this.systemMessage = null;
        this._messages = [];
    }

    toJSON(): ChatJSON {
        return {
            systemMessage: this.systemMessage
                ? { ...this.systemMessage, createdAt: this.systemMessage.createdAt.toISOString() }
                : null,
            messages: this._messages.map((m) => ({
                ...m,
                createdAt: m.createdAt.toISOString()
            }))
        };
    }

    static fromJSON(data: ChatJSON): Chat {
        const chat = new Chat();
        chat._messages = data.messages.map((m) => ({
            ...m,
            createdAt: new Date(m.createdAt)
        }));
        chat.systemMessage = data.systemMessage
            ? { ...data.systemMessage, createdAt: new Date(data.systemMessage.createdAt) }
            : null;
        return chat;
    }

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

export function chatFromJSON(data: ChatJSON): ChatInterface {
    return Chat.fromJSON(data);
}

// --- Hook builders ---

export class ChatHookBuilder {
    constructor(private _chat: Chat) {}

    message(...roles: ChatRole[]): MessageHookBuilder {
        return new MessageHookBuilder(this._chat, roles.length > 0 ? roles : undefined);
    }
}

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

    regex(pattern: string | RegExp): this {
        this._regex = pattern;
        return this;
    }

    maxTriggers(n: number): this {
        this._maxTriggers = n;
        return this;
    }

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
