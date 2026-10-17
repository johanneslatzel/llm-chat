import { describe, it, expect, vi } from 'vitest';
import { OpenAIChatService, OpenAIChatServiceConfiguration, ReasoningEffort, ToolChoice, Verbosity } from '../../../src/index.js';
import { createMockOpenAI } from '../../index.js';
import { makeChunks, createOpenAIConfig } from '../../helper/openai-mocks.js';

describe('OpenAIChatServiceConfiguration', () => {
    it('reads temperature from env', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_TEMPERATURE', '0.7');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.temperature).toBe(0.7);
        vi.unstubAllEnvs();
    });

    it('reads maxTokens from env', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_MAX_TOKENS', '2048');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.maxTokens).toBe(2048);
        vi.unstubAllEnvs();
    });

    it('reads maxCompletionTokens from env', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS', '4096');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.maxCompletionTokens).toBe(4096);
        vi.unstubAllEnvs();
    });

    it('reads topP from env', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_TOP_P', '0.9');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.topP).toBe(0.9);
        vi.unstubAllEnvs();
    });

    it('returns undefined for missing env vars', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_TEMPERATURE', '');
        vi.stubEnv('LLM_CHAT_OPENAI_MAX_TOKENS', '');
        vi.stubEnv('LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS', '');
        vi.stubEnv('LLM_CHAT_OPENAI_TOP_P', '');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.temperature).toBeUndefined();
        expect(cfg.maxTokens).toBeUndefined();
        expect(cfg.maxCompletionTokens).toBeUndefined();
        expect(cfg.topP).toBeUndefined();
        vi.unstubAllEnvs();
    });

    it('handles NaN env values gracefully', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_TEMPERATURE', 'not-a-number');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.temperature).toBeUndefined();
        vi.unstubAllEnvs();
    });

    it('handles NaN env values for maxTokens (parseEnvInt)', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_MAX_TOKENS', 'not-a-number');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.maxTokens).toBeUndefined();
        vi.unstubAllEnvs();
    });

    it('handles NaN env values for maxCompletionTokens (parseEnvInt)', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS', 'not-a-number');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.maxCompletionTokens).toBeUndefined();
        vi.unstubAllEnvs();
    });

    it('handles NaN env values for topP', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_TOP_P', 'not-a-number');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.topP).toBeUndefined();
        vi.unstubAllEnvs();
    });

    it('reads reasoningEffort from env', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_REASONING_EFFORT', 'high');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.reasoningEffort).toBe(ReasoningEffort.High);
        vi.unstubAllEnvs();
    });

    it('reads toolChoice from env', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_TOOL_CHOICE', 'required');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.toolChoice).toBe(ToolChoice.Required);
        vi.unstubAllEnvs();
    });

    it('reads verbosity from env', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_VERBOSITY', 'medium');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.verbosity).toBe(Verbosity.Medium);
        vi.unstubAllEnvs();
    });

    it('returns undefined for invalid reasoningEffort env value', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_REASONING_EFFORT', 'invalid');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.reasoningEffort).toBeUndefined();
        vi.unstubAllEnvs();
    });

    it('returns undefined for invalid toolChoice env value', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_TOOL_CHOICE', 'invalid');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.toolChoice).toBeUndefined();
        vi.unstubAllEnvs();
    });

    it('returns undefined for invalid verbosity env value', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_VERBOSITY', 'invalid');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.verbosity).toBeUndefined();
        vi.unstubAllEnvs();
    });

    it('defaults includeUsage to false', () => {
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.includeUsage).toBe(false);
    });

    it('reads includeUsage from env', () => {
        vi.stubEnv('LLM_CHAT_OPENAI_INCLUDE_USAGE', 'true');
        const cfg = new OpenAIChatServiceConfiguration();
        expect(cfg.includeUsage).toBe(true);
        vi.unstubAllEnvs();
    });
});

describe('openAIConfig parameters', () => {
    it('passes temperature to API call', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        openAIConfig.temperature = 0.7;
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.temperature).toBe(0.7);
    });

    it('passes maxCompletionTokens to API call', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        openAIConfig.maxCompletionTokens = 4096;
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.max_completion_tokens).toBe(4096);
    });

    it('passes maxTokens when maxCompletionTokens is not set', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        openAIConfig.maxTokens = 2048;
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.max_tokens).toBe(2048);
        expect(callArgs.max_completion_tokens).toBeUndefined();
    });

    it('passes stop sequences to API call', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        openAIConfig.stop = ['END', 'STOP'];
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.stop).toEqual(['END', 'STOP']);
    });

    it('passes topP to API call', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        openAIConfig.topP = 0.9;
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.top_p).toBe(0.9);
    });

    it('passes reasoningEffort to API call', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        openAIConfig.reasoningEffort = ReasoningEffort.High;
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.reasoning_effort).toBe('high');
    });

    it('passes toolChoice to API call', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        openAIConfig.toolChoice = ToolChoice.Required;
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.tool_choice).toBe('required');
    });

    it('passes verbosity to API call', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        openAIConfig.verbosity = Verbosity.High;
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.verbosity).toBe('high');
    });

    it('passes stream_options when includeUsage is enabled', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        openAIConfig.includeUsage = true;
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.stream_options).toEqual({ include_usage: true });
    });

    it('omits stream_options by default', async () => {
        const mockChunks = makeChunks([
            { content: 'Hi' },
            { finish_reason: 'stop' },
        ]);
        const mock = createMockOpenAI(mockChunks);
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'test-model';
        const service = new OpenAIChatService(mock, openAIConfig, createOpenAIConfig());

        await (service as any).createStream().next();

        const callArgs = (mock.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.stream_options).toBeUndefined();
    });
});
