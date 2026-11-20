import { describe, it, expect } from 'vitest';
import {
    CharCountEstimator,
    ChatMessageOrigin,
    ChatRole,
    ChatServiceConfiguration,
    OpenAIChatService,
    OpenAIChatServiceConfiguration
} from '../../../src/index.js';
import { createMockOpenAI, type MockChunk } from '../../index.js';

function makeServiceConfig(): ChatServiceConfiguration {
    const config = new ChatServiceConfiguration();
    config.systemPromptDir = '';
    config.userPromptPaths = [];
    return config;
}

function makeService(prefixWithTimestamp: boolean): {
    service: OpenAIChatService;
    api: ReturnType<typeof createMockOpenAI>;
} {
    const chunks: MockChunk[] = [{ content: 'ok' }, { finish_reason: 'stop' }];
    const api = createMockOpenAI(chunks);
    const openAIConfig = new OpenAIChatServiceConfiguration();
    openAIConfig.model = 'test-model';
    openAIConfig.prefixWithTimestamp = prefixWithTimestamp;
    const service = new OpenAIChatService(api, openAIConfig, makeServiceConfig());
    return { service, api };
}

const createdAt = new Date('2026-01-02T03:04:05.678Z');

async function addUserMessage(service: OpenAIChatService, content: string): Promise<void> {
    await service.chatImpl.addAll([
        { role: ChatRole.User, content, createdAt, origin: ChatMessageOrigin.User }
    ]);
}

describe('estimateTokens with timestamp prefixes', () => {
    it('counts the prefix that is sent to the provider', async () => {
        const { service, api } = makeService(true);
        await addUserMessage(service, 'hello');
        await (service as any).createStream().next();

        const callArgs = (api.chat.completions.create as any).mock.calls[0][0];
        const sent = callArgs.messages[0].content as string;
        const est = new CharCountEstimator(1);

        expect(sent).toMatch(/: hello$/);
        expect(await service.estimateTokens(est)).toBe(sent.length);
        expect(await service.estimateTokens(est)).toBeGreaterThan('hello'.length);
    });

    it('does not count a prefix when disabled', async () => {
        const { service, api } = makeService(false);
        await addUserMessage(service, 'hello');
        await (service as any).createStream().next();

        const callArgs = (api.chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.messages[0].content).toBe('hello');
        expect(await service.estimateTokens(new CharCountEstimator(1))).toBe('hello'.length);
    });

    it('counts prefixes on queued messages', async () => {
        const { service } = makeService(true);
        await service.queue().user('queued');

        const est = new CharCountEstimator(1);
        expect(await service.estimateTokens(est)).toBeGreaterThan('queued'.length);
    });
});
