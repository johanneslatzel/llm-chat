import { describe, it, expect } from 'vitest';
import { ChatService, ChatServiceConfiguration, FinishReason } from '../../../src/index.js';
import { StreamEvent, StreamEventType } from '../../../src/service/service.js';
import { ChunkType } from '../../../src/service/stream-types.js';
import { TestChatService } from '../../helper/service-mocks.js';

describe('ChatService interrupt', () => {
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