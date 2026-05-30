import { Hook } from '../hooks/hook.js';
export var ChatRole;
(function (ChatRole) {
    ChatRole["System"] = "system";
    ChatRole["User"] = "user";
    ChatRole["Assistant"] = "assistant";
    ChatRole["Tool"] = "tool";
    ChatRole["Reasoning"] = "reasoning";
})(ChatRole || (ChatRole = {}));
export var FinishReason;
(function (FinishReason) {
    FinishReason["Stop"] = "stop";
    FinishReason["ToolCalls"] = "tool_calls";
    FinishReason["Length"] = "length";
})(FinishReason || (FinishReason = {}));
// --- Internal event types ---
export var ChatEvent;
(function (ChatEvent) {
    ChatEvent["Message"] = "message";
    ChatEvent["Reasoning"] = "reasoning";
    ChatEvent["Chunk"] = "chunk";
    ChatEvent["Finish"] = "finish";
})(ChatEvent || (ChatEvent = {}));
// --- Concrete implementation ---
export class Chat {
    systemMessage = null;
    _messages = [];
    listeners = new Map();
    system(content) {
        if (this.systemMessage) {
            this.systemMessage.content = content;
        }
        else {
            this.systemMessage = { role: ChatRole.System, content };
            this._messages.unshift(this.systemMessage);
        }
    }
    user(content) {
        const message = { role: ChatRole.User, content };
        this._messages.push(message);
        this.emit(ChatEvent.Message, message);
    }
    assistant(content, tool_calls) {
        const message = {
            role: ChatRole.Assistant,
            content,
            ...(tool_calls ? { tool_calls } : {})
        };
        this._messages.push(message);
        this.emit(ChatEvent.Message, message);
    }
    tool(content, tool_call_id) {
        const message = { role: ChatRole.Tool, content, tool_call_id };
        this._messages.push(message);
        this.emit(ChatEvent.Message, message);
    }
    chunk(text) {
        this.emit(ChatEvent.Chunk, text);
    }
    reasoning(content) {
        const message = { role: ChatRole.Reasoning, content };
        this._messages.push(message);
        this.emit(ChatEvent.Reasoning, content);
        this.emit(ChatEvent.Message, message);
    }
    finish(reason) {
        this.emit(ChatEvent.Finish, reason);
    }
    getMessages() {
        return [...this._messages];
    }
    messages() {
        return this.getMessages();
    }
    clear(systemContent) {
        if (systemContent !== undefined && this.systemMessage) {
            this.systemMessage.content = systemContent;
        }
        this._messages = this.systemMessage ? [this.systemMessage] : [];
    }
    toJSON() {
        return {
            systemMessage: this.systemMessage ? { ...this.systemMessage } : null,
            messages: this._messages.map((m) => ({ ...m }))
        };
    }
    static fromJSON(data) {
        const chat = new Chat();
        chat._messages = data.messages.map((m) => ({ ...m }));
        chat.systemMessage = data.systemMessage ? { ...data.systemMessage } : null;
        return chat;
    }
    // --- Internal event system ---
    on(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(handler);
    }
    off(event, handler) {
        this.listeners.get(event)?.delete(handler);
    }
    // --- Hook builder ---
    hook() {
        return new HookBuilder(this);
    }
    // --- Fire an event ---
    emit(event, ...args) {
        this.listeners.get(event)?.forEach((handler) => handler(...args));
    }
}
// --- Standalone fromJSON ---
export function chatFromJSON(data) {
    return Chat.fromJSON(data);
}
// --- Builder ---
export class HookBuilder {
    _chat;
    constructor(_chat) {
        this._chat = _chat;
    }
    chunk(callback) {
        return new ChunkHook(this._chat, callback);
    }
    reasoning(callback) {
        return new ReasoningHook(this._chat, callback);
    }
    finish(callback) {
        return new FinishHook(this._chat, callback);
    }
    message(...roles) {
        return new MessageHookBuilder(this._chat, roles.length > 0 ? roles : undefined);
    }
}
export class MessageHookBuilder {
    _chat;
    _roles;
    _regex;
    _maxTriggers;
    constructor(_chat, _roles) {
        this._chat = _chat;
        this._roles = _roles;
    }
    regex(pattern) {
        this._regex = pattern;
        return this;
    }
    maxTriggers(n) {
        this._maxTriggers = n;
        return this;
    }
    do(callback) {
        return new MessageHook(this._chat, callback, this._roles, this._regex, this._maxTriggers);
    }
}
// --- Hook implementations ---
class MessageHook extends Hook {
    _chat;
    _callback;
    _triggerCount = 0;
    _maxTriggers;
    _roles;
    _regex;
    constructor(chat, callback, roles, regex, maxTriggers) {
        super();
        this._chat = chat;
        this._callback = callback;
        this._maxTriggers = maxTriggers ?? Infinity;
        this._roles = roles;
        this._regex = typeof regex === 'string' ? new RegExp(regex) : regex;
        chat.on(ChatEvent.Message, this._onMessage);
    }
    _onMessage = (message) => {
        if (this.isDisposed())
            return;
        if (this._triggerCount >= this._maxTriggers)
            return;
        this._triggerCount++;
        const match = this.tryMatch(message);
        if (match) {
            this.safeInvoke(() => this._callback(match.message, match.matches));
        }
    };
    tryMatch(message) {
        if (this._roles && !this._roles.includes(message.role))
            return null;
        if (!this._roles && !this._regex)
            return null;
        if (this._regex) {
            const matches = this._regex.exec(message.content);
            if (!matches)
                return null;
            return { message, matches };
        }
        const execArray = [message.content];
        execArray.index = 0;
        execArray.input = message.content;
        return { message, matches: execArray };
    }
    onDispose() {
        this._chat.off(ChatEvent.Message, this._onMessage);
    }
}
class ChunkHook extends Hook {
    _chat;
    _callback;
    constructor(chat, callback) {
        super();
        this._chat = chat;
        this._callback = callback;
        chat.on(ChatEvent.Chunk, this._onChunk);
    }
    _onChunk = (text) => {
        if (this.isDisposed())
            return;
        this.safeInvoke(() => this._callback(this._chat, text));
    };
    onDispose() {
        this._chat.off(ChatEvent.Chunk, this._onChunk);
    }
}
class ReasoningHook extends Hook {
    _chat;
    _callback;
    constructor(chat, callback) {
        super();
        this._chat = chat;
        this._callback = callback;
        chat.on(ChatEvent.Reasoning, this._onReasoning);
    }
    _onReasoning = (text) => {
        if (this.isDisposed())
            return;
        this.safeInvoke(() => this._callback(this._chat, text));
    };
    onDispose() {
        this._chat.off(ChatEvent.Reasoning, this._onReasoning);
    }
}
class FinishHook extends Hook {
    _chat;
    _callback;
    constructor(chat, callback) {
        super();
        this._chat = chat;
        this._callback = callback;
        chat.on(ChatEvent.Finish, this._onFinish);
    }
    _onFinish = (reason) => {
        if (this.isDisposed())
            return;
        this.safeInvoke(() => this._callback(this._chat, reason));
    };
    onDispose() {
        this._chat.off(ChatEvent.Finish, this._onFinish);
    }
}
//# sourceMappingURL=chat.js.map