import { describe, it, expect } from 'vitest';
import {
    ChatRole,
    ChatServiceConfiguration,
    ChunkType,
    FinishReason,
    OpenAIChatService,
    OpenAIChatServiceConfiguration,
    type CompletionUsage
} from '../../../src/index.js';
import type { Chunk } from '../../../src/service/stream-types.js';
import {
    createMockOpenAI,
    createSequencedMockOpenAI,
    type MockChunk
} from '../../helper/mock-openai.js';
import { SimpleTestTool } from '../../helper/service-mocks.js';

function makeConfig(parseInlineReasoning: boolean): ChatServiceConfiguration {
    const config = new ChatServiceConfiguration();
    config.systemPromptDir = '';
    config.userPromptPaths = [];
    config.parseInlineReasoning = parseInlineReasoning;
    return config;
}

function makeService(
    chunks: MockChunk[],
    parseInlineReasoning: boolean
): OpenAIChatService {
    return makeServiceFromApi(createMockOpenAI(chunks), parseInlineReasoning);
}

function makeServiceFromApi(
    api: ReturnType<typeof createMockOpenAI>,
    parseInlineReasoning: boolean
): OpenAIChatService {
    const openAIConfig = new OpenAIChatServiceConfiguration();
    openAIConfig.model = 'test-model';
    return new OpenAIChatService(api, openAIConfig, makeConfig(parseInlineReasoning));
}

function textOf(chunks: readonly Chunk[], type: ChunkType.Content | ChunkType.Reasoning): string {
    return chunks
        .filter((chunk) => chunk.type === type)
        .map((chunk) => (chunk as { text: string }).text)
        .join('');
}

describe('OpenAIChatService inline reasoning', () => {
    it('parses markers split across content chunks when enabled', async () => {
        const service = makeService(
            [
                { content: 'a<thi' },
                { content: 'nk>b</thi' },
                { content: 'nk>c' },
                { finish_reason: 'stop' }
            ],
            true
        );

        await service.send();

        const chunks = service.stream().chunks();
        expect(chunks.map((chunk) => chunk.type)).toEqual([
            ChunkType.Content,
            ChunkType.Reasoning,
            ChunkType.Content,
            ChunkType.Finish
        ]);
        expect(textOf(chunks, ChunkType.Content)).toBe('ac');
        expect(textOf(chunks, ChunkType.Reasoning)).toBe('b');
        expect(service.stream().summary()[0]).toMatchObject({
            content: 'ac',
            reasoning: 'b',
            finishReason: FinishReason.Stop
        });

        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(2);
        expect(messages[0]!.role).toBe(ChatRole.Reasoning);
        expect(messages[0]!.content).toBe('b');
        expect(messages[1]!.role).toBe(ChatRole.Assistant);
        expect(messages[1]!.content).toBe('ac');
    });

    it('keeps markers literal when parsing is disabled', async () => {
        const service = makeService(
            [
                { content: 'a<thi' },
                { content: 'nk>b</thi' },
                { content: 'nk>c' },
                { finish_reason: 'stop' }
            ],
            false
        );

        await service.send();

        const chunks = service.stream().chunks();
        expect(chunks.map((chunk) => chunk.type)).toEqual([
            ChunkType.Content,
            ChunkType.Content,
            ChunkType.Content,
            ChunkType.Finish
        ]);
        expect(textOf(chunks, ChunkType.Content)).toBe('a<think>b</think>c');
        expect(service.stream().summary()[0]).toMatchObject({
            content: 'a<think>b</think>c',
            reasoning: ''
        });
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe('a<think>b</think>c');
    });

    it('preserves structured reasoning when inline parsing is enabled', async () => {
        const service = makeService(
            [
                { reasoning_content: 'structured' },
                { content: 'answer' },
                { finish_reason: 'stop' }
            ],
            true
        );

        await service.send();

        const chunks = service.stream().chunks();
        expect(textOf(chunks, ChunkType.Reasoning)).toBe('structured');
        expect(textOf(chunks, ChunkType.Content)).toBe('answer');
        expect(service.stream().summary()[0]).toMatchObject({
            content: 'answer',
            reasoning: 'structured'
        });
    });

    it('preserves structured and inline reasoning as independent channels', async () => {
        const service = makeService(
            [
                { reasoning_content: 'S' },
                { content: 'a<think>I</think>b' },
                { finish_reason: 'stop' }
            ],
            true
        );

        await service.send();

        const chunks = service.stream().chunks();
        expect(chunks.map((chunk) => chunk.type)).toEqual([
            ChunkType.Reasoning,
            ChunkType.Content,
            ChunkType.Reasoning,
            ChunkType.Content,
            ChunkType.Finish
        ]);
        expect(service.stream().summary()[0]).toMatchObject({
            content: 'ab',
            reasoning: 'SI'
        });
        const messages = service.chatImpl.messages();
        expect(messages[0]!.content).toBe('SI');
        expect(messages[1]!.content).toBe('ab');
    });

    it('keeps structured tool calls working alongside inline reasoning', async () => {
        const api = createSequencedMockOpenAI([
            [
                { content: '<think>thinking</think>' },
                {
                    tool_calls: [
                        { index: 0, id: 'call_1', function: { name: 'test_tool' } }
                    ]
                },
                { tool_calls: [{ index: 0, function: { arguments: '{}' } }] },
                { finish_reason: 'tool_calls' }
            ],
            [{ content: 'done' }, { finish_reason: 'stop' }]
        ]);
        const service = makeServiceFromApi(api, true);
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));
        await service.chatImpl.user('go');

        await service.send();

        const summaries = service.stream().summary();
        expect(summaries).toHaveLength(2);
        expect(summaries[0]).toMatchObject({
            content: '',
            reasoning: 'thinking',
            toolCallCount: 1,
            finishReason: FinishReason.ToolCalls
        });
        expect(summaries[1]).toMatchObject({
            content: 'done',
            reasoning: '',
            finishReason: FinishReason.Stop
        });

        const messages = service.chatImpl.messages();
        expect(messages.map((message) => message.role)).toEqual([
            ChatRole.User,
            ChatRole.Reasoning,
            ChatRole.Assistant,
            ChatRole.Tool,
            ChatRole.Assistant
        ]);
        expect(messages[1]!.content).toBe('thinking');
        expect(messages[2]!.tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: { name: 'test_tool', arguments: '{}' }
            }
        ]);
        expect(messages[3]!.content).toBe('ok');
        expect(messages[4]!.content).toBe('done');
    });

    it('passes usage through before flushing a held suffix at finish', async () => {
        const usage: CompletionUsage = {
            prompt_tokens: 3,
            completion_tokens: 2,
            total_tokens: 5
        };
        const service = makeService(
            [
                { content: 'a<thi' },
                { usageOnly: true, usage },
                { finish_reason: 'stop' }
            ],
            true
        );

        await service.send();

        const chunks = service.stream().chunks();
        expect(chunks.map((chunk) => chunk.type)).toEqual([
            ChunkType.Content,
            ChunkType.Usage,
            ChunkType.Content,
            ChunkType.Finish
        ]);
        expect(textOf(chunks, ChunkType.Content)).toBe('a<thi');
        expect(service.stream().summary()[0]).toMatchObject({
            content: 'a<thi',
            reasoning: '',
            usage
        });
    });
});
