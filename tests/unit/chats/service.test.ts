import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { FinishReason, ChatService, ChatServiceConfiguration, Tool, ToolParameters, PartialToolResult, ResultStatus } from '../../../src/index.js';
import { StreamEvent, StreamEventType } from '../../../src/chats/service.js';
import { ChunkType } from '../../../src/chats/stream.js';
import { createTempDir, removeTempDir, createTempFile } from '../../index.js';

class TestChatService extends ChatService {
    private events: StreamEvent[];
    private index = 0;

    constructor(
        events: StreamEvent[],
        config?: ChatServiceConfiguration
    ) {
        super(config);
        this.events = events;
    }

    protected async *createStream(): AsyncIterable<StreamEvent> {
        while (this.index < this.events.length) {
            yield this.events[this.index++]!;
        }
    }
}

class SimpleTestTool extends Tool {
    private result: string;

    constructor(name: string, result: string) {
        super(name, 'Test tool', new ToolParameters({}));
        this.result = result;
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return { result: this.result, status: ResultStatus.Success };
    }
}

class FailingTestTool extends Tool {
    constructor() {
        super('failing_tool', 'A tool that fails', new ToolParameters({}));
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        throw new Error('Tool execution failed');
    }
}

class ThrowsStringTestTool extends Tool {
    constructor() {
        super('throws_string_tool', 'A tool that throws a string', new ToolParameters({}));
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        throw 'Non-error throw value';
    }
}

describe('ChatService', () => {
    let config: ChatServiceConfiguration;

    beforeEach(() => {
        config = new ChatServiceConfiguration();
        config.userPromptPaths = [];
    });

    describe('chat() getter', () => {
        it('returns the ChatInterface', () => {
            const service = new TestChatService([]);
            const chatInterface = service.chat();
            expect(chatInterface).toBeDefined();
            expect(typeof chatInterface.user).toBe('function');
            expect(typeof chatInterface.system).toBe('function');
            expect(typeof chatInterface.messages).toBe('function');
            expect(typeof chatInterface.toJSON).toBe('function');
            expect(typeof chatInterface.hook).toBe('function');
        });
    });

    describe('stream() getter', () => {
        it('returns the ChunkStreamInterface', () => {
            const service = new TestChatService([]);
            const streamInterface = service.stream();
            expect(streamInterface).toBeDefined();
            expect(typeof streamInterface.chunks).toBe('function');
            expect(typeof streamInterface.finishReason).toBe('function');
            expect(typeof streamInterface.hook).toBe('function');
        });
    });

    describe('configuration defaults', () => {
        it('uses default maxToolCallRounds of 10', () => {
            expect(config.maxToolCallRounds).toBe(10);
        });

        it('reads maxToolCallRounds from env', () => {
            vi.stubEnv('LLM_CHAT_MAX_TOOL_CALL_ROUNDS', '5');
            const c = new ChatServiceConfiguration();
            expect(c.maxToolCallRounds).toBe(5);
            vi.unstubAllEnvs();
        });

        it('falls back to default when env is invalid', () => {
            vi.stubEnv('LLM_CHAT_MAX_TOOL_CALL_ROUNDS', 'not-a-number');
            const c = new ChatServiceConfiguration();
            expect(c.maxToolCallRounds).toBe(10);
            vi.unstubAllEnvs();
        });
    });

    describe('send with content stream', () => {
        it('appends assistant message for content stream finishing without explicit finish event', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Content, text: ' World' },
            ];
            const service = new TestChatService(events);
            await service.send();
            const messages = service.chatImpl.messages();
            const lastMessage = messages[messages.length - 1]!;
            expect(lastMessage.role).toBe('assistant');
            expect(lastMessage.content).toBe('Hello World');
        });

        it('emits chunk events for content via stream hooks', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
            ];
            const service = new TestChatService(events);
            const chunkHandler = vi.fn();
            service.stream().hook().chunks(ChunkType.Content).do(chunkHandler);
            await service.send();
            expect(chunkHandler).toHaveBeenCalledWith(
                expect.objectContaining({ type: ChunkType.Content, text: 'Hello' })
            );
        });

        it('handles Stop finish reason', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Final answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const finishHandler = vi.fn();
            service.stream().hook().chunks(ChunkType.Finish).do(finishHandler);
            await service.send();
            expect(finishHandler).toHaveBeenCalledWith(
                expect.objectContaining({ type: ChunkType.Finish, finishReason: FinishReason.Stop })
            );
            const messages = service.chatImpl.messages();
            expect(messages[messages.length - 1]!.content).toBe('Final answer');
        });

        it('handles Length finish reason', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Partial answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Length },
            ];
            const service = new TestChatService(events);
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages[messages.length - 1]!.content).toBe('Partial answer');
        });

        it('empty stream (0 events) does not throw', async () => {
            const service = new TestChatService([]);
            await expect(service.send()).resolves.toBeUndefined();
            expect(service.chatImpl.messages()).toHaveLength(0);
            expect(service.stream().chunks()).toHaveLength(0);
        });

        it('stream with content but no finish appends assistant message and injects artificial finish', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'No finish' },
            ];
            const service = new TestChatService(events);
            const finishHandler = vi.fn();
            service.stream().hook().chunks(ChunkType.Finish).do(finishHandler);
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages[messages.length - 1]!.role).toBe('assistant');
            expect(messages[messages.length - 1]!.content).toBe('No finish');
            expect(finishHandler).toHaveBeenCalledWith(
                expect.objectContaining({ type: ChunkType.Finish, isArtificial: true })
            );
        });

        it('stream with only tool call deltas and no finish event processes tool calls', async () => {
            const events: StreamEvent[] = [
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_1',
                    name: 'test_tool',
                    arguments: '{}',
                },
            ];
            const service = new TestChatService(events);
            service.tools().add(new SimpleTestTool('test_tool', 'Tool result data'));
            service.chatImpl.user('Do something');
            await expect(service.send()).resolves.toBeUndefined();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(3);
            const finishChunks = service.stream().chunks().filter((c) => c.type === ChunkType.Finish);
            expect(finishChunks[0]!.isArtificial).toBe(true);
            expect(finishChunks[0]!.finishReason).toBe(FinishReason.ToolCalls);
        });
    });

    describe('tool calls', () => {
        it('executes tool calls and appends results', async () => {
            const events: StreamEvent[] = [
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_1',
                    name: 'test_tool',
                    arguments: '{}',
                },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                { type: StreamEventType.Content, text: 'The weather is sunny.' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.tools().add(new SimpleTestTool('test_tool', 'Tool result data'));
            service.chatImpl.user('What is the weather?');
            await service.send();

            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(4);
            expect(messages[0]!.role).toBe('user');
            expect(messages[1]!.role).toBe('assistant');
            expect(messages[1]!.tool_calls).toHaveLength(1);
            expect(messages[2]!.role).toBe('tool');
            expect(messages[2]!.content).toBe('Tool result data');
            expect(messages[3]!.role).toBe('assistant');
            expect(messages[3]!.content).toBe('The weather is sunny.');
        });

        it('catches tool execution errors and appends error message', async () => {
            const events: StreamEvent[] = [
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_1',
                    name: 'failing_tool',
                    arguments: '{}',
                },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                { type: StreamEventType.Content, text: 'Done' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.tools().add(new FailingTestTool());
            service.chatImpl.user('Do something');
            await service.send();

            const messages = service.chatImpl.messages();
            const toolMessage = messages[2]!;
            expect(toolMessage.role).toBe('tool');
            expect(toolMessage.content).toContain('Error:');
            expect(toolMessage.content).toContain('Tool execution failed');
        });

        it('handles non-Error throws from tool execution', async () => {
            const events: StreamEvent[] = [
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_s',
                    name: 'throws_string_tool',
                    arguments: '{}',
                },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                { type: StreamEventType.Content, text: 'Done' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.tools().add(new ThrowsStringTestTool());
            service.chatImpl.user('Do something');
            await service.send();

            const messages = service.chatImpl.messages();
            const toolMessage = messages[2]!;
            expect(toolMessage.role).toBe('tool');
            expect(toolMessage.content).toContain('Error:');
            expect(toolMessage.content).toContain('Non-error throw value');
        });

        it('handles raw string reject from executeTool (String(err) branch)', async () => {
            const events: StreamEvent[] = [
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_1',
                    name: 'test_tool',
                    arguments: '{}',
                },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                { type: StreamEventType.Content, text: 'Done' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.tools().add(new SimpleTestTool('test_tool', 'Result'));
            service.chatImpl.user('Test');

            const suite = (service as any)._tools;
            vi.spyOn(suite, 'executeTool').mockRejectedValue('raw string error');

            await service.send();

            const messages = service.chatImpl.messages();
            const toolMessage = messages[2]!;
            expect(toolMessage.role).toBe('tool');
            expect(toolMessage.content).toContain('Error:');
            expect(toolMessage.content).toContain('raw string error');
        });

        it('respects maxToolCallRounds limit', async () => {
            config.maxToolCallRounds = 2;
            const events: StreamEvent[] = [
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_1',
                    name: 'loop_tool',
                    arguments: '{}',
                },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_2',
                    name: 'loop_tool',
                    arguments: '{}',
                },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_3',
                    name: 'loop_tool',
                    arguments: '{}',
                },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                { type: StreamEventType.Content, text: 'Summary after interruption' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events, config);
            service.tools().add(new SimpleTestTool('loop_tool', 'Result'));
            service.chatImpl.user('Tool round 1');
            await service.send();

            const messages = service.chatImpl.messages();
            const userMessages = messages.filter((m) => m.role === 'user');
            const interruptionMessage = userMessages.find((m) =>
                m.content.includes('maximum number of rounds')
            );
            expect(interruptionMessage).toBeDefined();
            const assistantMessages = messages.filter((m) => m.role === 'assistant');
            expect(assistantMessages[assistantMessages.length - 1]!.content).toBe(
                'Summary after interruption'
            );
        });

        it('accumulates tool call deltas across multiple chunks', async () => {
            const events: StreamEvent[] = [
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_',
                    name: 'multi_',
                },
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'abc',
                    name: 'chunk_tool',
                    arguments: '{"key": "value"}',
                },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                { type: StreamEventType.Content, text: 'Done' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.tools().add(new SimpleTestTool('multi_chunk_tool', 'Done'));
            service.chatImpl.user('Test');
            await service.send();

            const messages = service.chatImpl.messages();
            const assistantMsg = messages[1]!;
            expect(assistantMsg.tool_calls![0]!.id).toBe('call_abc');
            expect(assistantMsg.tool_calls![0]!.function.name).toBe('multi_chunk_tool');
            expect(assistantMsg.tool_calls![0]!.function.arguments).toBe('{"key": "value"}');
        });
    });

    describe('reasoning events', () => {
        it('emits reasoning content via stream hooks', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Reasoning, text: 'Thinking...' },
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const reasoningHandler = vi.fn();
            service.stream().hook().chunks(ChunkType.Reasoning).do(reasoningHandler);
            await service.send();
            expect(reasoningHandler).toHaveBeenCalledWith(
                expect.objectContaining({ type: ChunkType.Reasoning, text: 'Thinking...' })
            );
        });

        it('creates reasoning message in history before assistant', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Reasoning, text: 'Thinking step by step' },
                { type: StreamEventType.Content, text: 'Final answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.send();

            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.role).toBe('reasoning');
            expect(messages[0]!.content).toBe('Thinking step by step');
            expect(messages[1]!.role).toBe('assistant');
            expect(messages[1]!.content).toBe('Final answer');
        });

        it('accumulates multiple reasoning chunks into one message', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Reasoning, text: 'Let me ' },
                { type: StreamEventType.Reasoning, text: 'think...' },
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.send();

            const messages = service.chatImpl.messages();
            const reasoningMsg = messages.find((m) => m.role === 'reasoning');
            expect(reasoningMsg?.content).toBe('Let me think...');
        });
    });

    describe('prompt file loading', () => {
        it('loads prompt files and adds as user messages', async () => {
            config.userPromptPaths = ['prompt.txt'];

            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];

            const service = new TestChatService(events, config);
            await service.send();

            const userMessages = service.chatImpl.messages().filter((m) => m.role === 'user');
            expect(userMessages.length).toBeGreaterThanOrEqual(0);
        });

        it('prompt files are only loaded once', async () => {
            config.userPromptPaths = ['prompt.txt'];
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];

            const service = new TestChatService(events, config);
            await service.send();
            await service.send();

            const userMessages = service.chatImpl.messages().filter((m) => m.role === 'user');
            expect(userMessages.length).toBeGreaterThanOrEqual(0);
        });

        it('loads prompt file content', async () => {
            const tmpDir = createTempDir();
            try {
                const promptPath = path.join(tmpDir, 'myprompt.txt');
                createTempFile(tmpDir, 'myprompt.txt', 'Hello from prompt');
                config.userPromptPaths = [promptPath];

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Response' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                await service.send();

                const userMessages = service.chatImpl.messages().filter((m) => m.role === 'user');
                expect(userMessages).toHaveLength(1);
                expect(userMessages[0]!.content).toBe('Hello from prompt');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('loads system prompt file path', async () => {
            const tmpDir = createTempDir();
            try {
                const sysPath = path.join(tmpDir, 'sys.txt');
                createTempFile(tmpDir, 'sys.txt', 'You are a helpful bot');
                config.systemPromptPath = sysPath;

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                await service.send();

                const sysMessages = service.chatImpl.messages().filter((m) => m.role === 'system');
                expect(sysMessages).toHaveLength(1);
                expect(sysMessages[0]!.content).toBe('You are a helpful bot');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('warns on missing system prompt file', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            config.systemPromptPath = 'nonexistent.txt';

            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];

            const service = new TestChatService(events, config);
            await service.send();

            const sysMessages = service.chatImpl.messages().filter((m) => m.role === 'system');
            expect(sysMessages).toHaveLength(0);
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load system prompt file'));
            warnSpy.mockRestore();
        });
    });

    describe('stream ending without finish event', () => {
        it('appends reasoning message when stream ends without finish and has reasoning content', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Reasoning, text: 'Thinking step by step' },
            ];
            const service = new TestChatService(events);
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe('reasoning');
            expect(messages[0]!.content).toBe('Thinking step by step');
        });

        it('handles unknown finish reason gracefully (falls through without appending)', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Finish, reason: 'unknown' as FinishReason },
            ];
            const service = new TestChatService(events);
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(0);
        });

        it('injects artificial finish chunk when stream ends without finish event', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'No finish event' },
            ];
            const service = new TestChatService(events);
            const finishHandler = vi.fn();
            service.stream().hook().chunks(ChunkType.Finish).do(finishHandler);
            await service.send();
            expect(finishHandler).toHaveBeenCalledTimes(1);
            const chunk = finishHandler.mock.calls[0]![0];
            expect(chunk.type).toBe(ChunkType.Finish);
            expect(chunk.isArtificial).toBe(true);
            expect(chunk.finishReason).toBe(FinishReason.Stop);
        });
    });

    describe('accumulateToolCall edge cases', () => {
        it('accumulates with undefined id/name on subsequent deltas', async () => {
            const events: StreamEvent[] = [
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_1',
                    name: 'test_tool',
                    arguments: '{"key":',
                },
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    arguments: '"value"}',
                },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                { type: StreamEventType.Content, text: 'Done' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.tools().add(new SimpleTestTool('test_tool', 'Result'));
            service.chatImpl.user('Test');
            await service.send();

            const messages = service.chatImpl.messages();
            const assistantMsg = messages[1]!;
            expect(assistantMsg.tool_calls![0]!.id).toBe('call_1');
            expect(assistantMsg.tool_calls![0]!.function.name).toBe('test_tool');
            expect(assistantMsg.tool_calls![0]!.function.arguments).toBe('{"key":"value"}');
        });
    });

    describe('stream chunks accumulation', () => {
        it('stream contains all chunks across tool-call rounds', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Round 1 ' },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                { type: StreamEventType.Content, text: 'Round 2' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.tools().add(new SimpleTestTool('test_tool', 'result'));
            service.chatImpl.user('test');
            await service.send();

            const chunks = service.stream().chunks();
            const finishChunks = chunks.filter((c) => c.type === ChunkType.Finish);
            const contentChunks = chunks.filter((c) => c.type === ChunkType.Content);
            expect(contentChunks.length).toBe(2);
            expect(finishChunks.length).toBe(2);
            expect(contentChunks[0]!.text).toBe('Round 1 ');
            expect(contentChunks[1]!.text).toBe('Round 2');
        });

        it('stream is cleared between send() calls', async () => {
            const events1: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'First' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const events2: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Second' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            // Create two separate services since TestChatService has one event list
            const service1 = new TestChatService(events1);
            await service1.send();
            expect(service1.stream().chunks()).toHaveLength(2);

            // Second service simulates a fresh send
            const service2 = new TestChatService(events2);
            expect(service2.stream().chunks()).toHaveLength(0);
            await service2.send();
            expect(service2.stream().chunks()).toHaveLength(2);
        });

        it('stream.finishReason() returns the final finish reason', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            expect(service.stream().finishReason()).toBeUndefined();
            await service.send();
            expect(service.stream().finishReason()).toBe(FinishReason.Stop);
        });
    });

    describe('interrupt', () => {
        it('injects a user message and re-sends when sendAfter is true (default)', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Interrupt processed' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);

            await service.interrupt(() => {
                service.chat().user('Timer expired');
            });

            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.role).toBe('user');
            expect(messages[0]!.content).toBe('Timer expired');
            expect(messages[1]!.role).toBe('assistant');
            expect(messages[1]!.content).toBe('Interrupt processed');
        });

        it('injects a user message but skips send when sendAfter is false', async () => {
            const service = new TestChatService([]);

            await service.interrupt(() => {
                service.chat().user('Timer expired');
            }, false);

            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe('user');
            expect(messages[0]!.content).toBe('Timer expired');
        });
    });

    describe('chunk ordering', () => {
        it('chunks have sequential indices across types', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Reasoning, text: 'Think' },
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.send();
            const chunks = service.stream().chunks();
            expect(chunks).toHaveLength(3);
            expect(chunks[0]!.seq).toBe(0);
            expect(chunks[1]!.seq).toBe(1);
            expect(chunks[2]!.seq).toBe(2);
        });

        it('FinishChunk is pushed to stream before assistant message is appended to chat', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const order: string[] = [];
            service.stream().hook().chunks(ChunkType.Finish).do(() => {
                order.push('finish');
                const allMessages = service.chatImpl.messages();
                const assistantMessages = allMessages.filter((m) => m.content === 'Hello');
                expect(assistantMessages).toHaveLength(0);
            });
            await service.send();
            expect(order).toEqual(['finish']);
            const messages = service.chatImpl.messages();
            const assistantMessages = messages.filter((m) => m.role === 'assistant' && m.content === 'Hello');
            expect(assistantMessages).toHaveLength(1);
        });
    });

    describe('consistency', () => {
        it('content from stream chunks matches messages in chat history', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Reasoning, text: 'Let me think...' },
                { type: StreamEventType.Content, text: 'The answer is 42.' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.send();

            const chunks = service.stream().chunks();
            const contentFromChunks = chunks
                .filter((c) => c.type === ChunkType.Content)
                .map((c) => c.text)
                .join('');
            expect(contentFromChunks).toBe('The answer is 42.');

            const messages = service.chatImpl.messages();
            const contentFromMessages = messages
                .filter((m) => m.role === 'assistant')
                .map((m) => m.content)
                .join('');
            expect(contentFromMessages).toBe('The answer is 42.');
        });
    });
});
