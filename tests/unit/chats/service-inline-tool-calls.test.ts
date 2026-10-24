import { describe, it, expect } from 'vitest';
import {
    ChatRole,
    ChatService,
    ChatServiceConfiguration,
    ChunkType,
    FinishReason
} from '../../../src/index.js';
import { StreamEvent, StreamEventType } from '../../../src/service/service.js';
import type { Chunk } from '../../../src/service/stream-types.js';
import {
    DEFAULT_INLINE_REASONING_MARKERS
} from '../../../src/service/inline-reasoning.js';
import {
    DEFAULT_INLINE_TOOL_CALL_MARKERS,
    type InlineToolCallMarkers
} from '../../../src/service/inline-tool-calls.js';
import { SimpleTestTool } from '../../helper/service-mocks.js';

function makeConfig(options: {
    toolCalls?: boolean;
    reasoning?: boolean;
    toolMarkers?: InlineToolCallMarkers;
} = {}): ChatServiceConfiguration {
    const config = new ChatServiceConfiguration();
    config.systemPromptDir = '';
    config.userPromptPaths = [];
    config.parseInlineToolCalls = options.toolCalls ?? false;
    config.parseInlineReasoning = options.reasoning ?? false;
    if (options.toolMarkers) {
        config.inlineToolCallMarkers = options.toolMarkers;
    }
    return config;
}

class ScriptedChatService extends ChatService {
    private readonly _rounds: StreamEvent[][];
    private _call = 0;

    constructor(rounds: StreamEvent[][], config?: ChatServiceConfiguration) {
        if (!config) {
            config = makeConfig();
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

function textOf(chunks: readonly Chunk[], type: ChunkType.Content | ChunkType.Reasoning): string {
    return chunks
        .filter((chunk) => chunk.type === type)
        .map((chunk) => (chunk as { text: string }).text)
        .join('');
}

function toolBlock(payload: string, markers = DEFAULT_INLINE_TOOL_CALL_MARKERS): string {
    return `${markers.open}${payload}${markers.close}`;
}

describe('ChatService inline tool calls', () => {
    it('leaves tool-call markers literal when parsing is disabled', async () => {
        const literal = toolBlock('{"name":"test_tool"}');
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: literal },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig({ toolCalls: false })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));

        await service.send();

        const chunks = service.stream().chunks();
        expect(chunks.map((chunk) => chunk.type)).toEqual([
            ChunkType.Content,
            ChunkType.Finish
        ]);
        expect(textOf(chunks, ChunkType.Content)).toBe(literal);
        expect(service.stream().summary()[0]).toMatchObject({
            content: literal,
            reasoning: '',
            toolCallCount: 0,
            finishReason: FinishReason.Stop
        });
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.role).toBe(ChatRole.Assistant);
        expect(messages[0]!.content).toBe(literal);
    });

    it('parses a closed block and executes the tool', async () => {
        const service = new ScriptedChatService(
            [
                [
                    {
                        type: StreamEventType.Content,
                        text: toolBlock(
                            '{"name":"test_tool","arguments":{"x":1}}'
                        )
                    },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ],
                [
                    { type: StreamEventType.Content, text: 'done' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig({ toolCalls: true })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));
        await service.chatImpl.user('go');

        await service.send();

        const summaries = service.stream().summary();
        expect(summaries).toHaveLength(2);
        expect(summaries[0]).toMatchObject({
            content: '',
            reasoning: '',
            toolCallCount: 1,
            finishReason: FinishReason.ToolCalls
        });
        expect(summaries[1]).toMatchObject({
            content: 'done',
            toolCallCount: 0,
            finishReason: FinishReason.Stop
        });

        const messages = service.chatImpl.messages();
        expect(messages.map((message) => message.role)).toEqual([
            ChatRole.User,
            ChatRole.Assistant,
            ChatRole.Tool,
            ChatRole.Assistant
        ]);
        const call = messages[1]!.tool_calls![0]!;
        expect(call.type).toBe('function');
        expect(call.function.name).toBe('test_tool');
        expect(call.function.arguments).toBe('{"x":1}');
        expect(typeof call.id).toBe('string');
        expect(call.id.length).toBeGreaterThan(0);
        expect(messages[2]!.content).toBe('ok');
        expect(messages[2]!.tool_call_id).toBe(call.id);
        expect(messages[3]!.content).toBe('done');
    });

    it('parses multiple calls in one block', async () => {
        const payload =
            '[{"name":"test_tool","arguments":{"a":1}},{"name":"test_tool","arguments":{"b":2}}]';
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: toolBlock(payload) },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ],
                [
                    { type: StreamEventType.Content, text: 'done' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig({ toolCalls: true })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));
        await service.chatImpl.user('go');

        await service.send();

        const messages = service.chatImpl.messages();
        const calls = messages[1]!.tool_calls!;
        expect(calls).toHaveLength(2);
        expect(calls[0]!.function.arguments).toBe('{"a":1}');
        expect(calls[1]!.function.arguments).toBe('{"b":2}');
        expect(new Set(calls.map((call) => call.id)).size).toBe(2);

        const toolMessages = messages.filter((message) => message.role === ChatRole.Tool);
        expect(toolMessages).toHaveLength(2);
        expect(toolMessages[0]!.tool_call_id).toBe(calls[0]!.id);
        expect(toolMessages[1]!.tool_call_id).toBe(calls[1]!.id);
        expect(service.stream().summary()[0]!.toolCallCount).toBe(2);
    });

    it('parses multiple tool-call blocks in order', async () => {
        const block = toolBlock('{"name":"test_tool"}');
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: block + block },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ],
                [
                    { type: StreamEventType.Content, text: 'done' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig({ toolCalls: true })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));
        await service.chatImpl.user('go');

        await service.send();

        const messages = service.chatImpl.messages();
        expect(messages[1]!.tool_calls).toHaveLength(2);
        expect(messages.filter((message) => message.role === ChatRole.Tool)).toHaveLength(2);
    });

    it('keeps malformed or unsupported payloads as content', async () => {
        for (const payload of ['{not json}', '{"foo":"bar"}']) {
            const content = `before${toolBlock(payload)}after`;
            const service = new ScriptedChatService(
                [
                    [
                        { type: StreamEventType.Content, text: content },
                        { type: StreamEventType.Finish, reason: FinishReason.Stop }
                    ]
                ],
                makeConfig({ toolCalls: true })
            );
            service.tools().add(new SimpleTestTool('test_tool', 'ok'));

            await service.send();

            expect(textOf(service.stream().chunks(), ChunkType.Content)).toBe(content);
            expect(service.stream().summary()[0]).toMatchObject({
                content,
                toolCallCount: 0,
                finishReason: FinishReason.Stop
            });
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.Assistant);
            expect(messages[0]!.content).toBe(content);
        }
    });

    it('keeps an unclosed block as content at EOF and never executes it', async () => {
        const content = 'before<tool_call>{"name":"test_tool"}';
        const service = new ScriptedChatService(
            [[{ type: StreamEventType.Content, text: content }]],
            makeConfig({ toolCalls: true })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));

        await service.send();

        expect(textOf(service.stream().chunks(), ChunkType.Content)).toBe(content);
        expect(service.stream().summary()[0]).toMatchObject({
            content,
            toolCallCount: 0,
            finishReason: FinishReason.Stop
        });
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe(content);
    });

    it('keeps an empty block as content', async () => {
        const content = '<tool_call></tool_call>';
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: content },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig({ toolCalls: true })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));

        await service.send();

        expect(textOf(service.stream().chunks(), ChunkType.Content)).toBe(content);
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe(content);
    });

    it('interleaves reasoning and tool-call blocks in order', async () => {
        const payload = '{"name":"test_tool"}';
        const content =
            `a${DEFAULT_INLINE_REASONING_MARKERS.open}r${DEFAULT_INLINE_REASONING_MARKERS.close}` +
            `b${toolBlock(payload)}c`;
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: content },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ],
                [
                    { type: StreamEventType.Content, text: 'done' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig({ toolCalls: true, reasoning: true })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));
        await service.chatImpl.user('go');

        await service.send();

        expect(service.stream().summary()[0]).toMatchObject({
            content: 'abc',
            reasoning: 'r',
            toolCallCount: 1,
            finishReason: FinishReason.ToolCalls
        });

        const messages = service.chatImpl.messages();
        expect(messages.map((message) => message.role)).toEqual([
            ChatRole.User,
            ChatRole.Reasoning,
            ChatRole.Assistant,
            ChatRole.Tool,
            ChatRole.Assistant
        ]);
        expect(messages[1]!.content).toBe('r');
        expect(messages[2]!.content).toBe('abc');
        expect(messages[2]!.tool_calls).toHaveLength(1);
        expect(messages[3]!.content).toBe('ok');
        expect(messages[4]!.content).toBe('done');
    });

    it('does not parse tool-call markers inside a reasoning block', async () => {
        const payload = '{"name":"test_tool"}';
        const content =
            `${DEFAULT_INLINE_REASONING_MARKERS.open}` +
            `${toolBlock(payload)}` +
            `${DEFAULT_INLINE_REASONING_MARKERS.close}`;
        const service = new ScriptedChatService(
            [
                [
                    { type: StreamEventType.Content, text: content },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig({ toolCalls: true, reasoning: true })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));

        await service.send();

        expect(service.stream().summary()[0]).toMatchObject({
            content: '',
            reasoning: toolBlock(payload),
            toolCallCount: 0,
            finishReason: FinishReason.Stop
        });
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(1);
        expect(messages[0]!.role).toBe(ChatRole.Reasoning);
        expect(messages[0]!.content).toBe(toolBlock(payload));
    });

    it('executes structured and inline tool calls together', async () => {
        const service = new ScriptedChatService(
            [
                [
                    {
                        type: StreamEventType.ToolCallDelta,
                        index: 0,
                        id: 'call_structured',
                        name: 'structured_tool',
                        arguments: '{}'
                    },
                    {
                        type: StreamEventType.Content,
                        text: toolBlock('{"name":"inline_tool"}')
                    },
                    { type: StreamEventType.Finish, reason: FinishReason.ToolCalls }
                ],
                [
                    { type: StreamEventType.Content, text: 'done' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig({ toolCalls: true })
        );
        service.tools().add(new SimpleTestTool('structured_tool', 'structured-ok'));
        service.tools().add(new SimpleTestTool('inline_tool', 'inline-ok'));
        await service.chatImpl.user('go');

        await service.send();

        const messages = service.chatImpl.messages();
        const calls = messages[1]!.tool_calls!;
        expect(calls).toHaveLength(2);
        expect(calls[0]!.id).toBe('call_structured');
        expect(calls[0]!.function.name).toBe('structured_tool');
        expect(calls[1]!.function.name).toBe('inline_tool');
        expect(service.stream().summary()[0]!.toolCallCount).toBe(2);

        const toolMessages = messages.filter((message) => message.role === ChatRole.Tool);
        expect(toolMessages).toHaveLength(2);
        expect(toolMessages[0]!.content).toBe('structured-ok');
        expect(toolMessages[1]!.content).toBe('inline-ok');
    });

    it('does not execute inline calls when the provider aborts', async () => {
        const service = new ScriptedChatService(
            [
                [
                    {
                        type: StreamEventType.Content,
                        text: toolBlock('{"name":"test_tool"}')
                    },
                    { type: StreamEventType.Finish, reason: FinishReason.Aborted }
                ]
            ],
            makeConfig({ toolCalls: true })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));

        await service.send();

        expect(service.stream().summary()[0]).toMatchObject({
            toolCallCount: 1,
            finishReason: FinishReason.Aborted
        });
        expect(service.chatImpl.messages()).toHaveLength(0);
    });

    it('treats a complete inline call with a Length finish as a tool call', async () => {
        const service = new ScriptedChatService(
            [
                [
                    {
                        type: StreamEventType.Content,
                        text: toolBlock('{"name":"test_tool"}')
                    },
                    { type: StreamEventType.Finish, reason: FinishReason.Length }
                ],
                [
                    { type: StreamEventType.Content, text: 'done' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig({ toolCalls: true })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));
        await service.chatImpl.user('go');

        await service.send();

        expect(service.stream().summary()[0]).toMatchObject({
            finishReason: FinishReason.ToolCalls
        });
        expect(service.chatImpl.messages().filter((m) => m.role === ChatRole.Tool)).toHaveLength(1);
    });

    it('uses custom tool-call markers', async () => {
        const markers: InlineToolCallMarkers = {
            open: '[tool]',
            close: '[/tool]'
        };
        const service = new ScriptedChatService(
            [
                [
                    {
                        type: StreamEventType.Content,
                        text: toolBlock('{"name":"test_tool"}', markers)
                    },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ],
                [
                    { type: StreamEventType.Content, text: 'done' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            makeConfig({ toolCalls: true, toolMarkers: markers })
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));
        await service.chatImpl.user('go');

        await service.send();

        const messages = service.chatImpl.messages();
        expect(messages[1]!.tool_calls).toHaveLength(1);
        expect(messages[2]!.content).toBe('ok');
    });

    it('falls back to default tool-call markers when the config field is undefined', async () => {
        const config = makeConfig({ toolCalls: true });
        (
            config as unknown as { inlineToolCallMarkers: undefined }
        ).inlineToolCallMarkers = undefined;
        const service = new ScriptedChatService(
            [
                [
                    {
                        type: StreamEventType.Content,
                        text: toolBlock('{"name":"test_tool"}')
                    },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ],
                [
                    { type: StreamEventType.Content, text: 'done' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop }
                ]
            ],
            config
        );
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));
        await service.chatImpl.user('go');

        await service.send();

        const messages = service.chatImpl.messages();
        expect(messages[1]!.tool_calls).toHaveLength(1);
        expect(messages[2]!.content).toBe('ok');
    });
});
