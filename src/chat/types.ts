import type { HasHooks } from '../hooks/hook-builder.js';
import type { PromptContainer, ComponentJSON } from './system-prompt.js';
import type { ChatHookBuilder } from './hooks.js';

/** Role of a message sender in a chat conversation. */
export enum ChatRole {
    System = 'system',
    Developer = 'developer',
    User = 'user',
    Assistant = 'assistant',
    Tool = 'tool',
    Reasoning = 'reasoning'
}

/** Origin of a chat message (who or what added it to the conversation). */
export enum ChatMessageOrigin {
    User = 'user',
    Model = 'model',
    Hook = 'hook',
    Tool = 'tool',
    System = 'system'
}

/** Why a stream or response finished. */
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

/** A single message in a chat conversation. */
export type ChatMessage = {
    role: ChatRole;
    content: string;
    createdAt: Date;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
    origin: ChatMessageOrigin;
};

type ChatMessageJSON = Omit<ChatMessage, 'createdAt'> & { createdAt: string };

/** JSON-serialisable representation of a full chat (sans runtime state). */
export type ChatJSON = {
    sessionId?: string;
    systemPrompt: ComponentJSON | null;
    messages: ChatMessageJSON[];
};

/** The result of matching a message against a hook's regex filter, passed to the hook callback. */
export type ChatMatch = {
    message: ChatMessage;
    matches: RegExpExecArray;
};

/** Minimal interface for adding messages to a chat. Used by {@link ChatService} for provider callbacks. */
export interface MessageWriter {
    /** Append a user message. */
    user(content: string): Promise<void>;
    /** Append an assistant message, optionally with tool calls. */
    assistant(content: string, tool_calls?: ToolCall[]): Promise<void>;
    /** Append a tool result message. */
    tool(content: string, tool_call_id: string): Promise<void>;
    /** Append a reasoning message. */
    reasoning(content: string): Promise<void>;
}

/** Extended message writer used by hooks that track message origin. */
export interface HookMessageWriter {
    /** Append a user message with a custom origin. */
    user(content: string, origin: ChatMessageOrigin): Promise<void>;
    /** Append an assistant message with tool calls and a custom origin. */
    assistant(
        content: string,
        tool_calls: ToolCall[] | undefined,
        origin: ChatMessageOrigin
    ): Promise<void>;
    /** Append a tool result message with a custom origin. */
    tool(content: string, tool_call_id: string, origin: ChatMessageOrigin): Promise<void>;
    /** Append a reasoning message with a custom origin. */
    reasoning(content: string, origin: ChatMessageOrigin): Promise<void>;
}

/** Core chat interface. Implementations manage a message buffer, system prompt, and hook lifecycle. */
export interface ChatInterface extends HasHooks<ChatHookBuilder>, MessageWriter {
    /** Access the system prompt tree. */
    system(): PromptContainer;
    /** Snapshot of all messages in the conversation. */
    messages(): ChatMessage[];
    /** Serialise the entire chat to JSON. */
    toJSON(): ChatJSON;
    /** The system message, or `null` if none is set. */
    getSystem(): ChatMessage | null;
    /** Access the hook builder to register message hooks. */
    hook(): ChatHookBuilder;
    /** Remove all messages and optionally hooks. */
    clear(retainHooks?: boolean): void;
}
