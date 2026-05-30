import { Hook } from '../hooks/hook.js';

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
    tool_call_id?: string;
    tool_calls?: ToolCall[];
};

export type ChatJSON = {
    systemMessage: ChatMessage | null;
    messages: ChatMessage[];
};

export type ChatMatch = {
    message: ChatMessage;
    matches: RegExpExecArray;
};

// --- Public-facing interface ---

export interface ChatInterface {
    user(content: string): void;
    system(content: string): void;
    assistant(content: string, tool_calls?: ToolCall[]): void;
    tool(content: string, tool_call_id: string): void;
    messages(): ChatMessage[];
    toJSON(): ChatJSON;
    hook(): HookBuilder;
}

// --- Internal event types ---

export enum ChatEvent {
    Message = 'message',
    Reasoning = 'reasoning',
    Chunk = 'chunk',
    Finish = 'finish'
}

type ChatEventMap = {
    [ChatEvent.Message]: [message: ChatMessage];
    [ChatEvent.Reasoning]: [content: string];
    [ChatEvent.Chunk]: [text: string];
    [ChatEvent.Finish]: [reason: FinishReason];
};

// --- Concrete implementation ---

export class Chat implements ChatInterface {
    private systemMessage: ChatMessage | null = null;
    private _messages: ChatMessage[] = [];
    private listeners = new Map<ChatEvent, Set<(...args: unknown[]) => void>>();

    system(content: string): void {
        if (this.systemMessage) {
            this.systemMessage.content = content;
        } else {
            this.systemMessage = { role: ChatRole.System, content };
            this._messages.unshift(this.systemMessage);
        }
    }

    user(content: string): void {
        const message: ChatMessage = { role: ChatRole.User, content };
        this._messages.push(message);
        this.emit(ChatEvent.Message, message);
    }

    assistant(content: string, tool_calls?: ToolCall[]): void {
        const message: ChatMessage = {
            role: ChatRole.Assistant,
            content,
            ...(tool_calls ? { tool_calls } : {})
        };
        this._messages.push(message);
        this.emit(ChatEvent.Message, message);
    }

    tool(content: string, tool_call_id: string): void {
        const message: ChatMessage = { role: ChatRole.Tool, content, tool_call_id };
        this._messages.push(message);
        this.emit(ChatEvent.Message, message);
    }

    chunk(text: string): void {
        this.emit(ChatEvent.Chunk, text);
    }

    reasoning(content: string): void {
        const message: ChatMessage = { role: ChatRole.Reasoning, content };
        this._messages.push(message);
        this.emit(ChatEvent.Reasoning, content);
        this.emit(ChatEvent.Message, message);
    }

    finish(reason: FinishReason): void {
        this.emit(ChatEvent.Finish, reason);
    }

    getMessages(): ChatMessage[] {
        return [...this._messages];
    }

    messages(): ChatMessage[] {
        return this.getMessages();
    }

    clear(systemContent?: string): void {
        if (systemContent !== undefined && this.systemMessage) {
            this.systemMessage.content = systemContent;
        }
        this._messages = this.systemMessage ? [this.systemMessage] : [];
    }

    toJSON(): ChatJSON {
        return {
            systemMessage: this.systemMessage ? { ...this.systemMessage } : null,
            messages: this._messages.map((m) => ({ ...m }))
        };
    }

    static fromJSON(data: ChatJSON): Chat {
        const chat = new Chat();
        chat._messages = data.messages.map((m) => ({ ...m }));
        chat.systemMessage = data.systemMessage ? { ...data.systemMessage } : null;
        return chat;
    }

    // --- Internal event system ---

    on<E extends ChatEvent>(event: E, handler: (...args: ChatEventMap[E]) => void): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler as (...args: unknown[]) => void);
    }

    off<E extends ChatEvent>(event: E, handler: (...args: ChatEventMap[E]) => void): void {
        this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
    }

    // --- Hook builder ---

    hook(): HookBuilder {
        return new HookBuilder(this);
    }

    // --- Fire an event ---

    private emit<E extends ChatEvent>(event: E, ...args: ChatEventMap[E]): void {
        this.listeners.get(event)?.forEach((handler) => handler(...args));
    }
}

// --- Standalone fromJSON ---

export function chatFromJSON(data: ChatJSON): ChatInterface {
    return Chat.fromJSON(data);
}

// --- Builder ---

export class HookBuilder {
    constructor(private _chat: Chat) {}

    chunk(callback: (chat: ChatInterface, text: string) => void): Hook {
        return new ChunkHook(this._chat, callback);
    }

    reasoning(callback: (chat: ChatInterface, text: string) => void): Hook {
        return new ReasoningHook(this._chat, callback);
    }

    finish(callback: (chat: ChatInterface, reason: FinishReason) => void): Hook {
        return new FinishHook(this._chat, callback);
    }

    message(...roles: ChatRole[]): MessageHookBuilder {
        return new MessageHookBuilder(this._chat, roles.length > 0 ? roles : undefined);
    }
}

export class MessageHookBuilder {
    private _regex?: string | RegExp;
    private _maxTriggers?: number;

    constructor(
        private _chat: Chat,
        private _roles?: ChatRole[]
    ) {}

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
        chat.on(ChatEvent.Message, this._onMessage);
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
        this._chat.off(ChatEvent.Message, this._onMessage);
    }
}

class ChunkHook extends Hook {
    private _chat: Chat;
    private _callback: (chat: ChatInterface, text: string) => void;

    constructor(chat: Chat, callback: (chat: ChatInterface, text: string) => void) {
        super();
        this._chat = chat;
        this._callback = callback;
        chat.on(ChatEvent.Chunk, this._onChunk);
    }

    private _onChunk = (text: string): void => {
        if (this.isDisposed()) return;
        this.safeInvoke(() => this._callback(this._chat, text));
    };

    protected onDispose(): void {
        this._chat.off(ChatEvent.Chunk, this._onChunk);
    }
}

class ReasoningHook extends Hook {
    private _chat: Chat;
    private _callback: (chat: ChatInterface, text: string) => void;

    constructor(chat: Chat, callback: (chat: ChatInterface, text: string) => void) {
        super();
        this._chat = chat;
        this._callback = callback;
        chat.on(ChatEvent.Reasoning, this._onReasoning);
    }

    private _onReasoning = (text: string): void => {
        if (this.isDisposed()) return;
        this.safeInvoke(() => this._callback(this._chat, text));
    };

    protected onDispose(): void {
        this._chat.off(ChatEvent.Reasoning, this._onReasoning);
    }
}

class FinishHook extends Hook {
    private _chat: Chat;
    private _callback: (chat: ChatInterface, reason: FinishReason) => void;

    constructor(chat: Chat, callback: (chat: ChatInterface, reason: FinishReason) => void) {
        super();
        this._chat = chat;
        this._callback = callback;
        chat.on(ChatEvent.Finish, this._onFinish);
    }

    private _onFinish = (reason: FinishReason): void => {
        if (this.isDisposed()) return;
        this.safeInvoke(() => this._callback(this._chat, reason));
    };

    protected onDispose(): void {
        this._chat.off(ChatEvent.Finish, this._onFinish);
    }
}
