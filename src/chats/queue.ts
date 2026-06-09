import { Mutex } from 'async-mutex';
import { ChatMessage, ChatRole, MessageWriter, ToolCall } from './chat.js';

/** Thread-safe message queue backed by its own mutex. Implements {@link MessageWriter}. */
export class MessageQueue implements MessageWriter {
    private _messages: ChatMessage[] = [];
    private _mutex = new Mutex();

    async user(content: string): Promise<void> {
        await this._mutex.runExclusive(() => {
            this._messages.push({ role: ChatRole.User, content, createdAt: new Date() });
        });
    }

    async system(content: string): Promise<void> {
        await this._mutex.runExclusive(() => {
            this._messages.push({ role: ChatRole.System, content, createdAt: new Date() });
        });
    }

    async assistant(content: string, tool_calls?: ToolCall[]): Promise<void> {
        await this._mutex.runExclusive(() => {
            this._messages.push({
                role: ChatRole.Assistant,
                content,
                createdAt: new Date(),
                ...(tool_calls ? { tool_calls } : {})
            });
        });
    }

    async tool(content: string, tool_call_id: string): Promise<void> {
        await this._mutex.runExclusive(() => {
            this._messages.push({
                role: ChatRole.Tool,
                content,
                tool_call_id,
                createdAt: new Date()
            });
        });
    }

    async reasoning(content: string): Promise<void> {
        await this._mutex.runExclusive(() => {
            this._messages.push({ role: ChatRole.Reasoning, content, createdAt: new Date() });
        });
    }

    async addAll(messages: ChatMessage[]): Promise<void> {
        await this._mutex.runExclusive(() => this._messages.push(...messages));
    }

    async clear(): Promise<ChatMessage[]> {
        return this._mutex.runExclusive(() => this._messages.splice(0));
    }
}
