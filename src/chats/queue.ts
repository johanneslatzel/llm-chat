import { Mutex } from 'async-mutex';
import {
    ChatMessage,
    ChatMessageOrigin,
    ChatRole,
    HookMessageWriter,
    MessageWriter,
    ToolCall
} from './chat.js';

/** Thread-safe message queue backed by its own mutex. Implements both {@link MessageWriter} and {@link HookMessageWriter}. */
export class MessageQueue implements MessageWriter, HookMessageWriter {
    private _messages: ChatMessage[] = [];
    private _mutex = new Mutex();

    async user(content: string, origin?: ChatMessageOrigin): Promise<void> {
        await this._mutex.runExclusive(() => {
            this._messages.push({
                role: ChatRole.User,
                content,
                createdAt: new Date(),
                origin: origin ?? ChatMessageOrigin.User
            });
        });
    }

    async assistant(
        content: string,
        tool_calls?: ToolCall[],
        origin?: ChatMessageOrigin
    ): Promise<void> {
        await this._mutex.runExclusive(() => {
            this._messages.push({
                role: ChatRole.Assistant,
                content,
                createdAt: new Date(),
                origin: origin ?? ChatMessageOrigin.Model,
                ...(tool_calls ? { tool_calls } : {})
            });
        });
    }

    async tool(content: string, tool_call_id: string, origin?: ChatMessageOrigin): Promise<void> {
        await this._mutex.runExclusive(() => {
            this._messages.push({
                role: ChatRole.Tool,
                content,
                tool_call_id,
                createdAt: new Date(),
                origin: origin ?? ChatMessageOrigin.Tool
            });
        });
    }

    async reasoning(content: string, origin?: ChatMessageOrigin): Promise<void> {
        await this._mutex.runExclusive(() => {
            this._messages.push({
                role: ChatRole.Reasoning,
                content,
                createdAt: new Date(),
                origin: origin ?? ChatMessageOrigin.User
            });
        });
    }

    async clear(): Promise<ChatMessage[]> {
        return this._mutex.runExclusive(() => this._messages.splice(0));
    }
}
