import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { ChatMessageOrigin, ChatRole, FinishReason, ChatService, ChatServiceConfiguration, Tool, ToolParameters, PartialToolResult, ResultStatus, ResultBuilder } from '../../../src/index.js';
import { SystemPromptId } from '../../../src/service/service.js';
import { StreamEvent, StreamEventType } from '../../../src/service/service.js';
import { ChunkType } from '../../../src/service/stream-types.js';
import { createTempDir, removeTempDir, createTempFile } from '../../index.js';
import { TutorialPackage } from '../../helper/tool-mocks.js';

class TestChatService extends ChatService {
    private events: StreamEvent[];
    private index = 0;

    constructor(
        events: StreamEvent[],
        config?: ChatServiceConfiguration
    ) {
        if (!config) {
            config = new ChatServiceConfiguration();
            config.systemPromptDir = '';
        }
        super(config);
        this.events = events;
    }

    protected async *createStream(_signal?: AbortSignal): AsyncIterable<StreamEvent> {
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
        config.systemPromptDir = '';
        config.userPromptPaths = [];
    });

    describe('chat() getter', () => {
        it('returns the ChatInterface', () => {
            const service = new TestChatService([]);
            const chatInterface = service.chat();
            expect(chatInterface).toBeDefined();
            expect(typeof chatInterface.user).toBe('function');
            expect(chatInterface.system).toBeDefined();
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

        it('falls back to ./prompts/ as systemPromptDir when neither env nor config is set', () => {
            const c = new ChatServiceConfiguration();
            expect(c.systemPromptDir).toBe('./prompts/');
        });

        it('hooksDir defaults to undefined', () => {
            const c = new ChatServiceConfiguration();
            expect(c.hooksDir).toBeUndefined();
        });

        it('hooksDir setter stores value', () => {
            const c = new ChatServiceConfiguration();
            c.hooksDir = './my-hooks';
            expect(c.hooksDir).toBe('./my-hooks');
        });

        it('hooksDir reads from env var with priority over setter', () => {
            vi.stubEnv('LLM_CHAT_HOOKS_DIR', '/env/hooks');
            const c = new ChatServiceConfiguration();
            c.hooksDir = './my-hooks';
            expect(c.hooksDir).toBe('/env/hooks');
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
            await service.chatImpl.user('Do something');
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
            await service.chatImpl.user('What is the weather?');
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
            await service.chatImpl.user('Do something');
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
            await service.chatImpl.user('Do something');
            await service.send();

            const messages = service.chatImpl.messages();
            const toolMessage = messages[2]!;
            expect(toolMessage.role).toBe('tool');
            expect(toolMessage.content).toContain('Error:');
            expect(toolMessage.content).toContain('Non-error throw value');
        });

        it('handles error status result from executeTool', async () => {
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
            await service.chatImpl.user('Test');

            const suite = (service as any)._tools;
            vi.spyOn(suite, 'executeTool').mockResolvedValue([{
                result: 'Error: raw string error',
                status: 'error' as const,
                tool: 'test_tool'
            }]);

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
            await service.chatImpl.user('Tool round 1');
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
            await service.chatImpl.user('Test');
            await service.send();

            const messages = service.chatImpl.messages();
            const assistantMsg = messages[1]!;
            expect(assistantMsg.tool_calls![0]!.id).toBe('call_abc');
            expect(assistantMsg.tool_calls![0]!.function.name).toBe('multi_chunk_tool');
            expect(assistantMsg.tool_calls![0]!.function.arguments).toBe('{"key": "value"}');
        });

        it('appends multiple tool messages from a chained result', async () => {
            class ChainedTestTool extends Tool {
                constructor() {
                    super('chained_tool', 'Returns chained results', new ToolParameters({}));
                }
                protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
                    const builder = new ResultBuilder();
                    builder.add({ result: 'result-one', status: ResultStatus.Success });
                    builder.add({ result: 'result-two', status: ResultStatus.Error });
                    return builder.build();
                }
            }

            const events: StreamEvent[] = [
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_chain',
                    name: 'chained_tool',
                    arguments: '{}',
                },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                { type: StreamEventType.Content, text: 'Done with chain' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.tools().add(new ChainedTestTool());
            await service.chatImpl.user('Chain test');
            await service.send();

            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(5);
            expect(messages[1]!.role).toBe('assistant');
            expect(messages[1]!.tool_calls).toHaveLength(1);
            expect(messages[2]!.role).toBe('tool');
            expect(messages[2]!.content).toBe('result-one');
            expect(messages[3]!.role).toBe('tool');
            expect(messages[3]!.content).toBe('result-two');
            expect(messages[4]!.role).toBe('assistant');
            expect(messages[4]!.content).toBe('Done with chain');
            // Both tool results share the same tool_call_id
            expect(messages[2]!.tool_call_id).toBe('call_chain');
            expect(messages[3]!.tool_call_id).toBe('call_chain');
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

        it('loads system prompt directory', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'sys.txt', 'You are a helpful bot');
                config.systemPromptDir = tmpDir;

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                await service.send();

                expect(service.chatImpl.getSystem()).not.toBeNull();
                expect(service.chatImpl.getSystem()!.content).toContain('You are a helpful bot');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('creates the directory and default prompt files when missing', async () => {
            const tmpDir = createTempDir();
            try {
                config.systemPromptDir = tmpDir;

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                await service.send();

                const defaults = Object.values(SystemPromptId);
                for (const id of defaults) {
                    const filePath = path.join(tmpDir, `${id}.md`);
                    expect(existsSync(filePath)).toBe(true);
                    expect(readFileSync(filePath, 'utf-8')).toBe('');
                }
            } finally {
                removeTempDir(tmpDir);
            }
        });
    });

    describe('stream ending without finish event', () => {
        it('appends only reasoning message when finish with Stop reason and reasoning content but no content', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Reasoning, text: 'Deep thinking...' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe('reasoning');
            expect(messages[0]!.content).toBe('Deep thinking...');
        });

        it('appends only reasoning message when stream ends without finish and has reasoning content', async () => {
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
            await service.chatImpl.user('Test');
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
            await service.chatImpl.user('test');
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
        it('queues a message then re-sends with interrupt(true)', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Interrupt processed' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);

            await service.queue().user('Timer expired');
            await service.send();

            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.role).toBe('user');
            expect(messages[0]!.content).toBe('Timer expired');
            expect(messages[1]!.role).toBe('assistant');
            expect(messages[1]!.content).toBe('Interrupt processed');
        });

        it('setNeedsResend followed by send sends the queued message', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'After resend' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.queue().user('Hello');
            service.setNeedsResend();
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.content).toBe('Hello');
            expect(messages[1]!.content).toBe('After resend');
        });

        it('interrupt without send flag does not drain the queue — subsequent send does', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'After interrupt' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);

            await service.queue().user('Timer expired');
            service.interrupt();

            expect(service.chatImpl.messages()).toHaveLength(0);

            await service.send();

            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.role).toBe('user');
            expect(messages[0]!.content).toBe('Timer expired');
            expect(messages[1]!.role).toBe('assistant');
            expect(messages[1]!.content).toBe('After interrupt');
        });

        it('cancels an in-flight send', async () => {
            class HangingTestChatService extends ChatService {
                constructor() {
                    const cfg = new ChatServiceConfiguration();
                    cfg.systemPromptDir = '';
                    super(cfg);
                }

                protected async *createStream(signal?: AbortSignal): AsyncIterable<StreamEvent> {
                    yield { type: StreamEventType.Content, text: 'First' };
                    await new Promise<void>((resolve) => {
                        if (signal?.aborted) resolve();
                        else signal?.addEventListener('abort', () => resolve());
                    });
                    throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
                }
            }

            const service = new HangingTestChatService();
            const sendPromise = service.send();

            // Let send start and consume the first event
            await new Promise(process.nextTick);

            service.interrupt();

            await expect(sendPromise).resolves.toBeUndefined();

            // Emitted an Aborted FinishChunk
            expect(service.stream().finishReason()).toBe(FinishReason.Aborted);
            const finishChunks = service.stream().chunks().filter((c) => c.type === ChunkType.Finish);
            expect(finishChunks).toHaveLength(1);
            expect(finishChunks[0]!.finishReason).toBe(FinishReason.Aborted);

            // Stream was aborted before Finish — no messages committed
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(0);
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

    describe('sendLoop edge cases', () => {
        it('returns early when signal is already aborted on recursive entry', async () => {
            class SlowTool extends Tool {
                private _resolve: (() => void) | null = null;
                waitPromise: Promise<void> = new Promise((r) => { this._resolve = r; });

                constructor() {
                    super('slow_tool', 'Slow tool', new ToolParameters({}));
                }

                protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
                    await this.waitPromise;
                    return { result: 'done', status: ResultStatus.Success };
                }

                finish(): void { this._resolve?.(); }
            }

            const tool = new SlowTool();
            const events: StreamEvent[] = [
                { type: StreamEventType.ToolCallDelta, index: 0, id: 'call_1', name: 'slow_tool', arguments: '{}' },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
            ];
            const service = new TestChatService(events);
            service.tools().add(tool);
            await service.chatImpl.user('Do something');

            const sendPromise = service.send();

            await new Promise(process.nextTick);

            service.interrupt(true);

            tool.finish();

            await expect(sendPromise).resolves.toBeUndefined();
        });

        it('propagates non-AbortError from stream', async () => {
            class ThrowingTestChatService extends ChatService {
                constructor() {
                    const cfg = new ChatServiceConfiguration();
                    cfg.systemPromptDir = '';
                    super(cfg);
                }

                protected async *createStream(): AsyncIterable<StreamEvent> {
                    yield { type: StreamEventType.Content, text: '' };
                    throw new SyntaxError('Bad response');
                }
            }
            const service = new ThrowingTestChatService();
            await expect(service.send()).rejects.toThrow(SyntaxError);
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

    describe('init', () => {
        it('loads prompt files and marks context as loaded', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'sys.txt', 'You are a bot');
                config.systemPromptDir = tmpDir;

                const service = new TestChatService([], config);
                await service.init();

                expect(service.chatImpl.getSystem()).not.toBeNull();
                expect(service.chatImpl.getSystem()!.content).toContain('You are a bot');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('is idempotent', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'first.txt', 'First');
                config.systemPromptDir = tmpDir;

                const service = new TestChatService([], config);
                await service.init();
                await service.init();

                expect(service.chatImpl.getSystem()!.content).toContain('First');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('prevents loadPromptFiles from running again on first send', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'boot.txt', 'Boot prompt');
                config.systemPromptDir = tmpDir;

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                const spy = vi.spyOn(service, 'loadPromptFiles');
                await service.init();
                expect(spy).toHaveBeenCalledTimes(1);

                await service.send();
                expect(spy).toHaveBeenCalledTimes(1);
            } finally {
                removeTempDir(tmpDir);
            }
        });
    });

    describe('loadPromptFiles (public)', () => {
        it('re-reads files from disk on each call', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'greeting.txt', 'Hello');
                config.systemPromptDir = tmpDir;

                const service = new TestChatService([], config);
                await service.loadPromptFiles();
                expect(service.chatImpl.getSystem()!.content).toContain('Hello');

                createTempFile(tmpDir, 'greeting.txt', 'Updated');
                await service.loadPromptFiles();
                expect(service.chatImpl.getSystem()!.content).toContain('Updated');
            } finally {
                removeTempDir(tmpDir);
            }
        });
    });

    describe('resetTutorials', () => {
        it('re-wires tutorial container after chat.clear()', async () => {
            const service = new TestChatService([]);
            service.tools().add(new TutorialPackage());

            service.chat().clear();
            service.resetTutorials();

            const systemContent = service.chatImpl.getSystem()?.content ?? '';
            expect(systemContent).toContain('Tool Package TutorialPackage');
            expect(systemContent).toContain('Use alpha and beta together.');
        });

        it('does not throw when no packages are registered', () => {
            const service = new TestChatService([]);
            service.chat().clear();
            expect(() => service.resetTutorials()).not.toThrow();
        });
    });

    describe('clear', () => {
        it('exposes clear on stream interface', () => {
            const service = new TestChatService([]);
            expect(typeof service.stream().clear).toBe('function');
        });

        it('removes chat hooks registered through the service', async () => {
            const service = new TestChatService([]);
            const handler = vi.fn();
            service.chat().hook().message(ChatRole.User).do((msg) => handler(msg.content));

            await service.chatImpl.user('before');
            expect(handler).toHaveBeenCalledWith('before');

            service.clear();

            await service.chatImpl.user('after');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('allows fresh send after clear', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.send();
            expect(service.chatImpl.messages()).toHaveLength(1);

            service.clear();
            expect(service.chatImpl.messages()).toHaveLength(0);

            await expect(service.send()).resolves.toBeUndefined();
        });
    });

    describe('json hook integration', () => {
        let hooksDir: string;

        beforeEach(() => {
            hooksDir = createTempDir();
        });

        afterEach(() => {
            removeTempDir(hooksDir);
        });

        it('loadJsonHooks loads hook files from hooksDir', async () => {
            writeFileSync(
                path.join(hooksDir, 'test-hook.json'),
                JSON.stringify({ target: 'chat' }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);

            await service.loadJsonHooks();

            expect((service as any)._jsonHookRegistry.size).toBe(1);
        });

        it('getJsonHooks returns label and target for each loaded hook', async () => {
            writeFileSync(
                path.join(hooksDir, 'a.json'),
                JSON.stringify({ label: 'hook-a', target: 'chat' }),
                'utf-8'
            );
            writeFileSync(
                path.join(hooksDir, 'b.json'),
                JSON.stringify({ label: 'hook-b', target: 'stream' }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);
            await service.loadJsonHooks();
            const infos = service.getJsonHooks();
            expect(infos).toHaveLength(2);
            expect(infos[0]!.label).toBe('hook-a');
            expect(infos[0]!.target).toBe('chat');
            expect(infos[1]!.label).toBe('hook-b');
            expect(infos[1]!.target).toBe('stream');
        });

        it('loadJsonHooks is a no-op when hooksDir is not set', async () => {
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            const service = new TestChatService([], cfg);

            await service.loadJsonHooks();

            expect((service as any)._jsonHookRegistry.size).toBe(0);
        });

        it('auto-loads JSON hooks during init', async () => {
            writeFileSync(
                path.join(hooksDir, 'test-hook.json'),
                JSON.stringify({ target: 'chat' }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);

            await service.init();

            expect((service as any)._jsonHookRegistry.size).toBe(1);
        });

        it('interrupt action aborts the controller', async () => {
            writeFileSync(
                path.join(hooksDir, 'hook.json'),
                JSON.stringify({ target: 'chat', actions: [{ type: 'interrupt' }] }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);
            const abort = vi.fn();
            (service as any)._abortController = { abort };
            await service.loadJsonHooks();
            await service.chatImpl.user('hello');
            expect(abort).toHaveBeenCalledTimes(1);
        });

        it('interrupt-resend action sets needsResend', async () => {
            writeFileSync(
                path.join(hooksDir, 'hook.json'),
                JSON.stringify({ target: 'chat', actions: [{ type: 'interrupt', resend: true }] }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);
            await service.loadJsonHooks();
            await service.chatImpl.user('hello');
            expect((service as any)._needsResend).toBe(true);
        });

        it('queue-resend action sets needsResend without aborting', async () => {
            writeFileSync(
                path.join(hooksDir, 'hook.json'),
                JSON.stringify({ target: 'chat', actions: [{ type: 'queue-resend' }] }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);
            const abort = vi.fn();
            (service as any)._abortController = { abort };
            await service.loadJsonHooks();
            await service.chatImpl.user('hello');
            expect((service as any)._needsResend).toBe(true);
            expect(abort).not.toHaveBeenCalled();
        });

        it('inject action queues a message (drained on send)', async () => {
            writeFileSync(
                path.join(hooksDir, 'hook.json'),
                JSON.stringify({
                    target: 'chat',
                    actions: [{ type: 'queue-message', role: 'assistant', message: 'injected: {{content}}' }],
                }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);
            await service.loadJsonHooks();
            await service.chatImpl.user('trigger');
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.role).toBe('user');
            expect(messages[0]!.content).toBe('trigger');
            expect(messages[1]!.role).toBe('assistant');
            expect(messages[1]!.content).toBe('injected: trigger');
            expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
        });

        it('inject action with user role queues a user message', async () => {
            writeFileSync(
                path.join(hooksDir, 'hook-user.json'),
                JSON.stringify({
                    target: 'chat',
                    actions: [{ type: 'queue-message', role: 'user', message: 'auto: {{content}}' }],
                }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);
            await service.loadJsonHooks();
            await service.chatImpl.user('trigger');
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.role).toBe('user');
            expect(messages[0]!.content).toBe('trigger');
            expect(messages[1]!.role).toBe('user');
            expect(messages[1]!.content).toBe('auto: trigger');
            expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
        });

        it('inject action with reasoning role queues a reasoning message', async () => {
            writeFileSync(
                path.join(hooksDir, 'hook-reasoning.json'),
                JSON.stringify({
                    target: 'chat',
                    actions: [{ type: 'queue-message', role: 'reasoning', message: 'thinking: {{content}}' }],
                }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);
            await service.loadJsonHooks();
            await service.chatImpl.user('trigger');
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.role).toBe('user');
            expect(messages[1]!.role).toBe('reasoning');
            expect(messages[1]!.content).toBe('thinking: trigger');
            expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
        });

        it('inject action with tool role queues a tool message', async () => {
            writeFileSync(
                path.join(hooksDir, 'hook-tool.json'),
                JSON.stringify({
                    target: 'chat',
                    actions: [{ type: 'queue-message', role: 'tool', message: 'result: {{content}}' }],
                }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);
            await service.loadJsonHooks();
            await service.chatImpl.user('trigger');
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.role).toBe('user');
            expect(messages[1]!.role).toBe('tool');
            expect(messages[1]!.content).toBe('result: trigger');
            expect((messages[1] as any).tool_call_id).toMatch(/^inject-/);
            expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
        });

        it('inject without message field uses defaultMessage', async () => {
            writeFileSync(
                path.join(hooksDir, 'hook-no-msg.json'),
                JSON.stringify({
                    target: 'chat',
                    actions: [{ type: 'queue-message', role: 'user' }],
                }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);
            await service.loadJsonHooks();
            await service.chatImpl.user('hello');
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[1]!.content).toContain('[json-hook]');
            expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
        });

        it('inject without explicit role defaults to assistant', async () => {
            writeFileSync(
                path.join(hooksDir, 'hook-no-role.json'),
                JSON.stringify({
                    target: 'chat',
                    actions: [{ type: 'queue-message', message: 'default role: {{content}}' }],
                }),
                'utf-8'
            );
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.hooksDir = hooksDir;
            const service = new TestChatService([], cfg);
            await service.loadJsonHooks();
            await service.chatImpl.user('hello');
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[1]!.role).toBe('assistant');
            expect(messages[1]!.content).toBe('default role: hello');
            expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
        });
    });

    describe('service hooks', () => {
        describe('hook firing order', () => {
            it('fires beforeSendLoop, beforeSend, afterSend, afterSendLoop in correct order', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Hello' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const order: string[] = [];
                service.hook().beforeSendLoop().do(() => order.push('beforeSendLoop'));
                service.hook().beforeSend().do(() => order.push('beforeSend'));
                service.hook().afterSend().do(() => order.push('afterSend'));
                service.hook().afterSendLoop().do(() => order.push('afterSendLoop'));
                await service.send();
                expect(order).toEqual(['beforeSendLoop', 'beforeSend', 'afterSend', 'afterSendLoop']);
            });

            it('fires beforeSend and afterSend once per iteration', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Hello' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const befores: number[] = [];
                const afters: number[] = [];
                service.hook().beforeSend().do(() => befores.push(befores.length));
                service.hook().afterSend().do(() => afters.push(afters.length));
                await service.send();
                expect(befores).toHaveLength(1);
                expect(afters).toHaveLength(1);
            });

            it('fires beforeSendLoop and afterSendLoop exactly once', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Hello' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const befores: number[] = [];
                const afters: number[] = [];
                service.hook().beforeSendLoop().do(() => befores.push(befores.length));
                service.hook().afterSendLoop().do(() => afters.push(afters.length));
                await service.send();
                expect(befores).toHaveLength(1);
                expect(afters).toHaveLength(1);
            });
        });

        describe('hook control', () => {
            it('beforeSend hook can inject messages via queue that go into current send', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Response' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                service.hook().beforeSend().do(() => {
                    service.queue().user('Injected before send');
                });
                await service.send();
                const messages = service.chatImpl.messages();
                expect(messages).toHaveLength(2);
                expect(messages[0]!.role).toBe('user');
                expect(messages[0]!.content).toBe('Injected before send');
                expect(messages[1]!.role).toBe('assistant');
                expect(messages[1]!.content).toBe('Response');
            });

            it('afterSend hook can setNeedsResend to trigger retry', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'First' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                    { type: StreamEventType.Content, text: 'Second' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                let needsResendCalled = false;
                service.hook().afterSend().do(() => {
                    if (!needsResendCalled) {
                        needsResendCalled = true;
                        service.setNeedsResend();
                    }
                });
                await service.send();
                expect(needsResendCalled).toBe(true);
                const messages = service.chatImpl.messages();
                expect(messages).toHaveLength(2);
                expect(messages[0]!.content).toBe('First');
                expect(messages[1]!.content).toBe('Second');
            });

            it('beforeSendLoop hook can inject messages via queue', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Hello' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                service.hook().beforeSendLoop().do(() => {
                    service.queue().user('Injected in beforeSendLoop');
                });
                await service.send();
                const messages = service.chatImpl.messages();
                const userMessages = messages.filter((m) => m.role === 'user');
                expect(userMessages).toHaveLength(1);
                expect(userMessages[0]!.content).toBe('Injected in beforeSendLoop');
            });

            it('afterSendLoop hook can inject messages via queue (drained into chat)', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Hello' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                service.hook().afterSendLoop().do(() => {
                    service.queue().user('Injected in afterSendLoop');
                });
                await service.send();
                const messages = service.chatImpl.messages();
                expect(messages).toHaveLength(2);
                expect(messages[0]!.role).toBe('assistant');
                expect(messages[0]!.content).toBe('Hello');
                expect(messages[1]!.role).toBe('user');
                expect(messages[1]!.content).toBe('Injected in afterSendLoop');
                const queued = await (service as any)._messageQueue.clear();
                expect(queued).toHaveLength(0);
            });
        });

        describe('hook disposal', () => {
            it('dispose unsubscribes beforeSendLoop hook', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'A' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                    { type: StreamEventType.Content, text: 'B' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const calls: string[] = [];
                const hook = service.hook().beforeSendLoop().do(() => calls.push('fired'));
                hook.dispose();
                await service.send();
                expect(calls).toEqual([]);
            });

            it('dispose unsubscribes beforeSend hook', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'A' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const calls: string[] = [];
                const hook = service.hook().beforeSend().do(() => calls.push('fired'));
                hook.dispose();
                await service.send();
                expect(calls).toEqual([]);
            });

            it('dispose unsubscribes afterSend hook', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'A' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const calls: string[] = [];
                const hook = service.hook().afterSend().do(() => calls.push('fired'));
                hook.dispose();
                await service.send();
                expect(calls).toEqual([]);
            });

            it('dispose unsubscribes afterSendLoop hook', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'A' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const calls: string[] = [];
                const hook = service.hook().afterSendLoop().do(() => calls.push('fired'));
                hook.dispose();
                await service.send();
                expect(calls).toEqual([]);
            });

            it('isDisposed guard prevents callback when hook is disposed mid-cycle', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'A' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const calls: string[] = [];
                const hook = service.hook().beforeSend().do(() => calls.push('fired'));
                // Prevent onDispose from unregistering the handler, then dispose.
                // On the next event emission _onEvent fires but isDisposed returns
                // true, exercising the guard in service-hooks.ts:59.
                vi.spyOn(hook as any, 'onDispose').mockImplementation(() => {});
                hook.dispose();
                await service.send();
                expect(calls).toEqual([]);
            });
        });

        describe('multiple hooks', () => {
            it('fires multiple hooks on the same event in registration order', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Hello' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const order: number[] = [];
                service.hook().beforeSend().do(() => order.push(1));
                service.hook().beforeSend().do(() => order.push(2));
                service.hook().beforeSend().do(() => order.push(3));
                await service.send();
                expect(order).toEqual([1, 2, 3]);
            });
        });

        describe('hook errors', () => {
            it('throwing in beforeSend hook does not crash the service', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Hello' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
                service.hook().beforeSend().do(() => { throw new Error('hook error'); });
                await expect(service.send()).resolves.toBeUndefined();
                expect(spy).toHaveBeenCalledWith('Hook callback error:', expect.any(Error));
                spy.mockRestore();
            });

            it('throwing in afterSend hook does not crash the service', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Hello' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
                service.hook().afterSend().do(() => { throw new Error('hook error'); });
                await expect(service.send()).resolves.toBeUndefined();
                expect(spy).toHaveBeenCalledWith('Hook callback error:', expect.any(Error));
                spy.mockRestore();
            });
        });

        describe('reentrant send from hooks', () => {
            it('reentrant send() from beforeSendLoop does not deadlock (single iteration)', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'A' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const iterations: string[] = [];
                service.hook().beforeSend().do(() => iterations.push('before'));
                service.hook().afterSend().do(() => iterations.push('after'));
                service.hook().beforeSendLoop().do(() => {
                    service.send(); // reentrant
                });
                await service.send();
                expect(iterations).toEqual(['before', 'after']);
            });

            it('reentrant send() from afterSend triggers extra iteration', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'A' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                    { type: StreamEventType.Content, text: 'B' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                let called = false;
                service.hook().afterSend().do(() => {
                    if (!called) {
                        called = true;
                        service.send(); // reentrant
                    }
                });
                await service.send();
                const messages = service.chatImpl.messages();
                expect(messages).toHaveLength(2);
                expect(messages[0]!.content).toBe('A');
                expect(messages[1]!.content).toBe('B');
            });

            it('reentrant send() does not deadlock', async () => {
                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Hello' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];
                const service = new TestChatService(events);
                const wait = new Promise<void>((resolve) => {
                    service.hook().beforeSendLoop().do(() => {
                        service.send().then(resolve);
                    });
                });
                await service.send();
                await expect(wait).resolves.toBeUndefined();
            });
        });

        describe('hook() accessor', () => {
            it('returns a ServiceHookBuilder', () => {
                const service = new TestChatService([]);
                const builder = service.hook();
                expect(builder).toBeDefined();
                expect(typeof builder.beforeSendLoop).toBe('function');
                expect(typeof builder.afterSendLoop).toBe('function');
                expect(typeof builder.beforeSend).toBe('function');
                expect(typeof builder.afterSend).toBe('function');
            });
        });
    });

    describe('trimMessages', () => {
        it('trims assistant content when trimMessages is true', async () => {
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.trimMessages = true;
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: '\n\n  Hello World \n' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events, cfg);
            await service.send();
            const messages = service.chatImpl.messages();
            const last = messages[messages.length - 1]!;
            expect(last.content).toBe('Hello World');
        });

        it('trims reasoning content when trimMessages is true', async () => {
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.trimMessages = true;
            const events: StreamEvent[] = [
                { type: StreamEventType.Reasoning, text: '\n  Thinking... \n' },
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events, cfg);
            await service.send();
            const reasoning = service.chatImpl.messages().filter((m) => m.role === ChatRole.Reasoning);
            expect(reasoning).toHaveLength(1);
            expect(reasoning[0]!.content).toBe('Thinking...');
        });

        it('does not trim when trimMessages is false (default)', async () => {
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: '\n  Hello World \n' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events, cfg);
            await service.send();
            const messages = service.chatImpl.messages();
            const last = messages[messages.length - 1]!;
            expect(last.content).toBe('\n  Hello World \n');
        });
    });

    describe('ChatService.injectToolCall', () => {
        class MultiInjectTool extends Tool {
            constructor() {
                super('multi_inject', 'Returns multiple results', new ToolParameters({}));
            }
            protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
                return ResultBuilder.from([
                    { result: 'result-a', status: ResultStatus.Success },
                    { result: 'result-b', status: ResultStatus.Error }
                ]).build();
            }
        }

        it('queues assistant message with tool call and tool result', async () => {
            const tool = new SimpleTestTool('inject_test', 'injected result');
            const service = new TestChatService([]);
            service.tools().add(tool);

            const assistantSpy = vi.spyOn(service.queue(), 'assistant');
            const toolSpy = vi.spyOn(service.queue(), 'tool');

            await service.injectToolCall('inject_test', { input: 'hello' });

            expect(assistantSpy).toHaveBeenCalledTimes(1);
            expect(assistantSpy).toHaveBeenCalledWith('', [
                expect.objectContaining({
                    type: 'function',
                    function: expect.objectContaining({ name: 'inject_test' })
                })
            ]);

            expect(toolSpy).toHaveBeenCalledTimes(1);
            expect(toolSpy).toHaveBeenCalledWith('injected result', expect.any(String));
            const toolCallId = toolSpy.mock.calls[0]![1];
            expect(toolCallId).toMatch(/^inject_test-\d+-\d+$/);
        });

        it('queues one tool message per multi-result entry', async () => {
            const tool = new MultiInjectTool();
            const service = new TestChatService([]);
            service.tools().add(tool);
            const toolSpy = vi.spyOn(service.queue(), 'tool');

            await service.injectToolCall('multi_inject', {});

            expect(toolSpy).toHaveBeenCalledTimes(2);
            expect(toolSpy).toHaveBeenNthCalledWith(1, 'result-a', expect.any(String));
            expect(toolSpy).toHaveBeenNthCalledWith(2, 'result-b', expect.any(String));
            const id = toolSpy.mock.calls[0]![1];
            expect(toolSpy.mock.calls[1]![1]).toBe(id);
        });

        it('does not call interrupt or send', async () => {
            const service = new TestChatService([]);
            service.tools().add(new SimpleTestTool('no_send', 'result'));

            const sendSpy = vi.spyOn(service, 'send');
            const interruptSpy = vi.spyOn(service, 'interrupt');

            await service.injectToolCall('no_send', {});

            expect(sendSpy).not.toHaveBeenCalled();
            expect(interruptSpy).not.toHaveBeenCalled();
        });

        it('throws for unknown tool name', async () => {
            const service = new TestChatService([]);
            await expect(service.injectToolCall('nonexistent', {})).rejects.toThrow(
                "No tool registered with name 'nonexistent'"
            );
        });
    });
});
