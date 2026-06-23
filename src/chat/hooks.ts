import { Hook } from '../hooks/hook.js';
import { HookBuilderBase } from '../hooks/hook-builder.js';
import { ChatRole, ChatMessage, ChatMatch } from './types.js';
import type { Chat } from './chat.js';

/** Entry point for building chat message hooks. Created by {@link ChatInterface.hook}. */
export class ChatHookBuilder {
    constructor(private _chat: Chat) {}

    /** Build a message hook, optionally filtered by roles. */
    message(...roles: ChatRole[]): MessageHookBuilder {
        return new MessageHookBuilder(this._chat, roles.length > 0 ? roles : undefined);
    }
}

/** Builder that configures and registers a message hook with optional regex filtering and trigger limits. */
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

    /** Limit how many times the hook can fire. */
    maxTriggers(n: number): this {
        this._maxTriggers = n;
        return this;
    }

    /** Register the hook. The callback receives the matched message and its regex exec array. */
    do(callback: (message: ChatMessage, matches: RegExpExecArray) => void): Hook {
        return new MessageHook(this._chat, callback, this._roles, this._regex, this._maxTriggers);
    }
}

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

    private _onMessage = async (message: ChatMessage): Promise<void> => {
        if (this.isDisposed()) return;
        if (this._triggerCount >= this._maxTriggers) return;
        this._triggerCount++;
        const match = this.tryMatch(message);
        if (match) {
            await this.asyncSafeInvoke(() => this._callback(match.message, match.matches));
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
