import OpenAI from 'openai';
import type {
    ChatCompletionMessageParam,
    ChatCompletionCreateParamsStreaming
} from 'openai/resources/chat/completions';
import { ChatMessage, ChatRole } from './chat.js';
import { ChatService, ChatServiceConfiguration, StreamEvent, StreamEventType } from './service.js';
import { FinishReason } from './chat.js';

export class OpenAIChatServiceConfiguration {
    model?: string = process.env.LLM_CHAT_OPENAI_DEFAULT_MODEL || undefined;
    temperature?: number = parseEnvFloat('LLM_CHAT_OPENAI_TEMPERATURE');
    maxTokens?: number = parseEnvInt('LLM_CHAT_OPENAI_MAX_TOKENS');
    maxCompletionTokens?: number = parseEnvInt('LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS');
    stop?: string | string[];
    topP?: number = parseEnvFloat('LLM_CHAT_OPENAI_TOP_P');
    filterReasoning?: boolean = true;
}

function parseEnvInt(key: string): number | undefined {
    const raw = process.env[key];
    if (raw === undefined || raw === '') return undefined;
    const n = parseInt(raw, 10);
    return isNaN(n) ? undefined : n;
}

function parseEnvFloat(key: string): number | undefined {
    const raw = process.env[key];
    if (raw === undefined || raw === '') return undefined;
    const n = parseFloat(raw);
    return isNaN(n) ? undefined : n;
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

function toOpenAIMessages(
    messages: ChatMessage[],
    filterReasoning: boolean
): ChatCompletionMessageParam[] {
    return messages
        .filter((msg) => !filterReasoning || msg.role !== ChatRole.Reasoning)
        .map((msg): ChatCompletionMessageParam => {
            const base = { content: msg.content } as Record<string, unknown>;
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

    protected async *createStream(): AsyncIterable<StreamEvent> {
        const messages = toOpenAIMessages(
            this.chatImpl.getMessages(),
            this.openAIConfig.filterReasoning ?? true
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
