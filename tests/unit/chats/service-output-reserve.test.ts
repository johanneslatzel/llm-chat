import { describe, it, expect } from 'vitest';
import {
    CharCountEstimator,
    ChatServiceConfiguration,
    OpenAIChatService,
    OpenAIChatServiceConfiguration
} from '../../../src/index.js';
import { TestChatService } from '../../helper/service-mocks.js';
import { createMockOpenAI, type MockChunk } from '../../index.js';

function makeServiceConfig(contextWindowSizeHint: number): ChatServiceConfiguration {
    const config = new ChatServiceConfiguration();
    config.systemPromptDir = '';
    config.userPromptPaths = [];
    config.contextWindowSizeHint = contextWindowSizeHint;
    return config;
}

interface ReserveOptions {
    maxTokens?: number;
    maxCompletionTokens?: number;
    contextWindowSizeHint: number;
}

function makeOpenAIService(options: ReserveOptions): OpenAIChatService {
    const chunks: MockChunk[] = [{ content: 'ok' }, { finish_reason: 'stop' }];
    const api = createMockOpenAI(chunks);
    const openAIConfig = new OpenAIChatServiceConfiguration();
    openAIConfig.model = 'test-model';

    if (options.maxTokens === undefined) {
        delete openAIConfig.maxTokens;
    } else {
        openAIConfig.maxTokens = options.maxTokens;
    }
    if (options.maxCompletionTokens === undefined) {
        delete openAIConfig.maxCompletionTokens;
    } else {
        openAIConfig.maxCompletionTokens = options.maxCompletionTokens;
    }

    return new OpenAIChatService(api, openAIConfig, makeServiceConfig(options.contextWindowSizeHint));
}

const est = new CharCountEstimator(1);

describe('isContextWindowExceeded output reserve', () => {
    it('reserves nothing by default in the base class', async () => {
        const service = new TestChatService([], makeServiceConfig(10));
        await service.chatImpl.user('a'.repeat(10));

        expect(await service.estimateTokens(est)).toBe(10);
        expect(await service.isContextWindowExceeded(est)).toBe(false);
    });

    it('reserves maxCompletionTokens for OpenAIChatService', async () => {
        const service = makeOpenAIService({
            maxCompletionTokens: 5,
            contextWindowSizeHint: 104
        });
        await service.chatImpl.user('a'.repeat(100));

        expect(await service.isContextWindowExceeded(est)).toBe(true);
    });

    it('falls back to maxTokens when maxCompletionTokens is unset', async () => {
        const service = makeOpenAIService({ maxTokens: 5, contextWindowSizeHint: 104 });
        await service.chatImpl.user('a'.repeat(100));

        expect(await service.isContextWindowExceeded(est)).toBe(true);
    });

    it('prefers maxCompletionTokens over maxTokens', async () => {
        const service = makeOpenAIService({
            maxTokens: 1000,
            maxCompletionTokens: 5,
            contextWindowSizeHint: 200
        });
        await service.chatImpl.user('a'.repeat(100));

        expect(await service.isContextWindowExceeded(est)).toBe(false);
    });

    it('reserves nothing when no output limit is configured', async () => {
        const service = makeOpenAIService({ contextWindowSizeHint: 100 });
        await service.chatImpl.user('a'.repeat(100));

        expect(await service.isContextWindowExceeded(est)).toBe(false);
    });

    it('returns false when the hint is 0 even with a reserve', async () => {
        const service = makeOpenAIService({
            maxCompletionTokens: 1000,
            contextWindowSizeHint: 0
        });
        await service.chatImpl.user('a'.repeat(100));

        expect(await service.isContextWindowExceeded(est)).toBe(false);
    });

    it('does not exceed exactly at the hint including the reserve', async () => {
        const service = makeOpenAIService({
            maxCompletionTokens: 5,
            contextWindowSizeHint: 105
        });
        await service.chatImpl.user('a'.repeat(100));

        expect(await service.isContextWindowExceeded(est)).toBe(false);
    });
});
