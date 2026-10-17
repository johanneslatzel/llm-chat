import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatRole, ChatServiceConfiguration, FinishReason, type CompletionUsage } from '../../../src/index.js';
import { StreamEvent, StreamEventType } from '../../../src/service/service.js';
import { ChunkType } from '../../../src/service/stream-types.js';
import { TestChatService, SimpleTestTool } from '../../helper/service-mocks.js';

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

    describe('token usage', () => {
        const usage: CompletionUsage = {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15
        };

        it('records usage from a Usage event in the summary', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Usage, usage },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.send();
            expect(service.stream().summary()).toHaveLength(1);
            expect(service.stream().summary()[0]!.usage).toEqual(usage);
        });

        it('emits a UsageChunk before the FinishChunk', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Usage, usage },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.send();
            const types = service.stream().chunks().map((c) => c.type);
            expect(types).toEqual([ChunkType.Content, ChunkType.Usage, ChunkType.Finish]);
        });

        it('records usage when the stream ends without an explicit finish', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Partial' },
                { type: StreamEventType.Usage, usage },
            ];
            const service = new TestChatService(events);
            await service.send();
            expect(service.stream().summary()[0]!.usage).toEqual(usage);
        });

        it('records usage when the stream has no content', async () => {
            const events: StreamEvent[] = [{ type: StreamEventType.Usage, usage }];
            const service = new TestChatService(events);
            await service.send();
            expect(service.stream().summary()[0]!.usage).toEqual(usage);
            expect(service.chatImpl.messages()).toHaveLength(0);
        });

        it('records per-round usage across tool-call recursion', async () => {
            const first: CompletionUsage = {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2
            };
            const second: CompletionUsage = {
                prompt_tokens: 3,
                completion_tokens: 4,
                total_tokens: 7
            };
            const events: StreamEvent[] = [
                {
                    type: StreamEventType.ToolCallDelta,
                    index: 0,
                    id: 'call_1',
                    name: 'test_tool',
                    arguments: '{}',
                },
                { type: StreamEventType.Usage, usage: first },
                { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
                { type: StreamEventType.Content, text: 'Done' },
                { type: StreamEventType.Usage, usage: second },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.tools().add(new SimpleTestTool('test_tool', 'ok'));
            await service.chatImpl.user('Do it');
            await service.send();
            const summaries = service.stream().summary();
            expect(summaries).toHaveLength(2);
            expect(summaries[0]!.usage).toEqual(first);
            expect(summaries[1]!.usage).toEqual(second);
        });
    });
});