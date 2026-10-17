import { describe, it, expect, vi } from 'vitest';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { FinishReason, OpenAIChatService } from '../../../src/index.js';
import { createMockOpenAI, createChunk } from '../../index.js';
import { makeChunks } from '../../helper/openai-mocks.js';
import { createOpenAIConfig } from '../../helper/openai-mocks.js';

describe('OpenAIChatService stream creation', () => {
    it('yields content events from text deltas', async () => {
        const mockChunks = makeChunks([
            { content: 'Hello' },
            { content: ' World' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

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
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        const reasoningEvents = events.filter((e) => e.type === 'reasoning');
        expect(reasoningEvents).toHaveLength(1);
        expect(reasoningEvents[0]!.text).toBe('Let me think...');
    });

    it('yields reasoning events from reasoning string field', async () => {
        const mockChunks = makeChunks([
            { reasoning: 'Thinking step by step...' },
            { content: 'Answer' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        const reasoningEvents = events.filter((e) => e.type === 'reasoning');
        expect(reasoningEvents).toHaveLength(1);
        expect(reasoningEvents[0]!.text).toBe('Thinking step by step...');
    });

    it('yields reasoning events from reasoning_details array', async () => {
        const mockChunks = makeChunks([
            { reasoning_details: [{ type: 'reasoning.text', text: 'Let me analyze...' }] },
            { content: 'Answer' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        const reasoningEvents = events.filter((e) => e.type === 'reasoning');
        expect(reasoningEvents).toHaveLength(1);
        expect(reasoningEvents[0]!.text).toBe('Let me analyze...');
    });

    it('yields reasoning events from reasoning_details summary type', async () => {
        const mockChunks = makeChunks([
            { reasoning_details: [{ type: 'reasoning.summary', summary: 'Summarized reasoning' }] },
            { content: 'Answer' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        const reasoningEvents = events.filter((e) => e.type === 'reasoning');
        expect(reasoningEvents).toHaveLength(1);
        expect(reasoningEvents[0]!.text).toBe('Summarized reasoning');
    });

    it('prioritizes reasoning_details over reasoning when both present', async () => {
        const mockChunks = makeChunks([
            {
                reasoning: 'This should be ignored',
                reasoning_details: [{ type: 'reasoning.text', text: 'This should be used' }],
            },
            { content: 'Answer' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        const reasoningEvents = events.filter((e) => e.type === 'reasoning');
        expect(reasoningEvents).toHaveLength(1);
        expect(reasoningEvents[0]!.text).toBe('This should be used');
    });

    it('skips reasoning_details encrypted type', async () => {
        const mockChunks = makeChunks([
            { reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque-blob' }] },
            { content: 'Answer' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        const reasoningEvents = events.filter((e) => e.type === 'reasoning');
        expect(reasoningEvents).toHaveLength(0);
    });

    it('emits multiple reasoning_details items in one chunk', async () => {
        const mockChunks = makeChunks([
            {
                reasoning_details: [
                    { type: 'reasoning.text', text: 'First thought' },
                    { type: 'reasoning.text', text: 'Second thought' },
                ],
            },
            { content: 'Answer' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        const reasoningEvents = events.filter((e) => e.type === 'reasoning');
        expect(reasoningEvents).toHaveLength(2);
        expect(reasoningEvents[0]!.text).toBe('First thought');
        expect(reasoningEvents[1]!.text).toBe('Second thought');
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
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

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
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

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
        const service = new OpenAIChatService(api, { model: 'test-model' }, createOpenAIConfig());

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
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

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
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        expect(events[0]!.reason).toBe(FinishReason.Length);
    });

    it('maps "stop" to Stop finish reason', async () => {
        const mockChunks = makeChunks([
            { content: 'Hello', finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());
        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }
        expect(events[1]!.reason).toBe(FinishReason.Stop);
    });

    it('yields usage before finish when the server sends a usage-only chunk', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
            { usageOnly: true, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        expect(events.map((e) => e.type)).toEqual(['content', 'usage', 'finish']);
        expect(events[1]!.usage).toEqual({
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
        });
        expect(events[2]!.reason).toBe(FinishReason.Stop);
    });

    it('captures usage sent on the same chunk as finish_reason', async () => {
        const mockChunks = makeChunks([
            {
                content: 'Hi',
                finish_reason: 'stop',
                usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
            },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        expect(events.map((e) => e.type)).toEqual(['content', 'usage', 'finish']);
        expect(events[1]!.usage.total_tokens).toBe(3);
    });

    it('reads finish_reason from a chunk with a null delta', async () => {
        const nullDeltaChunk = {
            id: 'test',
            object: 'chat.completion.chunk',
            created: 123,
            model: 'test-model',
            choices: [{ index: 0, delta: null, finish_reason: 'stop' }],
            usage: null
        } as unknown as ChatCompletionChunk;

        const stream = {
            [Symbol.asyncIterator]() {
                const items = [nullDeltaChunk];
                let i = 0;
                return {
                    next: async () => {
                        if (i >= items.length) {
                            return { done: true, value: undefined as unknown as ChatCompletionChunk };
                        }
                        return { done: false, value: items[i++]! };
                    }
                };
            }
        };

        const mock = vi.fn().mockReturnValue(Promise.resolve(stream));
        const api = { apiKey: 'test', chat: { completions: { create: mock } } } as any;
        const service = new OpenAIChatService(api, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe('finish');
        expect(events[0]!.reason).toBe(FinishReason.Stop);
    });

    it('yields no usage event when the server sends none', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        const events: any[] = [];
        for await (const event of (service as any).createStream()) {
            events.push(event);
        }

        expect(events.map((e) => e.type)).toEqual(['content', 'finish']);
    });
});
