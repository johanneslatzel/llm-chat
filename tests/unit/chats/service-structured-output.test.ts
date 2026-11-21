import { describe, expect, it } from 'vitest';
import {
    CharCountEstimator,
    ChatServiceConfiguration,
    StreamEventType,
    StructuredOutputError,
    StructuredOutputErrorReason,
    type StreamEvent
} from '../../../src/index.js';
import { ChatRole, FinishReason, type ChatMessage } from '@johannes.latzel/llm-chat-message';
import { TestChatService } from '../../helper/service-mocks.js';
import { ChunkStream } from '../../../src/service/stream.js';

function makeService(events: StreamEvent[] = []): TestChatService {
    const config = new ChatServiceConfiguration();
    config.systemPromptDir = '';
    config.userPromptPaths = [];
    return new TestChatService(events, config);
}

class FilteringService extends TestChatService {
    protected shouldSendMessage(message: ChatMessage): boolean {
        return message.role !== ChatRole.Reasoning;
    }
}

class AbortingService extends TestChatService {
    protected async *createStream(): AsyncIterable<StreamEvent> {
        yield { type: StreamEventType.Refusal, text: 'cannot answer' };
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
    }
}

function addSummary(
    service: TestChatService,
    summary: Partial<Parameters<ChunkStream['addSummary']>[0]>
): void {
    (service.stream() as ChunkStream).addSummary({
        content: '',
        reasoning: '',
        toolCallCount: 0,
        finishReason: FinishReason.Stop,
        timestamp: new Date(),
        ...summary
    });
}

describe('lastAssistantContent', () => {
    it('returns undefined when there is no assistant message', () => {
        expect(makeService().lastAssistantContent()).toBeUndefined();
    });

    it('returns undefined when messages exist but none are assistant', async () => {
        const service = makeService();
        await service.chatImpl.user('hello');
        expect(service.lastAssistantContent()).toBeUndefined();
    });

    it('returns the most recent assistant message', async () => {
        const service = makeService();
        await service.chatImpl.assistant('first');
        await service.chatImpl.assistant('second');
        expect(service.lastAssistantContent()).toBe('second');
    });
});

describe('lastAssistantJson', () => {
    it('returns undefined without a summary or assistant content', () => {
        expect(makeService().lastAssistantJson()).toBeUndefined();
    });

    it('parses JSON from the latest summary', () => {
        const service = makeService();
        addSummary(service, { content: '{"ok":true}' });
        expect(service.lastAssistantJson<{ ok: boolean }>()).toEqual({ ok: true });
    });

    it('falls back to the last assistant message when no summary exists', async () => {
        const service = makeService();
        await service.chatImpl.assistant('{"ok":true}');
        expect(service.lastAssistantJson()).toEqual({ ok: true });
    });

    it('returns undefined for empty content', () => {
        const service = makeService();
        addSummary(service, { content: '   ' });
        expect(service.lastAssistantJson()).toBeUndefined();
    });

    it('throws Refused when the latest summary contains a refusal', () => {
        const service = makeService();
        addSummary(service, { refusal: 'no' });
        expect(() => service.lastAssistantJson()).toThrow(StructuredOutputError);
        try {
            service.lastAssistantJson();
        } catch (error) {
            expect((error as StructuredOutputError).reason).toBe(
                StructuredOutputErrorReason.Refused
            );
        }
    });

    it('throws Filtered for a content-filter finish', () => {
        const service = makeService();
        addSummary(service, { finishReason: FinishReason.ContentFilter });
        expect(() => service.lastAssistantJson()).toThrow('filtered');
    });

    it('throws Incomplete for length and abort finishes', () => {
        const lengthService = makeService();
        addSummary(lengthService, { finishReason: FinishReason.Length });
        expect(() => lengthService.lastAssistantJson()).toThrow('complete');

        const abortService = makeService();
        addSummary(abortService, { finishReason: FinishReason.Aborted });
        expect(() => abortService.lastAssistantJson()).toThrow('complete');
    });

    it('throws InvalidJson with the parse cause', () => {
        const service = makeService();
        addSummary(service, { content: '{not json' });
        try {
            service.lastAssistantJson();
            throw new Error('expected throw');
        } catch (error) {
            expect(error).toBeInstanceOf(StructuredOutputError);
            expect((error as StructuredOutputError).reason).toBe(
                StructuredOutputErrorReason.InvalidJson
            );
            expect((error as StructuredOutputError).cause).toBeInstanceOf(SyntaxError);
        }
    });
});

describe('StructuredOutputError', () => {
    it('supports an optional cause', () => {
        const plain = new StructuredOutputError(StructuredOutputErrorReason.InvalidJson, 'plain');
        expect(plain.cause).toBeUndefined();
        expect(plain.name).toBe('StructuredOutputError');

        const cause = new Error('root');
        const wrapped = new StructuredOutputError(
            StructuredOutputErrorReason.InvalidJson,
            'wrapped',
            { cause }
        );
        expect(wrapped.cause).toBe(cause);
    });
});

describe('filtered estimation', () => {
    it('skips filtered raw and queued reasoning messages', async () => {
        const config = new ChatServiceConfiguration();
        config.systemPromptDir = '';
        config.userPromptPaths = [];
        const service = new FilteringService([], config);
        await service.chatImpl.reasoning('raw');
        await service.queue().reasoning('queued');
        expect(await service.estimateTokens(new CharCountEstimator(1))).toBe(0);
    });
});

describe('refusal stream handling', () => {
    it('records a refusal chunk and summary from the stream', async () => {
        const service = makeService([
            { type: StreamEventType.Refusal, text: 'cannot answer' },
            { type: StreamEventType.Finish, reason: FinishReason.Stop }
        ]);
        await service.send();

        const chunks = service.stream().chunks();
        expect(chunks.some((chunk) => chunk.type === 'refusal')).toBe(true);
        expect(service.stream().summary()[0]?.refusal).toBe('cannot answer');
    });

    it('keeps refusal text in an aborted summary', async () => {
        const config = new ChatServiceConfiguration();
        config.systemPromptDir = '';
        config.userPromptPaths = [];
        const service = new AbortingService([], config);
        await service.send();

        const summary = service.stream().summary()[0];
        expect(summary?.refusal).toBe('cannot answer');
        expect(summary?.finishReason).toBe(FinishReason.Aborted);
    });
});
