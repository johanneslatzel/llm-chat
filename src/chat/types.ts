import type { ChatMessage, MessageWriter } from '@johannes.latzel/llm-chat-message';
import type { HasHooks } from '@johannes.latzel/llm-chat-tool';
import type { PromptContainer, ComponentJSON } from './system-prompt.js';
import type { ChatHookBuilder } from './hooks.js';

type ChatMessageJSON = Omit<ChatMessage, 'createdAt'> & { createdAt: string };

/** JSON-serialisable representation of a full chat (sans runtime state). */
export type ChatJSON = {
    sessionId: string;
    systemPrompt: ComponentJSON | null;
    messages: ChatMessageJSON[];
};

/**
 * Strategy for compacting chat history during context window handoff.
 * The returned messages **must not** contain system-role messages —
 * `addAll` will throw if they do.
 */
export interface HandoffStrategy {
    /** Given the current chat, produce a compacted set of messages to replace the conversation history. */
    apply(chat: ChatInterface): ChatMessage[];
}

/** Core chat interface. Implementations manage a message buffer, system prompt, and hook lifecycle. */
export interface ChatInterface extends HasHooks<ChatHookBuilder>, MessageWriter {
    /** Unique session identifier (UUID) assigned on construction. */
    sessionId(): string;
    /** Access the system prompt tree. */
    system(): PromptContainer;
    /** Snapshot of all messages in the conversation. */
    messages(): ChatMessage[];
    /** Serialise the entire chat to JSON. */
    toJSON(): ChatJSON;
    /**
     * The effective system message: a service-installed override (a flat system
     * prompt configured on the service) when present, otherwise the composed
     * prompt tree. `null` when neither yields content.
     */
    getSystem(): ChatMessage | null;
    /** Access the hook builder to register message hooks. */
    hook(): ChatHookBuilder;
    /** Remove all messages (including historic), clear the system prompt, and optionally unregister hooks. */
    clear(retainHooks?: boolean): void;
    /** Suppress or re-enable message emission to listeners. */
    silent(enable: boolean): void;
    /** Remove all messages and historic messages, keeping the system prompt and listeners intact. */
    clearMessages(): void;
    /** Snapshot of historic messages accumulated during handoff operations. */
    historicMessages(): ChatMessage[];
    /**
     * Compact the conversation history using the given strategy.
     * Current messages are archived, then replaced with the strategy's output.
     * Hooks do not fire during the swap.
     */
    handoff(strategy: HandoffStrategy): Promise<void>;
}
