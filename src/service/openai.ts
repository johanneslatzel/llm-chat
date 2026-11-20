import OpenAI from 'openai';
import type {
    ChatCompletionMessageParam,
    ChatCompletionCreateParamsStreaming
} from 'openai/resources/chat/completions';
import { ChatMessage, ChatRole, FinishReason } from '../chat/types.js';
import type { TokenEstimator } from '../chat/token-estimator.js';
import { ChatService, ChatServiceConfiguration, StreamEvent, StreamEventType } from './service.js';
import { OpenAIChatServiceConfiguration } from './config.js';
import type { CompletionUsage } from './stream-types.js';
import { ResponseFormatType } from './response-format.js';
import type { JsonSchemaResponseOptions, ResponseFormat } from './response-format.js';

/** Legacy request parameter for providers that do not support `max_completion_tokens`. */
interface LegacyMaxTokensParameter {
    max_tokens: number;
}

function toFinishReason(raw: string | null | undefined): FinishReason | null {
    switch (raw) {
        case 'stop':
            return FinishReason.Stop;
        case 'tool_calls':
            return FinishReason.ToolCalls;
        case 'length':
            return FinishReason.Length;
        case 'content_filter':
            return FinishReason.ContentFilter;
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
    messages: readonly ChatMessage[],
    contentOf: (message: ChatMessage) => string,
    mapSystemToDeveloper: boolean
): ChatCompletionMessageParam[] {
    return messages.map((msg): ChatCompletionMessageParam => {
        const content = contentOf(msg);
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
    /** Create a fluent builder for a new service. */
    static builder(): OpenAIChatServiceBuilder {
        return new OpenAIChatServiceBuilder();
    }

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

    /**
     * Drop stored reasoning messages when {@link filterReasoning} is enabled,
     * matching the messages {@link createStream} sends.
     */
    protected shouldSendMessage(message: ChatMessage): boolean {
        return !(this.openAIConfig.filterReasoning ?? true) || message.role !== ChatRole.Reasoning;
    }

    /**
     * Apply the configured timestamp prefix to the content sent to the provider.
     */
    protected toOutgoingContent(message: ChatMessage): string {
        return (this.openAIConfig.prefixWithTimestamp ?? false)
            ? `${toLocalISOString(message.createdAt)}: ${message.content}`
            : message.content;
    }

    /**
     * Reserve the configured output budget for the proactive
     * {@link isContextWindowExceeded} check only; this value is not part of
     * {@link estimateTokens}. This is a very loose upper bound: it returns the
     * configured `maxCompletionTokens`/`maxTokens`, not the expected response
     * length. Mirrors the precedence used by {@link createStream}.
     */
    protected estimateCompletionTokens(): number {
        return this.openAIConfig.maxCompletionTokens ?? this.openAIConfig.maxTokens ?? 0;
    }

    /**
     * Count the serialized response format as provider input tokens. The schema
     * is part of the request even though it is not a chat message.
     */
    protected estimateRequestTokens(estimator: TokenEstimator): number {
        const format = this.openAIConfig.responseFormat;
        return format === undefined ? 0 : estimator.estimate(JSON.stringify(format));
    }

    protected async *createStream(signal?: AbortSignal): AsyncIterable<StreamEvent> {
        const chatMessages = this.chatImpl._rawMessages();
        const systemMessage = this.chatImpl.getSystem();
        const allMessages = systemMessage ? [systemMessage, ...chatMessages] : chatMessages;
        const messages = toOpenAIMessages(
            allMessages.filter((message) => this.shouldSendMessage(message)),
            (message) => this.toOutgoingContent(message),
            this.openAIConfig.useDeveloperRole ?? false
        );
        const openaiTools = this._tools.getTools();
        const legacyMaxTokens: LegacyMaxTokensParameter | undefined =
            this.openAIConfig?.maxTokens !== undefined
                ? { max_tokens: this.openAIConfig.maxTokens }
                : undefined;

        const stream = await this.api.chat.completions.create(
            {
                model: this.openAIConfig.model!,
                messages,
                ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
                ...(this.openAIConfig?.responseFormat !== undefined
                    ? { response_format: this.openAIConfig.responseFormat }
                    : {}),
                ...(this.openAIConfig?.temperature !== undefined
                    ? { temperature: this.openAIConfig.temperature }
                    : {}),
                ...(this.openAIConfig?.maxCompletionTokens !== undefined
                    ? { max_completion_tokens: this.openAIConfig.maxCompletionTokens }
                    : (legacyMaxTokens ?? {})),
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
                ...(this.openAIConfig?.includeUsage
                    ? { stream_options: { include_usage: true } }
                    : {}),
                stream: true
            } as ChatCompletionCreateParamsStreaming,
            { signal }
        );

        let finishReason: FinishReason | null = null;
        let usage: CompletionUsage | undefined;

        for await (const chunk of stream) {
            if (chunk.usage) usage = chunk.usage;

            const choice = chunk.choices[0];
            const reason = toFinishReason(choice?.finish_reason);
            if (reason !== null) finishReason = reason;

            const delta = choice?.delta;
            if (!delta) continue;

            if (delta.content) {
                yield { type: StreamEventType.Content, text: delta.content };
            }

            const refusal = (delta as Record<string, unknown>)['refusal'];
            if (typeof refusal === 'string' && refusal.length > 0) {
                yield { type: StreamEventType.Refusal, text: refusal };
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
        }

        if (usage) {
            yield { type: StreamEventType.Usage, usage };
        }

        if (finishReason !== null) {
            yield { type: StreamEventType.Finish, reason: finishReason };
        }
    }
}

/** Fluent builder for {@link OpenAIChatService}. */
export class OpenAIChatServiceBuilder {
    private _api: OpenAI | undefined;
    private _openAIConfig = new OpenAIChatServiceConfiguration();
    private _serviceConfig = new ChatServiceConfiguration();

    /** Set the model name sent to the API. */
    model(model: string): this {
        this._openAIConfig.model = model;
        return this;
    }

    /** Set the sampling temperature. */
    temperature(value: number): this {
        this._openAIConfig.temperature = value;
        return this;
    }

    /** Set the legacy `max_tokens` limit. */
    maxTokens(value: number): this {
        this._openAIConfig.maxTokens = value;
        return this;
    }

    /** Set the `max_completion_tokens` limit for reasoning models. */
    maxCompletionTokens(value: number): this {
        this._openAIConfig.maxCompletionTokens = value;
        return this;
    }

    /** Set a flat system prompt. Overrides any previously configured file. */
    systemPrompt(content: string): this {
        this._serviceConfig.systemPrompt = content;
        delete this._serviceConfig.systemPromptFile;
        return this;
    }

    /** Load the system prompt from a file during {@link ChatService.init}.
     *  Overrides any previously configured flat prompt. */
    systemPromptFile(path: string): this {
        this._serviceConfig.systemPromptFile = path;
        delete this._serviceConfig.systemPrompt;
        return this;
    }

    /** Set a raw OpenAI-compatible `response_format` object. */
    responseFormat(format: ResponseFormat): this {
        this._openAIConfig.responseFormat = format;
        return this;
    }

    /** Enable JSON object mode. The prompt must instruct the model to return JSON. */
    jsonObject(): this {
        return this.responseFormat({ type: ResponseFormatType.JsonObject });
    }

    /** Enable Structured Outputs with the given JSON Schema. */
    jsonSchema(options: JsonSchemaResponseOptions): this {
        return this.responseFormat({
            type: ResponseFormatType.JsonSchema,
            json_schema: {
                name: options.name,
                ...(options.description !== undefined ? { description: options.description } : {}),
                schema: options.schema,
                ...(options.strict !== undefined ? { strict: options.strict } : {})
            }
        });
    }

    /** Use a preconfigured OpenAI client, for custom endpoints or tests. */
    withClient(api: OpenAI): this {
        this._api = api;
        return this;
    }

    /** Replace the OpenAI configuration. */
    withOpenAIConfig(config: OpenAIChatServiceConfiguration): this {
        this._openAIConfig = config;
        return this;
    }

    /** Replace the chat-service configuration. */
    withServiceConfig(config: ChatServiceConfiguration): this {
        this._serviceConfig = config;
        return this;
    }

    /** Create the service. */
    create(): OpenAIChatService {
        return new OpenAIChatService(this._api, this._openAIConfig, this._serviceConfig);
    }
}
