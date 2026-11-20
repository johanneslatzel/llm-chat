import { describe, expect, it } from 'vitest';
import {
    CharCountEstimator,
    ChatService,
    ChatServiceConfiguration,
    ChunkType,
    FinishReason,
    OpenAIChatService,
    OpenAIChatServiceConfiguration,
    OpenAIChatServiceBuilder,
    ResponseFormatType,
    StreamEventType,
    StructuredOutputError,
    StructuredOutputErrorReason,
    type JsonSchemaObject,
    type ResponseFormat,
    type StreamEvent
} from '../../../src/index.js';
import { createMockOpenAI } from '../../index.js';
import { createOpenAIConfig, makeChunks, TestOpenAITool } from '../../helper/openai-mocks.js';
import { TestChatService } from '../../helper/service-mocks.js';

const JSON_CHUNKS = [{ content: '{"ok":true}' }, { finish_reason: 'stop' as const }];

const JSON_SCHEMA: JsonSchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: ['ok'],
    properties: { ok: { type: 'boolean' } }
};

function makeService(responseFormat?: ResponseFormat) {
    const api = createMockOpenAI(makeChunks(JSON_CHUNKS));
    const openAIConfig = new OpenAIChatServiceConfiguration();
    openAIConfig.model = 'test-model';
    if (responseFormat !== undefined) {
        openAIConfig.responseFormat = responseFormat;
    }
    return {
        api,
        service: new OpenAIChatService(api, openAIConfig, createOpenAIConfig())
    };
}

function requestOf(api: ReturnType<typeof createMockOpenAI>) {
    return (api.chat.completions.create as any).mock.calls[0][0];
}

describe('structured output request mapping', () => {
    it('omits response_format by default', async () => {
        const { api, service } = makeService();
        await service.send();

        expect(requestOf(api).response_format).toBeUndefined();
    });

    it('sends a configured json_object response format', async () => {
        const { api, service } = makeService({ type: ResponseFormatType.JsonObject });
        await service.send();

        expect(requestOf(api).response_format).toEqual({ type: 'json_object' });
    });

    it('sends a configured json_schema response format verbatim', async () => {
        const format: ResponseFormat = {
            type: ResponseFormatType.JsonSchema,
            json_schema: {
                name: 'result',
                description: 'A structured result',
                schema: JSON_SCHEMA,
                strict: true
            }
        };
        const { api, service } = makeService(format);
        await service.send();

        expect(requestOf(api).response_format).toEqual(format);
    });

    it('sends a response format alongside tools', async () => {
        const { api, service } = makeService({ type: ResponseFormatType.JsonObject });
        service.tools().add(new TestOpenAITool());
        await service.send();

        expect(requestOf(api).response_format).toEqual({ type: 'json_object' });
        expect(requestOf(api).tools).toHaveLength(1);
    });

    it('sends a plain text response format when explicitly configured', async () => {
        const { api, service } = makeService({ type: ResponseFormatType.Text });
        await service.send();

        expect(requestOf(api).response_format).toEqual({ type: 'text' });
    });
});

describe('OpenAIChatServiceBuilder response formats', () => {
    it('sets json_object mode', async () => {
        const api = createMockOpenAI(makeChunks(JSON_CHUNKS));
        const service = OpenAIChatService.builder()
            .model('test-model')
            .withClient(api)
            .jsonObject()
            .create();

        await service.send();
        expect(requestOf(api).response_format).toEqual({ type: 'json_object' });
    });

    it('builds a full json_schema format', async () => {
        const api = createMockOpenAI(makeChunks(JSON_CHUNKS));
        const service = new OpenAIChatServiceBuilder()
            .model('test-model')
            .withClient(api)
            .jsonSchema({
                name: 'result',
                description: 'A structured result',
                schema: JSON_SCHEMA,
                strict: true
            })
            .create();

        await service.send();
        expect(requestOf(api).response_format).toEqual({
            type: 'json_schema',
            json_schema: {
                name: 'result',
                description: 'A structured result',
                schema: JSON_SCHEMA,
                strict: true
            }
        });
    });

    it('omits optional json_schema fields when unset', async () => {
        const api = createMockOpenAI(makeChunks(JSON_CHUNKS));
        const service = OpenAIChatService.builder()
            .model('test-model')
            .withClient(api)
            .jsonSchema({ name: 'result', schema: JSON_SCHEMA })
            .create();

        await service.send();
        const format = requestOf(api).response_format;
        expect(format).toEqual({
            type: 'json_schema',
            json_schema: { name: 'result', schema: JSON_SCHEMA }
        });
        expect(format.json_schema.description).toBeUndefined();
        expect(format.json_schema.strict).toBeUndefined();
    });

    it('accepts a raw response format and lets the last setter win', async () => {
        const api = createMockOpenAI(makeChunks(JSON_CHUNKS));
        const service = OpenAIChatService.builder()
            .model('test-model')
            .withClient(api)
            .jsonObject()
            .jsonSchema({ name: 'result', schema: JSON_SCHEMA, strict: false })
            .jsonObject()
            .create();

        await service.send();
        expect(requestOf(api).response_format).toEqual({ type: 'json_object' });
    });
});

async function makeServiceWithConfig(
    responseFormat?: ResponseFormat,
    userMessages: string[] = [],
    chunks = JSON_CHUNKS
) {
    const api = createMockOpenAI(makeChunks(chunks));
    const openAIConfig = new OpenAIChatServiceConfiguration();
    openAIConfig.model = 'test-model';
    if (responseFormat !== undefined) {
        openAIConfig.responseFormat = responseFormat;
    }
    const serviceConfig = new ChatServiceConfiguration();
    serviceConfig.systemPromptDir = '';
    serviceConfig.userPromptPaths = [];
    const service = new OpenAIChatService(api, openAIConfig, serviceConfig);
    for (const message of userMessages) {
        await service.chatImpl.user(message);
    }
    return { api, service };
}

function expectStructuredError(
    callback: () => unknown,
    reason: StructuredOutputError['reason']
): void {
    try {
        callback();
        throw new Error('Expected StructuredOutputError');
    } catch (error) {
        expect(error).toBeInstanceOf(StructuredOutputError);
        expect((error as StructuredOutputError).reason).toBe(reason);
    }
}

describe('structured result access', () => {
    it('returns the most recent assistant content', async () => {
        const { service } = makeService();
        await service.send();
        await service.chatImpl.assistant('later');

        expect(service.lastAssistantContent()).toBe('later');
    });

    it('returns undefined when no assistant message exists', () => {
        const { service } = makeService();
        expect(service.lastAssistantContent()).toBeUndefined();
    });

    it('parses the latest structured answer', async () => {
        const { service } = makeService();
        await service.send();

        expect(service.lastAssistantJson()).toEqual({ ok: true });
    });

    it('accumulates JSON split across content chunks', async () => {
        const { service } = await makeServiceWithConfig(undefined, [], [
            { content: '{"ok":' },
            { content: 'true}' },
            { finish_reason: 'stop' }
        ]);

        await service.send();

        expect(service.lastAssistantContent()).toBe('{"ok":true}');
        expect(service.lastAssistantJson()).toEqual({ ok: true });
    });

    it('falls back to the last assistant message when no summary exists', async () => {
        const { service } = makeService();
        await service.chatImpl.assistant('{"manual":true}');

        expect(service.lastAssistantJson()).toEqual({ manual: true });
    });

    it('returns undefined when the latest round has no content', async () => {
        const { service } = await makeServiceWithConfig(undefined, [], []);
        await service.chatImpl.assistant('{"old":true}');
        await service.send();

        expect(service.lastAssistantJson()).toBeUndefined();
    });

    it('returns undefined when only non-assistant messages exist', async () => {
        const { service } = await makeServiceWithConfig();
        await service.chatImpl.user('hi');

        expect(service.lastAssistantContent()).toBeUndefined();
        expect(service.lastAssistantJson()).toBeUndefined();
    });

    it('returns undefined when no assistant content exists', async () => {
        const { service } = await makeServiceWithConfig();
        expect(service.lastAssistantJson()).toBeUndefined();
    });

    it('creates a structured error without a cause', () => {
        const error = new StructuredOutputError(
            StructuredOutputErrorReason.Refused,
            'The model declined'
        );

        expect(error.reason).toBe(StructuredOutputErrorReason.Refused);
        expect(error.cause).toBeUndefined();
    });

    it('throws invalid_json for malformed content', async () => {
        const api = createMockOpenAI(makeChunks([{ content: '{' }, { finish_reason: 'stop' }]));
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        const serviceConfig = new ChatServiceConfiguration();
        serviceConfig.systemPromptDir = '';
        serviceConfig.userPromptPaths = [];
        const service = new OpenAIChatService(api, openAIConfig, serviceConfig);
        await service.send();

        expectStructuredError(
            () => service.lastAssistantJson(),
            StructuredOutputErrorReason.InvalidJson
        );
    });
});

describe('response-format token accounting', () => {
    it('counts the serialized response format', async () => {
        const format: ResponseFormat = { type: ResponseFormatType.JsonObject };
        const { service } = await makeServiceWithConfig(format, ['hello']);
        const estimator = new CharCountEstimator(1);

        expect(await service.estimateTokens(estimator)).toBe(
            'hello'.length + JSON.stringify(format).length
        );
    });

    it('counts only messages when no response format is configured', async () => {
        const { service } = await makeServiceWithConfig(undefined, ['hello']);
        const estimator = new CharCountEstimator(1);

        expect(await service.estimateTokens(estimator)).toBe('hello'.length);
    });

    it('counts the response format without any messages', async () => {
        const format: ResponseFormat = {
            type: ResponseFormatType.JsonSchema,
            json_schema: { name: 'result', schema: JSON_SCHEMA }
        };
        const { service } = await makeServiceWithConfig(format);
        const estimator = new CharCountEstimator(1);

        expect(await service.estimateTokens(estimator)).toBe(JSON.stringify(format).length);
    });
});

describe('refusals and incomplete structured output', () => {
    it('maps OpenAI refusal deltas to refusal events', async () => {
        const api = createMockOpenAI(
            makeChunks([{ refusal: 'I cannot help with that.' }, { finish_reason: 'stop' }])
        );
        const service = new OpenAIChatService(
            api,
            { model: 'test-model' },
            createOpenAIConfig()
        );

        const events: unknown[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        expect(events[0]).toEqual({
            type: StreamEventType.Refusal,
            text: 'I cannot help with that.'
        });
        expect(events[1]).toMatchObject({
            type: StreamEventType.Finish,
            reason: FinishReason.Stop
        });
    });

    it('records refusal chunks and summary text', async () => {
        const service = new TestChatService([
            { type: StreamEventType.Refusal, text: 'I cannot help with that.' },
            { type: StreamEventType.Finish, reason: FinishReason.Stop }
        ]);

        await service.send();

        expect(
            service.stream().chunks().some(
                (chunk) =>
                    chunk.type === ChunkType.Refusal &&
                    chunk.text === 'I cannot help with that.'
            )
        ).toBe(true);
        expect(service.stream().summary()[0]!.refusal).toBe('I cannot help with that.');
        expectStructuredError(
            () => service.lastAssistantJson(),
            StructuredOutputErrorReason.Refused
        );
    });

    it('records a refusal when the stream ends without a finish event', async () => {
        const service = new TestChatService([
            { type: StreamEventType.Refusal, text: 'No structured answer.' }
        ]);

        await service.send();

        expect(service.stream().summary()[0]!.finishReason).toBe(FinishReason.Stop);
        expect(service.stream().summary()[0]!.refusal).toBe('No structured answer.');
        expectStructuredError(
            () => service.lastAssistantJson(),
            StructuredOutputErrorReason.Refused
        );
    });

    it('maps content_filter to FinishReason.ContentFilter', async () => {
        const api = createMockOpenAI(
            makeChunks([{ content: 'partial' }, { finish_reason: 'content_filter' }])
        );
        const service = new OpenAIChatService(
            api,
            { model: 'test-model' },
            createOpenAIConfig()
        );

        const events: unknown[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        expect(events.at(-1)).toMatchObject({
            type: StreamEventType.Finish,
            reason: FinishReason.ContentFilter
        });
    });

    it('throws filtered for a content-filtered response', async () => {
        const service = new TestChatService([
            { type: StreamEventType.Content, text: 'partial' },
            { type: StreamEventType.Finish, reason: FinishReason.ContentFilter }
        ]);

        await service.send();

        expect(service.lastAssistantContent()).toBeUndefined();
        expectStructuredError(
            () => service.lastAssistantJson(),
            StructuredOutputErrorReason.Filtered
        );
    });

    it('throws incomplete for a length-truncated response', async () => {
        const service = new TestChatService([
            { type: StreamEventType.Content, text: '{"ok":' },
            { type: StreamEventType.Finish, reason: FinishReason.Length }
        ]);

        await service.send();

        expectStructuredError(
            () => service.lastAssistantJson(),
            StructuredOutputErrorReason.Incomplete
        );
    });

    it('throws incomplete for an aborted response', async () => {
        const service = new TestChatService([
            { type: StreamEventType.Content, text: '{"ok":' },
            { type: StreamEventType.Finish, reason: FinishReason.Aborted }
        ]);

        await service.send();

        expectStructuredError(
            () => service.lastAssistantJson(),
            StructuredOutputErrorReason.Incomplete
        );
    });

    it('records refusal text when an aborted stream had already emitted it', async () => {
        class AbortingRefusalService extends ChatService {
            constructor() {
                const config = new ChatServiceConfiguration();
                config.systemPromptDir = '';
                super(config);
            }

            protected async *createStream(signal?: AbortSignal): AsyncIterable<StreamEvent> {
                yield { type: StreamEventType.Refusal, text: 'No structured answer.' };
                await new Promise<void>((resolve) => {
                    if (signal?.aborted) resolve();
                    else signal?.addEventListener('abort', () => resolve());
                });
                throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
            }
        }

        const service = new AbortingRefusalService();
        const sendPromise = service.send();
        await new Promise(process.nextTick);
        service.interrupt();
        await sendPromise;

        const [refusal] = service.stream().summary();
        expect(service.stream().finishReason()).toBe(FinishReason.Aborted);
        expect(refusal?.refusal).toBe('No structured answer.');
    });
});
