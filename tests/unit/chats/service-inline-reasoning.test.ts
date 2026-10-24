import { describe, it, expect } from 'vitest';
import {
    ChatRole,
    ChatService,
    ChatServiceConfiguration,
    ChunkType,
    FinishReason,
    type CompletionUsage
} from '../../../src/index.js';
import { StreamEvent, StreamEventType } from '../../../src/service/service.js';
import { DEFAULT_INLINE_REASONING_MARKERS } from '../../../src/service/inline-reasoning.js';
import type { Chunk } from '../../../src/service/stream-types.js';
import { SimpleTestTool } from '../../helper/service-mocks.js';

function makeConfig(parseInlineReasoning: boolean): ChatServiceConfiguration {
    const config = new ChatServiceConfiguration();
    config.systemPromptDir = '';
    config.userPromptPaths = [];
    config.parseInlineReasoning = parseInlineReasoning;
    return config;
}

class ScriptedChatService extends ChatService {
    private readonly _rounds: StreamEvent[][];
    private _call = 0;

    constructor(rounds: StreamEvent[][], config?: ChatServiceConfiguration) {
        if (!config) {
            config = new ChatServiceConfiguration();
            config.systemPromptDir = '';
            config.userPromptPaths = [];
        }
        super(config);
        this._rounds = rounds;
    }

    protected async *createStream(_signal?: AbortSignal): AsyncIterable<StreamEvent> {
        const events = this._rounds[this._call++] ?? [];
        for (const event of events) {
            yield event;
        }
    }
}

class AbortingChatService extends ChatService {
    constructor(config: ChatServiceConfiguration, private readonly _text: string) {
        super(config);
    }

    protected async *createStream(signal?: AbortSignal): AsyncIterable<StreamEvent> {
        yield { type: StreamEventType.Content, text: this._text };
        await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else signal?.addEventListener('abort', () => resolve());
        });
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    }
}

class ThrowingChatService extends ChatService {
    constructor(config: ChatServiceConfiguration) {
        super(config);
    }

    protected async *createStream(_signal?: AbortSignal): AsyncIterable<StreamEvent> {
        yield { type: StreamEventType.Content, text: '<think>abc' };
        throw new SyntaxError('Bad response');
    }
}

function textOf(chunks: readonly Chunk[], type: ChunkType.Content | ChunkType.Reasoning): string {
    return chunks
        .filter((chunk) => chunk.type === type)
        .map((chunk) => (chunk as { text: string }).text)
        .join('');
}

describe('ChatService inline reasoning', () => {
    it('leaves markers literal when parsing is disabled', async () => {
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: 'a<think>b</think>c' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig(false)
        );

        await service.send();

        const chunks = service.stream().chunks();
        expect(chunks.map((chunk) => chunk.type)).toEqual([ChunkType.Content, ChunkType.Finish]);
        expect(textOf(chunks, ChunkType.Content)).toBe('a<think>b</think>c');
        expect(textOf(chunks, ChunkType.Reasoning)).toBe('');
        expect(service.stream().summary()[0]).toMatchObject({
            content: 'a<think>b</think>c',
            reasoning: '',
            finishReason: FinishReason.Stop
        });

        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.role).toBe(ChatRole.Assistant);
        expect(messages[0]!.content).toBe('a<think>b</think>c');
    });

    it('parses inline markers split across content events', async () => {
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: 'a<thi' },
                    { type: StreamEventType.Content, text: 'nk>b</thi' },
                    { type: StreamEventType.Content, text: 'nk>c' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig(true)
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

    it('preserves structured and inline reasoning as independent channels', async () => {
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Reasoning, text: 'S' },
                    { type: StreamEventType.Content, text: 'a<think>I</think>b' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig(true)
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
        expect(messages).toHaveLength(2);
        expect(messages[0]!.role).toBe(ChatRole.Reasoning);
        expect(messages[0]!.content).toBe('SI');
        expect(messages[1]!.role).toBe(ChatRole.Assistant);
        expect(messages[1]!.content).toBe('ab');
    });

    it('keeps structured reasoning working when inline parsing is enabled', async () => {
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Reasoning, text: 'structured' },
                    { type: StreamEventType.Content, text: 'answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig(true)
        );

        await service.send();

        expect(textOf(service.stream().chunks(), ChunkType.Reasoning)).toBe('structured');
        expect(textOf(service.stream().chunks(), ChunkType.Content)).toBe('answer');
        expect(service.stream().summary()[0]).toMatchObject({
            content: 'answer',
            reasoning: 'structured'
        });
    });

    it('handles a reasoning-only response without creating an assistant message', async () => {
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: '<think>only</think>' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig(true)
        );

        await service.send();

        expect(service.stream().summary()[0]).toMatchObject({
            content: '',
            reasoning: 'only',
            finishReason: FinishReason.Stop
        });
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.role).toBe(ChatRole.Reasoning);
        expect(messages[0]!.content).toBe('only');
    });

    it('handles a content-only response unchanged', async () => {
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: 'plain' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig(true)
        );

        await service.send();

        expect(service.stream().summary()[0]).toMatchObject({
            content: 'plain',
            reasoning: ''
        });
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.role).toBe(ChatRole.Assistant);
        expect(messages[0]!.content).toBe('plain');
    });

    it('produces no message for an empty reasoning block', async () => {
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: '<think></think>' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig(true)
        );

        await service.send();

        expect(service.stream().chunks().map((chunk) => chunk.type)).toEqual([
            ChunkType.Finish
        ]);
        expect(service.stream().summary()[0]).toMatchObject({ content: '', reasoning: '' });
        expect(service.chatImpl.messages()).toHaveLength(0);
    });

    it('flushes a partial marker at EOF as content', async () => {
        const service = new ScriptedChatService(
            [[{ type: StreamEventType.Content, text: 'a<thi' }]],
            makeConfig(true)
        );

        await service.send();

        expect(textOf(service.stream().chunks(), ChunkType.Content)).toBe('a<thi');
        expect(service.stream().chunks().at(-1)!.type).toBe(ChunkType.Finish);
        expect(service.stream().summary()[0]).toMatchObject({
            content: 'a<thi',
            reasoning: '',
            finishReason: FinishReason.Stop
        });
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.role).toBe(ChatRole.Assistant);
        expect(messages[0]!.content).toBe('a<thi');
    });

    it('flushes an unclosed reasoning block at EOF as reasoning', async () => {
        const service = new ScriptedChatService(
            [[{ type: StreamEventType.Content, text: '<think>abc' }]],
            makeConfig(true)
        );

        await service.send();

        expect(textOf(service.stream().chunks(), ChunkType.Reasoning)).toBe('abc');
        expect(service.stream().chunks().at(-1)!.type).toBe(ChunkType.Finish);
        expect(service.stream().summary()[0]).toMatchObject({
            content: '',
            reasoning: 'abc',
            finishReason: FinishReason.Stop
        });
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.role).toBe(ChatRole.Reasoning);
        expect(messages[0]!.content).toBe('abc');
    });

    it('records an aborted summary after flushing a partial marker', async () => {
        const config = makeConfig(true);
        const service = new AbortingChatService(config, 'a<thi');
        const sendPromise = service.send();

        await new Promise(process.nextTick);
        service.interrupt();

        await expect(sendPromise).resolves.toBeUndefined();

        expect(textOf(service.stream().chunks(), ChunkType.Content)).toBe('a<thi');
        expect(service.stream().summary()[0]).toMatchObject({
            content: 'a<thi',
            reasoning: '',
            finishReason: FinishReason.Aborted
        });
        expect(service.chatImpl.messages()).toHaveLength(0);
    });

    it('flushes an unclosed block before propagating a stream error', async () => {
        const service = new ThrowingChatService(makeConfig(true));

        await expect(service.send()).rejects.toThrow(SyntaxError);

        expect(textOf(service.stream().chunks(), ChunkType.Reasoning)).toBe('abc');
        expect(service.stream().summary()).toHaveLength(0);
        expect(service.chatImpl.messages()).toHaveLength(0);
    });

    it('uses fresh parser state for each tool-call round', async () => {
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: '<think>one</think>' },
                    {
                        type: StreamEventType.ToolCallDelta,
                        index: 0,
                        id: 'call_1',
                        name: 'test_tool',
                        arguments: '{}'
                    },
                    { type: StreamEventType.Finish, reason: FinishReason.ToolCalls }
                ],
                [
                    { type: StreamEventType.Content, text: '<think>two</think>done' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig(true)
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));
        await service.chatImpl.user('go');

        await service.send();

        const summaries = service.stream().summary();
        expect(summaries).toHaveLength(2);
        expect(summaries[0]).toMatchObject({
            content: '',
            reasoning: 'one',
            toolCallCount: 1,
            finishReason: FinishReason.ToolCalls
        });
        expect(summaries[1]).toMatchObject({
            content: 'done',
            reasoning: 'two',
            toolCallCount: 0,
            finishReason: FinishReason.Stop
        });

        const messages = service.chatImpl.messages();
        expect(messages.map((message) => message.role)).toEqual([
            ChatRole.User,
            ChatRole.Reasoning,
            ChatRole.Assistant,
            ChatRole.Tool,
            ChatRole.Reasoning,
            ChatRole.Assistant
        ]);
        expect(messages[1]!.content).toBe('one');
        expect(messages[2]!.content).toBe('');
        expect(messages[2]!.tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: { name: 'test_tool', arguments: '{}' }
            }
        ]);
        expect(messages[3]!.content).toBe('ok');
        expect(messages[4]!.content).toBe('two');
        expect(messages[5]!.content).toBe('done');
    });

    it('uses fresh parser state for each send call', async () => {
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: 'a<think' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ],
                [
                    { type: StreamEventType.Content, text: '>b' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig(true)
        );

        await service.send();
        await service.send();

        const summaries = service.stream().summary();
        expect(summaries).toHaveLength(2);
        expect(summaries[0]).toMatchObject({ content: 'a<think', reasoning: '' });
        expect(summaries[1]).toMatchObject({ content: '>b', reasoning: '' });

        const messages = service.chatImpl.messages();
        expect(messages.map((message) => message.content)).toEqual(['a<think', '>b']);
    });

    it('passes usage through before flushing a held suffix at finish', async () => {
        const usage: CompletionUsage = {
            prompt_tokens: 3,
            completion_tokens: 2,
            total_tokens: 5
        };
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: 'a<thi' },
                    { type: StreamEventType.Usage, usage },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig(true)
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

    it('keeps reasoning-only Length responses free of assistant messages', async () => {
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: '<think>partial' },
                    { type: StreamEventType.Finish, reason: FinishReason.Length }
                ]
            ],
            makeConfig(true)
        );

        await service.send();

        expect(service.stream().summary()[0]).toMatchObject({
            content: '',
            reasoning: 'partial',
            finishReason: FinishReason.Length
        });
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.role).toBe(ChatRole.Reasoning);
    });

    it('uses custom reasoning markers', async () => {
        const config = makeConfig(true);
        config.inlineReasoningMarkers = { open: '[r]', close: '[/r]' };
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: '[r]custom[/r]answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            config
        );

        await service.send();

        expect(textOf(service.stream().chunks(), ChunkType.Reasoning)).toBe('custom');
        expect(textOf(service.stream().chunks(), ChunkType.Content)).toBe('answer');
        expect(service.stream().summary()[0]).toMatchObject({
            content: 'answer',
            reasoning: 'custom'
        });
    });

    it('falls back to default reasoning markers when the config field is undefined', async () => {
        const config = makeConfig(true);
        (
            config as unknown as { inlineReasoningMarkers: undefined }
        ).inlineReasoningMarkers = undefined;
        const service = new ScriptedChatService(
            [
                [
                    {
                        type: StreamEventType.Content,
                        text:
                            `a${DEFAULT_INLINE_REASONING_MARKERS.open}` +
                            `r${DEFAULT_INLINE_REASONING_MARKERS.close}b`
                    },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            config
        );

        await service.send();

        expect(service.stream().summary()[0]).toMatchObject({
            content: 'ab',
            reasoning: 'r'
        });
    });
});
