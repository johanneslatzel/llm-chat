import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { FinishReason, OpenAIChatService, OpenAIChatServiceConfiguration, ChatServiceConfiguration, Tool, ToolParameters, ResultStatus, type PartialToolResult } from '../../../src/index.js';
import { createMockOpenAI, createMockOpenAIWithError, MockChunk, createChunk } from '../../index.js';

class TestOpenAITool extends Tool {
    constructor() {
        super('test_tool', 'A test tool', new ToolParameters({}));
    }
    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return { result: 'ok', status: ResultStatus.Success };
    }
}

function makeChunks(chunks: MockChunk[]) {
    return chunks;
}

describe('OpenAIChatService', () => {
    let config: ChatServiceConfiguration;

    beforeEach(() => {
        config = new ChatServiceConfiguration();
        config.userPromptPaths = [];
    });

    describe('stream creation', () => {
        it('yields content events from text deltas', async () => {
            const mockChunks = makeChunks([
                { content: 'Hello' },
                { content: ' World' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);

            const events: any[] = [];
            for await (const event of (service as any).createStream()) {
                events.push(event);
            }

            expect(events).toHaveLength(3);
            expect(events[0]!.type).toBe('content');
            expect(events[0]!.text).toBe('Hello');
            expect(events[1]!.type).toBe('content');
            expect(events[1]!.text).toBe(' World');
            expect(events[2]!.type).toBe('finish');
            expect(events[2]!.reason).toBe(FinishReason.Stop);
        });

        it('yields reasoning events from reasoning_content', async () => {
            const mockChunks = makeChunks([
                { reasoning_content: 'Let me think...' },
                { content: 'Answer' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);

            const events: any[] = [];
            for await (const event of (service as any).createStream()) {
                events.push(event);
            }

            const reasoningEvents = events.filter((e) => e.type === 'reasoning');
            expect(reasoningEvents).toHaveLength(1);
            expect(reasoningEvents[0]!.text).toBe('Let me think...');
        });

        it('yields tool call delta events', async () => {
            const mockChunks = makeChunks([
                {
                    tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather' } }],
                },
                {
                    tool_calls: [{ index: 0, function: { arguments: '{"city":' } }],
                },
                {
                    tool_calls: [{ index: 0, function: { arguments: JSON.stringify({city: 'London'}) } }],
                },
                { finish_reason: 'tool_calls' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);

            const events: any[] = [];
            for await (const event of (service as any).createStream()) {
                events.push(event);
            }

            const deltas = events.filter((e) => e.type === 'tool_call_delta');
            expect(deltas).toHaveLength(3);
            expect(deltas[0]!.id).toBe('call_1');
            expect(deltas[0]!.name).toBe('get_weather');
            expect(deltas[2]!.arguments).toBe(JSON.stringify({city: 'London'}));
        });

        it('skips empty delta chunks', async () => {
            const mockChunks = makeChunks([
                {},
                { content: 'Hello' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);

            const events: any[] = [];
            for await (const event of (service as any).createStream()) {
                events.push(event);
            }

            expect(events).toHaveLength(2);
        });

        it('skips chunk when choices[0].delta is null', async () => {
            const nullDeltaChunk = {
                id: 'test',
                object: 'chat.completion.chunk',
                created: 123,
                model: 'test-model',
                choices: [{ index: 0, delta: null, finish_reason: null }],
                usage: null
            } as unknown as ChatCompletionChunk;

            const helloChunk = createChunk({ content: 'Hello' });

            const stream = {
                [Symbol.asyncIterator]() {
                    const items = [nullDeltaChunk, helloChunk];
                    let i = 0;
                    return {
                        next: async () => {
                            if (i >= items.length) return { done: true, value: undefined as unknown as ChatCompletionChunk };
                            return { done: false, value: items[i++]! };
                        }
                    };
                }
            };

            const mock = vi.fn().mockReturnValue(Promise.resolve(stream));
            const api = { apiKey: 'test', chat: { completions: { create: mock } } } as any;
            const service = new OpenAIChatService(api, { model: 'test-model' }, config);

            const events: any[] = [];
            for await (const event of (service as any).createStream()) {
                events.push(event);
            }

            expect(events).toHaveLength(1);
            expect(events[0]!.type).toBe('content');
            expect(events[0]!.text).toBe('Hello');
        });

        it('handles tool_calls finish reason', async () => {
            const mockChunks = makeChunks([
                { finish_reason: 'tool_calls' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);

            const events: any[] = [];
            for await (const event of (service as any).createStream()) {
                events.push(event);
            }

            expect(events[0]!.type).toBe('finish');
            expect(events[0]!.reason).toBe(FinishReason.ToolCalls);
        });

        it('handles length finish reason', async () => {
            const mockChunks = makeChunks([
                { finish_reason: 'length' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);

            const events: any[] = [];
            for await (const event of (service as any).createStream()) {
                events.push(event);
            }

            expect(events[0]!.reason).toBe(FinishReason.Length);
        });
    });

    describe('message conversion', () => {
        it('passes messages to OpenAI API', async () => {
            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);
            await service.chatImpl.system('You are a bot');
            await service.chatImpl.user('Hello');

            await (service as any).createStream().next();

            expect(mock.chat.completions.create).toHaveBeenCalledTimes(1);
            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.model).toBe('test-model');
            expect(callArgs.messages).toHaveLength(2);
            expect(callArgs.messages[0].role).toBe('system');
            expect(callArgs.messages[1].role).toBe('user');
            expect(callArgs.stream).toBe(true);
        });

        it('does not include tools key when no tools registered', async () => {
            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);

            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.tools).toBeUndefined();
        });

        it('includes tool definitions when tools are registered', async () => {
            const mockChunks = makeChunks([
                { content: 'Done' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);
            service.tools().add(new TestOpenAITool());

            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.tools).toHaveLength(1);
            expect(callArgs.tools[0].function.name).toBe('test_tool');
        });
    });

    describe('OpenAIChatServiceConfiguration', () => {
        it('reads temperature from env', () => {
            vi.stubEnv('LLM_CHAT_OPENAI_TEMPERATURE', '0.7');
            const cfg = new OpenAIChatServiceConfiguration();
            expect(cfg.temperature).toBe(0.7);
            vi.unstubAllEnvs();
        });

        it('reads maxTokens from env', () => {
            vi.stubEnv('LLM_CHAT_OPENAI_MAX_TOKENS', '2048');
            const cfg = new OpenAIChatServiceConfiguration();
            expect(cfg.maxTokens).toBe(2048);
            vi.unstubAllEnvs();
        });

        it('reads maxCompletionTokens from env', () => {
            vi.stubEnv('LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS', '4096');
            const cfg = new OpenAIChatServiceConfiguration();
            expect(cfg.maxCompletionTokens).toBe(4096);
            vi.unstubAllEnvs();
        });

        it('reads topP from env', () => {
            vi.stubEnv('LLM_CHAT_OPENAI_TOP_P', '0.9');
            const cfg = new OpenAIChatServiceConfiguration();
            expect(cfg.topP).toBe(0.9);
            vi.unstubAllEnvs();
        });

        it('returns undefined for missing env vars', () => {
            vi.stubEnv('LLM_CHAT_OPENAI_TEMPERATURE', '');
            vi.stubEnv('LLM_CHAT_OPENAI_MAX_TOKENS', '');
            vi.stubEnv('LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS', '');
            vi.stubEnv('LLM_CHAT_OPENAI_TOP_P', '');
            const cfg = new OpenAIChatServiceConfiguration();
            expect(cfg.temperature).toBeUndefined();
            expect(cfg.maxTokens).toBeUndefined();
            expect(cfg.maxCompletionTokens).toBeUndefined();
            expect(cfg.topP).toBeUndefined();
            vi.unstubAllEnvs();
        });

        it('handles NaN env values gracefully', () => {
            vi.stubEnv('LLM_CHAT_OPENAI_TEMPERATURE', 'not-a-number');
            const cfg = new OpenAIChatServiceConfiguration();
            expect(cfg.temperature).toBeUndefined();
            vi.unstubAllEnvs();
        });

        it('handles NaN env values for maxTokens (parseEnvInt)', () => {
            vi.stubEnv('LLM_CHAT_OPENAI_MAX_TOKENS', 'not-a-number');
            const cfg = new OpenAIChatServiceConfiguration();
            expect(cfg.maxTokens).toBeUndefined();
            vi.unstubAllEnvs();
        });

        it('handles NaN env values for maxCompletionTokens (parseEnvInt)', () => {
            vi.stubEnv('LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS', 'not-a-number');
            const cfg = new OpenAIChatServiceConfiguration();
            expect(cfg.maxCompletionTokens).toBeUndefined();
            vi.unstubAllEnvs();
        });

        it('handles NaN env values for topP', () => {
            vi.stubEnv('LLM_CHAT_OPENAI_TOP_P', 'not-a-number');
            const cfg = new OpenAIChatServiceConfiguration();
            expect(cfg.topP).toBeUndefined();
            vi.unstubAllEnvs();
        });
    });

    describe('toFinishReason mapping', () => {
        it('maps "stop" to Stop finish reason', async () => {
            const mockChunks = makeChunks([
                { content: 'Hello', finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);
            const events: any[] = [];
            for await (const event of (service as any).createStream()) {
                events.push(event);
            }
            expect(events[1]!.reason).toBe(FinishReason.Stop);
        });
    });

    describe('openAIConfig parameters', () => {
        it('passes temperature to API call', async () => {
            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const openAIConfig = new OpenAIChatServiceConfiguration();
            openAIConfig.model = 'test-model';
            openAIConfig.temperature = 0.7;
            const service = new OpenAIChatService(mock, openAIConfig, config);

            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.temperature).toBe(0.7);
        });

        it('passes maxCompletionTokens to API call', async () => {
            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const openAIConfig = new OpenAIChatServiceConfiguration();
            openAIConfig.model = 'test-model';
            openAIConfig.maxCompletionTokens = 4096;
            const service = new OpenAIChatService(mock, openAIConfig, config);

            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.max_completion_tokens).toBe(4096);
        });

        it('passes maxTokens when maxCompletionTokens is not set', async () => {
            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const openAIConfig = new OpenAIChatServiceConfiguration();
            openAIConfig.model = 'test-model';
            openAIConfig.maxTokens = 2048;
            const service = new OpenAIChatService(mock, openAIConfig, config);

            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.max_tokens).toBe(2048);
            expect(callArgs.max_completion_tokens).toBeUndefined();
        });

        it('passes stop sequences to API call', async () => {
            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const openAIConfig = new OpenAIChatServiceConfiguration();
            openAIConfig.model = 'test-model';
            openAIConfig.stop = ['END', 'STOP'];
            const service = new OpenAIChatService(mock, openAIConfig, config);

            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.stop).toEqual(['END', 'STOP']);
        });

        it('passes topP to API call', async () => {
            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const openAIConfig = new OpenAIChatServiceConfiguration();
            openAIConfig.model = 'test-model';
            openAIConfig.topP = 0.9;
            const service = new OpenAIChatService(mock, openAIConfig, config);

            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.top_p).toBe(0.9);
        });
    });

    describe('toLocalISOString negative offset', () => {
        it('uses negative sign for timezone offset when west of UTC', async () => {
            const mockGetTimezoneOffset = vi.fn(() => 480);
            vi.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(mockGetTimezoneOffset);

            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(
                mock,
                { model: 'test-model', prefixWithTimestamp: true },
                config
            );
            await service.chatImpl.user('Hello');
            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            const sentContent: string = callArgs.messages[0].content;
            expect(sentContent).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-\d{2}:\d{2}: Hello$/);

            vi.restoreAllMocks();
        });
    });

    describe('message conversion - all roles', () => {
        it('converts assistant and tool messages', async () => {
            const mockChunks = makeChunks([
                { content: 'Final' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);
            await service.chatImpl.system('System');
            await service.chatImpl.user('User');
            await service.chatImpl.assistant('Assistant reply', [{ id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } }]);
            await service.chatImpl.tool('Tool result', 'call_1');

            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.messages).toHaveLength(4);
            expect(callArgs.messages[0].role).toBe('system');
            expect(callArgs.messages[1].role).toBe('user');
            expect(callArgs.messages[2].role).toBe('assistant');
            expect(callArgs.messages[2].tool_calls).toBeDefined();
            expect(callArgs.messages[3].role).toBe('tool');
            expect(callArgs.messages[3].tool_call_id).toBe('call_1');
        });

        it('converts reasoning messages to assistant role when filterReasoning is false', async () => {
            const openAIConfig = new OpenAIChatServiceConfiguration();
            openAIConfig.model = 'test-model';
            openAIConfig.filterReasoning = false;

            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, openAIConfig, config);
            await service.chatImpl.reasoning('Let me think...');
            await service.chatImpl.user('Hello');

            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.messages).toHaveLength(2);
            expect(callArgs.messages[0].role).toBe('assistant');
            expect(callArgs.messages[0].content).toBe('Let me think...');
            expect(callArgs.messages[1].role).toBe('user');
        });

        it('filters out reasoning messages by default', async () => {
            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);
            await service.chatImpl.reasoning('Thinking...');
            await service.chatImpl.user('Hello');

            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            expect(callArgs.messages).toHaveLength(1);
            expect(callArgs.messages[0].role).toBe('user');
        });

        it('prefixes user content with local ISO timestamp when prefixWithTimestamp is true', async () => {
            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(
                mock,
                { model: 'test-model', prefixWithTimestamp: true },
                config
            );
            await service.chatImpl.user('Hello');
            await (service as any).createStream().next();

            const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
            const sentContent: string = callArgs.messages[0].content;
            expect(sentContent).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}: Hello$/);
        });

        it('throws for unknown role in toOpenAIMessages', async () => {
            const mockChunks = makeChunks([
                { content: 'Hi' },
                { finish_reason: 'stop' },
            ]);
            const mock = createMockOpenAI(mockChunks);
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);

            vi.spyOn(service.chatImpl, 'messages').mockReturnValue([
                { role: 'bogus_role' as any, content: 'test', createdAt: new Date() }
            ]);

            await expect((service as any).createStream().next()).rejects.toThrow('Unexpected role: bogus_role');
        });
    });

    describe('constructor', () => {
        it('throws when no model is configured', () => {
            const mock = createMockOpenAI([]);
            const emptyConfig = new OpenAIChatServiceConfiguration();
            emptyConfig.model = undefined as any;
            expect(() => new OpenAIChatService(mock, emptyConfig, config)).toThrow('model');
        });
    });

    describe('API error handling', () => {
        it('rejects when createStream fails', async () => {
            const mock = createMockOpenAIWithError(new Error('API rejected'));
            const service = new OpenAIChatService(mock, { model: 'test-model' }, config);
            await expect((service as any).createStream().next()).rejects.toThrow('API rejected');
        });
    });
});
