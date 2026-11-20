import { describe, it, expect } from 'vitest';
import {
    CharCountEstimator,
    ChatServiceConfiguration,
    OpenAIChatService,
    OpenAIChatServiceConfiguration,
    Prompt
} from '../../../src/index.js';
import { createMockOpenAI, type MockChunk } from '../../index.js';
import { TestChatService, SimpleTestTool } from '../../helper/service-mocks.js';

function makeServiceConfig(): ChatServiceConfiguration {
    const config = new ChatServiceConfiguration();
    config.systemPromptDir = '';
    config.userPromptPaths = [];
    return config;
}

interface ServiceOptions {
    filterReasoning?: boolean;
    parseInlineReasoning?: boolean;
    contextWindowSizeHint?: number;
}

function makeOpenAIService(
    chunks: MockChunk[],
    options: ServiceOptions = {}
): { service: OpenAIChatService; api: ReturnType<typeof createMockOpenAI> } {
    const config = makeServiceConfig();
    config.parseInlineReasoning = options.parseInlineReasoning ?? false;
    if (options.contextWindowSizeHint !== undefined) {
        config.contextWindowSizeHint = options.contextWindowSizeHint;
    }

    const api = createMockOpenAI(chunks);
    const openAIConfig = new OpenAIChatServiceConfiguration();
    openAIConfig.model = 'test-model';
    if (options.filterReasoning === undefined) {
        delete openAIConfig.filterReasoning;
    } else {
        openAIConfig.filterReasoning = options.filterReasoning;
    }
    const service = new OpenAIChatService(api, openAIConfig, config);
    return { service, api };
}

function answerChunks(content = 'answer'): MockChunk[] {
    return [{ content }, { finish_reason: 'stop' }];
}

function inlineReasoningChunks(): MockChunk[] {
    return [{ content: '<think>secret reasoning</think>answer' }, { finish_reason: 'stop' }];
}

function structuredReasoningChunks(): MockChunk[] {
    return [
        { reasoning_content: 'structured reasoning' },
        { content: 'answer' },
        { finish_reason: 'stop' }
    ];
}

describe('estimateTokens with provider-filtered reasoning', () => {
    it('excludes inline reasoning by default (filterReasoning undefined)', async () => {
        const { service } = makeOpenAIService(inlineReasoningChunks(), {
            parseInlineReasoning: true,
            contextWindowSizeHint: 3
        });

        await service.send();

        expect(service.chatImpl.messages().map((message) => message.role)).toEqual([
            'reasoning',
            'assistant'
        ]);
        expect(await service.estimateTokens()).toBe(Math.ceil('answer'.length / 4));
        expect(await service.isContextWindowExceeded()).toBe(false);
    });

    it('excludes inline reasoning when filterReasoning is true', async () => {
        const { service } = makeOpenAIService(inlineReasoningChunks(), {
            parseInlineReasoning: true,
            filterReasoning: true
        });

        await service.send();

        expect(await service.estimateTokens()).toBe(Math.ceil('answer'.length / 4));
    });

    it('includes inline reasoning when filterReasoning is false', async () => {
        const { service } = makeOpenAIService(inlineReasoningChunks(), {
            parseInlineReasoning: true,
            filterReasoning: false,
            contextWindowSizeHint: 3
        });

        await service.send();

        const expected =
            Math.ceil('secret reasoning'.length / 4) + Math.ceil('answer'.length / 4);
        expect(await service.estimateTokens()).toBe(expected);
        expect(await service.isContextWindowExceeded()).toBe(true);
    });

    it('excludes structured reasoning when filterReasoning is true', async () => {
        const { service } = makeOpenAIService(structuredReasoningChunks(), {
            filterReasoning: true
        });

        await service.send();

        expect(await service.estimateTokens()).toBe(Math.ceil('answer'.length / 4));
    });

    it('includes structured reasoning when filterReasoning is false', async () => {
        const { service } = makeOpenAIService(structuredReasoningChunks(), {
            filterReasoning: false
        });

        await service.send();

        const expected =
            Math.ceil('structured reasoning'.length / 4) + Math.ceil('answer'.length / 4);
        expect(await service.estimateTokens()).toBe(expected);
    });

    it('filters queued reasoning consistently with the request filter', async () => {
        const filtered = makeOpenAIService([], { filterReasoning: true }).service;
        await filtered.queue().reasoning('queued reasoning');
        await filtered.queue().user('hi');
        const est = new CharCountEstimator(1);
        expect(await filtered.estimateTokens(est)).toBe('hi'.length);

        const unfiltered = makeOpenAIService([], { filterReasoning: false }).service;
        await unfiltered.queue().reasoning('queued reasoning');
        await unfiltered.queue().user('hi');
        expect(await unfiltered.estimateTokens(est)).toBe('queued reasoning'.length + 'hi'.length);
    });

    it('keeps the base class identity behaviour for providers without a filter', async () => {
        const service = new TestChatService([], makeServiceConfig());
        await service.queue().reasoning('queued reasoning');
        await service.chatImpl.reasoning('stored reasoning');
        await service.chatImpl.user('hi');

        const est = new CharCountEstimator(1);
        expect(await service.estimateTokens(est)).toBe(
            'queued reasoning'.length + 'stored reasoning'.length + 'hi'.length
        );
    });

    it('still counts the system prompt and tool definitions after filtering', async () => {
        const { service } = makeOpenAIService([], { filterReasoning: true });
        service.chatImpl.system().add(new Prompt('Title', 'system prompt'));
        await service.chatImpl.reasoning('ignored reasoning');
        await service.chatImpl.user('hello');
        service.tools().add(new SimpleTestTool('my_tool', 'ok'));
        await service.init();

        const est = new CharCountEstimator(1);
        const systemContent = service.chatImpl.getSystem()!.content;
        const toolTokens = JSON.stringify((service as any)._tools.getTools()[0]).length;
        expect(await service.estimateTokens(est)).toBe(
            systemContent.length + 'hello'.length + toolTokens
        );
    });

    it('keeps the estimate equal to the captured request message set', async () => {
        const { service, api } = makeOpenAIService(answerChunks(), { filterReasoning: true });
        await service.chatImpl.reasoning('hidden reasoning');
        await service.chatImpl.user('hello');

        await (service as any).createStream().next();

        const callArgs = (api.chat.completions.create as any).mock.calls[0][0];
        const est = new CharCountEstimator(1);
        const sentTokens = callArgs.messages.reduce(
            (sum: number, message: { content?: string | null }) =>
                sum + est.estimate(message.content ?? ''),
            0
        );
        expect(await service.estimateTokens(est)).toBe(sentTokens);
    });
});
