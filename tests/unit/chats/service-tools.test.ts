import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService, ChatServiceConfiguration, FinishReason, Tool, ToolParameters, ResultStatus, ResultBuilder, type PartialToolResult } from '../../../src/index.js';
import { StreamEvent, StreamEventType } from '../../../src/service/service.js';
import { TestChatService, SimpleTestTool, FailingTestTool, ThrowsStringTestTool } from '../../helper/service-mocks.js';

describe('ChatService tool calls', () => {
    let config: ChatServiceConfiguration;

    beforeEach(() => {
        config = new ChatServiceConfiguration();
        config.systemPromptDir = '';
        config.userPromptPaths = [];
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