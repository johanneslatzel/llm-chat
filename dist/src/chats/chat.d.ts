import { Hook } from '../hooks/hook.js';
export declare enum ChatRole {
    System = "system",
    User = "user",
    Assistant = "assistant",
    Tool = "tool",
    Reasoning = "reasoning"
}
export declare enum FinishReason {
    Stop = "stop",
    ToolCalls = "tool_calls",
    Length = "length"
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
export interface ChatInterface {
    user(content: string): void;
    system(content: string): void;
    assistant(content: string, tool_calls?: ToolCall[]): void;
    tool(content: string, tool_call_id: string): void;
    messages(): ChatMessage[];
    toJSON(): ChatJSON;
    hook(): HookBuilder;
}
export declare enum ChatEvent {
    Message = "message",
    Reasoning = "reasoning",
    Chunk = "chunk",
    Finish = "finish"
}
type ChatEventMap = {
    [ChatEvent.Message]: [message: ChatMessage];
    [ChatEvent.Reasoning]: [content: string];
    [ChatEvent.Chunk]: [text: string];
    [ChatEvent.Finish]: [reason: FinishReason];
};
export declare class Chat implements ChatInterface {
    private systemMessage;
    private _messages;
    private listeners;
    system(content: string): void;
    user(content: string): void;
    assistant(content: string, tool_calls?: ToolCall[]): void;
    tool(content: string, tool_call_id: string): void;
    chunk(text: string): void;
    reasoning(content: string): void;
    finish(reason: FinishReason): void;
    getMessages(): ChatMessage[];
    messages(): ChatMessage[];
    clear(systemContent?: string): void;
    toJSON(): ChatJSON;
    static fromJSON(data: ChatJSON): Chat;
    on<E extends ChatEvent>(event: E, handler: (...args: ChatEventMap[E]) => void): void;
    off<E extends ChatEvent>(event: E, handler: (...args: ChatEventMap[E]) => void): void;
    hook(): HookBuilder;
    private emit;
}
export declare function chatFromJSON(data: ChatJSON): ChatInterface;
export declare class HookBuilder {
    private _chat;
    constructor(_chat: Chat);
    chunk(callback: (chat: ChatInterface, text: string) => void): Hook;
    reasoning(callback: (chat: ChatInterface, text: string) => void): Hook;
    finish(callback: (chat: ChatInterface, reason: FinishReason) => void): Hook;
    message(...roles: ChatRole[]): MessageHookBuilder;
}
export declare class MessageHookBuilder {
    private _chat;
    private _roles?;
    private _regex?;
    private _maxTriggers?;
    constructor(_chat: Chat, _roles?: ChatRole[] | undefined);
    regex(pattern: string | RegExp): this;
    maxTriggers(n: number): this;
    do(callback: (message: ChatMessage, matches: RegExpExecArray) => void): Hook;
}
export {};
//# sourceMappingURL=chat.d.ts.map