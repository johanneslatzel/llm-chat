import OpenAI from 'openai';
import type {
    ChatCompletionMessageParam,
    ChatCompletionCreateParamsStreaming
} from 'openai/resources/chat/completions';
import { ChatMessage, ChatMessageOrigin, ChatRole, FinishReason } from '../chat/types.js';
import { ChatService, ChatServiceConfiguration, StreamEvent, StreamEventType } from './service.js';
import { OpenAIChatServiceConfiguration } from './config.js';

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
    prefixWithTimestamp: boolean,
    mapSystemToDeveloper: boolean
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
                    return {
                        ...base,
                        role: mapSystemToDeveloper ? 'developer' : 'system'
                    } as ChatCompletionMessageParam;
                case ChatRole.Developer:
                    return { ...base, role: 'developer' } as ChatCompletionMessageParam;
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

/** OpenAI provider implementation of {@link ChatService}. */
export class OpenAIChatService extends ChatService {
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

    protected async *createStream(signal?: AbortSignal): AsyncIterable<StreamEvent> {
        const chatMessages = this.chatImpl.messages();
        const systemMessage = this.config.systemPrompt
            ? ({
                  role: ChatRole.System,
                  content: this.config.systemPrompt,
                  createdAt: new Date(),
                  origin: ChatMessageOrigin.System
              } as ChatMessage)
            : this.chatImpl.getSystem();
        const allMessages = systemMessage ? [systemMessage, ...chatMessages] : chatMessages;
        const messages = toOpenAIMessages(
            allMessages,
            this.openAIConfig.filterReasoning ?? true,
            this.openAIConfig.prefixWithTimestamp ?? false,
            this.openAIConfig.useDeveloperRole ?? false
        );
        const openaiTools = this._tools.getTools();

        const stream = await this.api.chat.completions.create(
            {
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
                ...(this.openAIConfig?.reasoningEffort !== undefined
                    ? { reasoning_effort: this.openAIConfig.reasoningEffort }
                    : {}),
                ...(this.openAIConfig?.toolChoice !== undefined
                    ? { tool_choice: this.openAIConfig.toolChoice }
                    : {}),
                ...(this.openAIConfig?.verbosity !== undefined
                    ? { verbosity: this.openAIConfig.verbosity }
                    : {}),
                stream: true
            } as ChatCompletionCreateParamsStreaming,
            { signal }
        );

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
                yield { type: StreamEventType.Content, text: delta.content };
            }

            // Reasoning appears in stream deltas across different providers.
            // Extract from whatever field is populated, in priority order:
            //   1. reasoning_details (structured array) — OpenRouter/Anthropic
            //   2. reasoning (plain string) — used by Ollama and others
            //   3. reasoning_content (plain string) — de facto standard:
            //      OpenAI, DeepSeek, vLLM, and most OpenAI-compatible providers
            // When both reasoning_details and a flat string appear in the same
            // chunk (some OpenRouter routes), the array is preferred to avoid
            // duplicate emission.
            const details = (delta as Record<string, unknown>)['reasoning_details'];
            if (Array.isArray(details)) {
                for (const d of details) {
                    if (
                        d?.type === 'reasoning.text' &&
                        typeof d.text === 'string' &&
                        d.text.length > 0
                    ) {
                        yield { type: StreamEventType.Reasoning, text: d.text };
                    } else if (
                        d?.type === 'reasoning.summary' &&
                        typeof d.summary === 'string' &&
                        d.summary.length > 0
                    ) {
                        yield { type: StreamEventType.Reasoning, text: d.summary };
                    }
                }
            } else {
                const flat =
                    (delta as Record<string, unknown>)['reasoning'] ??
                    (delta as Record<string, unknown>)['reasoning_content'];
                if (typeof flat === 'string' && flat.length > 0) {
                    yield { type: StreamEventType.Reasoning, text: flat };
                }
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
