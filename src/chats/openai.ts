import OpenAI from 'openai';
import type {
    ChatCompletionMessageParam,
    ChatCompletionCreateParamsStreaming
} from 'openai/resources/chat/completions';
import { envInt, envFloat, envString } from '../env.js';
import { ChatMessage, ChatRole } from './chat.js';
import { ChatService, ChatServiceConfiguration, StreamEvent, StreamEventType } from './service.js';
import { FinishReason } from './chat.js';

/** Configuration for {@link OpenAIChatService}. Most fields can be set via environment variables. */
export class OpenAIChatServiceConfiguration {
    /** The OpenAI model to use (env: `LLM_CHAT_OPENAI_DEFAULT_MODEL`). */
    model?: string = envString('LLM_CHAT_OPENAI_DEFAULT_MODEL', '') || undefined;
    /** Sampling temperature (env: `LLM_CHAT_OPENAI_TEMPERATURE`). */
    temperature?: number = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_TEMPERATURE'];
        if (raw === undefined || raw === '') return undefined;
        const n = envFloat('LLM_CHAT_OPENAI_TEMPERATURE', NaN);
        return Number.isNaN(n) ? undefined : n;
    })();
    /** Max output tokens (env: `LLM_CHAT_OPENAI_MAX_TOKENS`). Superseded by {@link maxCompletionTokens} when both are set. */
    maxTokens?: number = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_MAX_TOKENS'];
        if (raw === undefined || raw === '') return undefined;
        const n = envInt('LLM_CHAT_OPENAI_MAX_TOKENS', 0, 0);
        return n || undefined;
    })();
    /** Max completion tokens (env: `LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS`). Takes precedence over {@link maxTokens}. */
    maxCompletionTokens?: number = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS'];
        if (raw === undefined || raw === '') return undefined;
        const n = envInt('LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS', 0, 0);
        return n || undefined;
    })();
    /** Stop sequences. */
    stop?: string | string[];
    /** Top-p nucleus sampling (env: `LLM_CHAT_OPENAI_TOP_P`). */
    topP?: number = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_TOP_P'];
        if (raw === undefined || raw === '') return undefined;
        const n = envFloat('LLM_CHAT_OPENAI_TOP_P', NaN);
        return Number.isNaN(n) ? undefined : n;
    })();
    /** Filter out reasoning messages before sending (default: `true`). */
    filterReasoning?: boolean = true;
    /** Prepend each message with a local ISO timestamp (default: `false`). */
    prefixWithTimestamp?: boolean = false;
}

function toFinishReason(raw: string | null | undefined): FinishReason | null {
    switch (raw) {
        case 'stop':
            return FinishReason.Stop;
        case 'tool_calls':
            return FinishReason.ToolCalls;
        case 'length':
            return FinishReason.Length;
        default:
            return null;
    }
}

function toLocalISOString(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const y = d.getFullYear();
    const mo = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const h = pad(d.getHours());
    const mi = pad(d.getMinutes());
    const s = pad(d.getSeconds());
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const tzH = pad(Math.floor(Math.abs(off) / 60));
    const tzM = pad(Math.abs(off) % 60);
    return `${y}-${mo}-${dd}T${h}:${mi}:${s}.${ms}${sign}${tzH}:${tzM}`;
}

function toOpenAIMessages(
    messages: ChatMessage[],
    filterReasoning: boolean,
    prefixWithTimestamp: boolean
): ChatCompletionMessageParam[] {
    return messages
        .filter((msg) => !filterReasoning || msg.role !== ChatRole.Reasoning)
        .map((msg): ChatCompletionMessageParam => {
            const content = prefixWithTimestamp
                ? `${toLocalISOString(msg.createdAt)}: ${msg.content}`
                : msg.content;
            const base = { content } as Record<string, unknown>;
            switch (msg.role) {
                case ChatRole.System:
                    return { ...base, role: 'system' } as ChatCompletionMessageParam;
                case ChatRole.User:
                    return { ...base, role: 'user' } as ChatCompletionMessageParam;
                case ChatRole.Assistant:
                    return {
                        ...base,
                        role: 'assistant',
                        tool_calls: msg.tool_calls
                    } as ChatCompletionMessageParam;
                case ChatRole.Tool:
                    return {
                        ...base,
                        role: 'tool',
                        tool_call_id: msg.tool_call_id!
                    } as ChatCompletionMessageParam;
                case ChatRole.Reasoning:
                    return { ...base, role: 'assistant' } as ChatCompletionMessageParam;
                default:
                    throw new Error(`Unexpected role: ${msg.role}`);
            }
        });
}

/** OpenAI provider. Extends {@link ChatService} with OpenAI-compatible streaming. */
export class OpenAIChatService extends ChatService {
    /**
     * @param api         - OpenAI client instance (defaults to `new OpenAI()`).
     * @param openAIConfig - Configuration for model, temperature, etc.
     * @param config      - Base service configuration (prompt files, tool rounds, etc.).
     */
    constructor(
        private api: OpenAI = new OpenAI(),
        private openAIConfig: OpenAIChatServiceConfiguration = new OpenAIChatServiceConfiguration(),
        config?: ChatServiceConfiguration
    ) {
        super(config);
        if (!this.openAIConfig.model) {
            throw new Error(
                'No model provided. Pass a model in OpenAIChatServiceConfiguration or set the LLM_CHAT_OPENAI_DEFAULT_MODEL environment variable.'
            );
        }
    }

    protected async *createStream(): AsyncIterable<StreamEvent> {
        const chatMessages = this.chatImpl.messages();
        const systemMessage = this.chatImpl.getSystem();
        const allMessages = systemMessage ? [systemMessage, ...chatMessages] : chatMessages;
        const messages = toOpenAIMessages(
            allMessages,
            this.openAIConfig.filterReasoning ?? true,
            this.openAIConfig.prefixWithTimestamp ?? false
        );
        const openaiTools = this._tools.getTools();

        const stream = await this.api.chat.completions.create({
            model: this.openAIConfig.model!,
            messages,
            ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
            ...(this.openAIConfig?.temperature !== undefined
                ? { temperature: this.openAIConfig.temperature }
                : {}),
            ...(this.openAIConfig?.maxCompletionTokens !== undefined
                ? { max_completion_tokens: this.openAIConfig.maxCompletionTokens }
                : this.openAIConfig?.maxTokens !== undefined
                  ? { max_tokens: this.openAIConfig.maxTokens }
                  : {}),
            ...(this.openAIConfig?.stop !== undefined ? { stop: this.openAIConfig.stop } : {}),
            ...(this.openAIConfig?.topP !== undefined ? { top_p: this.openAIConfig.topP } : {}),
            stream: true
        } as ChatCompletionCreateParamsStreaming);

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
                yield { type: StreamEventType.Content, text: delta.content };
            }

            const reasoning = (delta as Record<string, unknown>)['reasoning_content'];
            if (typeof reasoning === 'string') {
                yield { type: StreamEventType.Reasoning, text: reasoning };
            }

            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    yield {
                        type: StreamEventType.ToolCallDelta,
                        index: tc.index,
                        ...(tc.id ? { id: tc.id } : {}),
                        ...(tc.function?.name ? { name: tc.function.name } : {}),
                        ...(tc.function?.arguments ? { arguments: tc.function.arguments } : {})
                    } as StreamEvent;
                }
            }

            const reason = toFinishReason(chunk.choices[0]?.finish_reason);
            if (reason !== null) {
                yield { type: StreamEventType.Finish, reason };
            }
        }
    }
}
