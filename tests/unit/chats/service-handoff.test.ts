import { describe, it, expect, vi } from 'vitest';
import { ChatRole, ChatMessageOrigin, ChatServiceConfiguration, CharCountEstimator, Prompt } from '../../../src/index.js';
import { TestChatService, SimpleTestTool } from '../../helper/service-mocks.js';

describe('ChatService handoff and context estimation', () => {
    describe('handoff', () => {
        it('handoff archives messages and replaces with compacted ones', async () => {
            const service = new TestChatService([]);
            await service.chatImpl.user('Hello');
            await service.chatImpl.assistant('Hi');
            const compacted = [
                { role: ChatRole.User, content: 'Compacted summary', createdAt: new Date(), origin: ChatMessageOrigin.System }
            ];
            await service.chat().handoff({ apply: () => compacted });
            expect(service.chat().historicMessages()).toHaveLength(2);
            expect(service.chatImpl.messages()).toHaveLength(1);
            expect(service.chatImpl.messages()[0]!.content).toBe('Compacted summary');
        });

        it('archives accumulate across multiple handoffs', async () => {
            const service = new TestChatService([]);
            await service.chatImpl.user('First');
            await service.chat().handoff({ apply: () => [{ role: ChatRole.User, content: 'c1', createdAt: new Date(), origin: ChatMessageOrigin.System }] });
            await service.chatImpl.user('Second');
            await service.chat().handoff({ apply: () => [{ role: ChatRole.User, content: 'c2', createdAt: new Date(), origin: ChatMessageOrigin.System }] });
            expect(service.chat().historicMessages()).toHaveLength(3);
            expect(service.chat().historicMessages()[0]!.content).toBe('First');
            expect(service.chat().historicMessages()[1]!.content).toBe('c1');
        });

        it('does not fire hooks while compacted messages are added', async () => {
            const service = new TestChatService([]);
            const handler = vi.fn();
            service.chatImpl.hook().message(ChatRole.User).do((msg) => handler(msg.content));
            await service.chatImpl.user('Original');
            handler.mockClear();
            await service.chat().handoff({
                apply: () => [{ role: ChatRole.User, content: 'Compacted', createdAt: new Date(), origin: ChatMessageOrigin.System }]
            });
            expect(handler).not.toHaveBeenCalled();
        });

        it('historicMessages() returns a deep copy (mutations are isolated)', async () => {
            const service = new TestChatService([]);
            await service.chatImpl.user('Hello');
            await service.chat().handoff({ apply: () => [] });
            const hist = service.chat().historicMessages();
            expect(hist).toHaveLength(1);
            hist[0]!.content = 'mutated';
            hist[0]!.createdAt.setFullYear(2000);
            expect(service.chat().historicMessages()[0]!.content).toBe('Hello');
            expect(service.chat().historicMessages()[0]!.createdAt.getFullYear()).not.toBe(2000);
        });
    });

    describe('context window estimation', () => {
        it('estimateTokens returns 0 for empty chat with no tools', async () => {
            const service = new TestChatService([]);
            const tokens = await service.estimateTokens();
            expect(tokens).toBe(0);
        });

        it('estimateTokens counts system prompt and messages', async () => {
            const service = new TestChatService([]);
            service.chatImpl.system().add(new Prompt('Title', 'You are a helpful assistant.'));
            await service.chatImpl.user('Hello');
            await service.chatImpl.assistant('Hi there');

            const tokens = await service.estimateTokens();
            const systemContent = service.chatImpl.getSystem()!.content;
            const expected = Math.ceil(systemContent.length / 4)
                + Math.ceil('Hello'.length / 4)
                + Math.ceil('Hi there'.length / 4);
            expect(tokens).toBe(expected);
        });

        it('estimateTokens includes queued messages', async () => {
            const service = new TestChatService([]);
            await service.queue().user('Queued message');

            const tokens = await service.estimateTokens();
            expect(tokens).toBe(Math.ceil('Queued message'.length / 4));
        });

        it('estimateTokens includes tool definitions', async () => {
            const service = new TestChatService([]);
            service.tools().add(new SimpleTestTool('my_tool', 'result'));

            const tokens = await service.estimateTokens();
            expect(tokens).toBeGreaterThan(0);
        });

        it('estimateTokens accepts a custom estimator', async () => {
            const service = new TestChatService([]);
            await service.chatImpl.user('hello world');
            const tokens = await service.estimateTokens(new CharCountEstimator(1));
            expect(tokens).toBe('hello world'.length);
        });

        it('isContextWindowExceeded returns false when limit is 0 (unlimited)', async () => {
            const service = new TestChatService([]);
            await service.chatImpl.user('a'.repeat(10000));
            const exceeded = await service.isContextWindowExceeded();
            expect(exceeded).toBe(false);
        });

        it('isContextWindowExceeded returns true when tokens exceed limit', async () => {
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.contextWindowSizeHint = 10;
            const service = new TestChatService([], cfg);
            await service.chatImpl.user('a'.repeat(100));

            const exceeded = await service.isContextWindowExceeded();
            expect(exceeded).toBe(true);
        });

        it('isContextWindowExceeded returns false when tokens are within limit', async () => {
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.contextWindowSizeHint = 1000;
            const service = new TestChatService([], cfg);
            await service.chatImpl.user('short');

            const exceeded = await service.isContextWindowExceeded();
            expect(exceeded).toBe(false);
        });

        it('isContextWindowExceeded accepts a custom estimator', async () => {
            const cfg = new ChatServiceConfiguration();
            cfg.systemPromptDir = '';
            cfg.contextWindowSizeHint = 3;
            const service = new TestChatService([], cfg);
            await service.chatImpl.user('hello world');

            const exceeded = await service.isContextWindowExceeded(new CharCountEstimator(1));
            expect(exceeded).toBe(true);
        });

        it('contextWindowSizeHint defaults to 0 in ChatServiceConfiguration', () => {
            const cfg = new ChatServiceConfiguration();
            expect(cfg.contextWindowSizeHint).toBe(0);
        });

        it('contextWindowSizeHint reads from env var', () => {
            vi.stubEnv('LLM_CHAT_CONTEXT_WINDOW_SIZE_HINT', '4096');
            const cfg = new ChatServiceConfiguration();
            expect(cfg.contextWindowSizeHint).toBe(4096);
            vi.unstubAllEnvs();
        });

        it('contextWindowSizeHint falls back to 0 when env value is not a number', () => {
            vi.stubEnv('LLM_CHAT_CONTEXT_WINDOW_SIZE_HINT', 'not-a-number');
            const cfg = new ChatServiceConfiguration();
            expect(cfg.contextWindowSizeHint).toBe(0);
            vi.unstubAllEnvs();
        });

        it('contextWindowSizeHint clamps negative env values to 0', () => {
            vi.stubEnv('LLM_CHAT_CONTEXT_WINDOW_SIZE_HINT', '-50');
            const cfg = new ChatServiceConfiguration();
            expect(cfg.contextWindowSizeHint).toBe(0);
            vi.unstubAllEnvs();
        });
    });
});