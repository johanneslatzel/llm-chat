import { describe, it, expect, vi } from 'vitest';
import { ChatRole, ChatMessageOrigin, OpenAIChatService, OpenAIChatServiceConfiguration, ChatServiceConfiguration, Prompt } from '../../../src/index.js';
import { createMockOpenAI, createMockOpenAIWithError } from '../../index.js';
import { makeChunks, TestOpenAITool, createOpenAIConfig } from '../../helper/openai-mocks.js';

describe('OpenAIChatService message conversion', () => {
    it('passes messages to OpenAI API', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());
        service.chatImpl.system().add(new Prompt('Title', 'You are a bot'));
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
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

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
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());
        service.tools().add(new TestOpenAITool());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.tools).toHaveLength(1);
        expect(callArgs.tools[0].function.name).toBe('test_tool');
    });
});

describe('message conversion - all roles', () => {
    it('converts assistant and tool messages', async () => {
        const mockChunks = makeChunks([
            { content: 'Final' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());
        service.chatImpl.system().add(new Prompt('Title', 'System'));
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
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());
        await service.chatImpl.reasoning('Let me think...');
        await service.chatImpl.user('Hello');

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.messages).toHaveLength(2);
        expect(callArgs.messages[0].role).toBe('assistant');
        expect(callArgs.messages[0].content).toBe('Let me think...');
        expect(callArgs.messages[1].role).toBe('user');
    });

    it('maps system role to developer when useDeveloperRole is true', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(
            mock,
            { model: 'test-model', useDeveloperRole: true },
            createOpenAIConfig()
        );
        service.chatImpl.system().add(new Prompt('Title', 'You are a bot'));

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.messages[0].role).toBe('developer');
        expect(callArgs.messages[0].content).toContain('You are a bot');
    });

    it('uses flat systemPrompt when set, overriding the prompt tree', async () => {
        const cfg = new ChatServiceConfiguration();
        cfg.userPromptPaths = [];
        cfg.systemPrompt = 'You are a flat prompt bot.';
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, cfg);
        service.chatImpl.system().add(new Prompt('Title', 'You should not see this.'));
        expect(service.chatImpl.getSystem()!.content).toBe('You are a flat prompt bot.');

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.messages[0].role).toBe('system');
        expect(callArgs.messages[0].content).toBe('You are a flat prompt bot.');
        expect(callArgs.messages[0].content).not.toContain('should not see this');
    });

    it('maps flat systemPrompt to developer role when useDeveloperRole is true', async () => {
        const cfg = new ChatServiceConfiguration();
        cfg.userPromptPaths = [];
        cfg.systemPrompt = 'You are a flat prompt bot.';
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(
            mock,
            { model: 'test-model', useDeveloperRole: true },
            cfg
        );

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.messages[0].role).toBe('developer');
        expect(callArgs.messages[0].content).toBe('You are a flat prompt bot.');
    });

    it('filters out reasoning messages by default', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());
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
            createOpenAIConfig()
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
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        vi.spyOn(service.chatImpl as any, '_rawMessages').mockReturnValue([
            { role: 'bogus_role' as any, content: 'test', createdAt: new Date(), origin: ChatMessageOrigin.User }
        ]);

        await expect((service as any).createStream().next()).rejects.toThrow('Unexpected role: bogus_role');
    });

    it('maps ChatRole.Developer to developer role', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());

        vi.spyOn(service.chatImpl as any, '_rawMessages').mockReturnValue([
            { role: ChatRole.Developer, content: 'be concise', createdAt: new Date(), origin: ChatMessageOrigin.System }
        ]);
        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.messages[0].role).toBe('developer');
        expect(callArgs.messages[0].content).toBe('be concise');
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
            createOpenAIConfig()
        );
        await service.chatImpl.user('Hello');
        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        const sentContent: string = callArgs.messages[0].content;
        expect(sentContent).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-\d{2}:\d{2}: Hello$/);

        vi.restoreAllMocks();
    });
});

describe('OpenAIChatService constructor and error handling', () => {
    it('throws when no model is configured', () => {
        const mock = createMockOpenAI([]);
        const emptyConfig = new OpenAIChatServiceConfiguration();
        emptyConfig.model = undefined as any;
        expect(() => new OpenAIChatService(mock, emptyConfig, createOpenAIConfig())).toThrow('model');
    });

    it('rejects when createStream fails', async () => {
        const mock = createMockOpenAIWithError(new Error('API rejected'));
        const service = new OpenAIChatService(mock, { model: 'test-model' }, createOpenAIConfig());
        await expect((service as any).createStream().next()).rejects.toThrow('API rejected');
    });
});
