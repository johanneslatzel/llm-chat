import { describe, it, expect, vi } from 'vitest';
import { FinishReason } from '../../../src/index.js';
import { StreamEvent, StreamEventType } from '../../../src/service/service.js';
import { TestChatService } from '../../helper/service-mocks.js';

describe('ChatService service hooks', () => {
    describe('hook firing order', () => {
        it('fires beforeSendLoop, beforeSend, afterSend, afterSendLoop in correct order', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const order: string[] = [];
            service.hook().beforeSendLoop().do(() => order.push('beforeSendLoop'));
            service.hook().beforeSend().do(() => order.push('beforeSend'));
            service.hook().afterSend().do(() => order.push('afterSend'));
            service.hook().afterSendLoop().do(() => order.push('afterSendLoop'));
            await service.send();
            expect(order).toEqual(['beforeSendLoop', 'beforeSend', 'afterSend', 'afterSendLoop']);
        });

        it('fires beforeSend and afterSend once per iteration', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const befores: number[] = [];
            const afters: number[] = [];
            service.hook().beforeSend().do(() => befores.push(befores.length));
            service.hook().afterSend().do(() => afters.push(afters.length));
            await service.send();
            expect(befores).toHaveLength(1);
            expect(afters).toHaveLength(1);
        });

        it('fires beforeSendLoop and afterSendLoop exactly once', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const befores: number[] = [];
            const afters: number[] = [];
            service.hook().beforeSendLoop().do(() => befores.push(befores.length));
            service.hook().afterSendLoop().do(() => afters.push(afters.length));
            await service.send();
            expect(befores).toHaveLength(1);
            expect(afters).toHaveLength(1);
        });
    });

    describe('hook control', () => {
        it('beforeSend hook can inject messages via queue that go into current send', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Response' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.hook().beforeSend().do(() => {
                service.queue().user('Injected before send');
            });
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.role).toBe('user');
            expect(messages[0]!.content).toBe('Injected before send');
            expect(messages[1]!.role).toBe('assistant');
            expect(messages[1]!.content).toBe('Response');
        });

        it('afterSend hook can setNeedsResend to trigger retry', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'First' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
                { type: StreamEventType.Content, text: 'Second' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            let needsResendCalled = false;
            service.hook().afterSend().do(() => {
                if (!needsResendCalled) {
                    needsResendCalled = true;
                    service.setNeedsResend();
                }
            });
            await service.send();
            expect(needsResendCalled).toBe(true);
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.content).toBe('First');
            expect(messages[1]!.content).toBe('Second');
        });

        it('beforeSendLoop hook can inject messages via queue', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.hook().beforeSendLoop().do(() => {
                service.queue().user('Injected in beforeSendLoop');
            });
            await service.send();
            const messages = service.chatImpl.messages();
            const userMessages = messages.filter((m) => m.role === 'user');
            expect(userMessages).toHaveLength(1);
            expect(userMessages[0]!.content).toBe('Injected in beforeSendLoop');
        });

        it('afterSendLoop hook can inject messages via queue (drained into chat)', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            service.hook().afterSendLoop().do(() => {
                service.queue().user('Injected in afterSendLoop');
            });
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.role).toBe('assistant');
            expect(messages[0]!.content).toBe('Hello');
            expect(messages[1]!.role).toBe('user');
            expect(messages[1]!.content).toBe('Injected in afterSendLoop');
            const queued = await (service as any)._messageQueue.drain();
            expect(queued).toHaveLength(0);
        });
    });

    describe('hook disposal', () => {
        it('dispose unsubscribes beforeSendLoop hook', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'A' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
                { type: StreamEventType.Content, text: 'B' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const calls: string[] = [];
            const hook = service.hook().beforeSendLoop().do(() => calls.push('fired'));
            hook.dispose();
            await service.send();
            expect(calls).toEqual([]);
        });

        it('dispose unsubscribes beforeSend hook', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'A' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const calls: string[] = [];
            const hook = service.hook().beforeSend().do(() => calls.push('fired'));
            hook.dispose();
            await service.send();
            expect(calls).toEqual([]);
        });

        it('dispose unsubscribes afterSend hook', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'A' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const calls: string[] = [];
            const hook = service.hook().afterSend().do(() => calls.push('fired'));
            hook.dispose();
            await service.send();
            expect(calls).toEqual([]);
        });

        it('dispose unsubscribes afterSendLoop hook', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'A' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const calls: string[] = [];
            const hook = service.hook().afterSendLoop().do(() => calls.push('fired'));
            hook.dispose();
            await service.send();
            expect(calls).toEqual([]);
        });

        it('isDisposed guard prevents callback when hook is disposed mid-cycle', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'A' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const calls: string[] = [];
            const hook = service.hook().beforeSend().do(() => calls.push('fired'));
            // Prevent onDispose from unregistering the handler, then dispose.
            // On the next event emission _onEvent fires but isDisposed returns
            // true, exercising the guard in service-hooks.ts:59.
            vi.spyOn(hook as any, 'onDispose').mockImplementation(() => {});
            hook.dispose();
            await service.send();
            expect(calls).toEqual([]);
        });
    });

    describe('multiple hooks', () => {
        it('fires multiple hooks on the same event in registration order', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const order: number[] = [];
            service.hook().beforeSend().do(() => order.push(1));
            service.hook().beforeSend().do(() => order.push(2));
            service.hook().beforeSend().do(() => order.push(3));
            await service.send();
            expect(order).toEqual([1, 2, 3]);
        });
    });

    describe('hook errors', () => {
        it('throwing in beforeSend hook does not crash the service', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
            service.hook().beforeSend().do(() => { throw new Error('hook error'); });
            await expect(service.send()).resolves.toBeUndefined();
            expect(spy).toHaveBeenCalledWith('Hook callback error:', expect.any(Error));
            spy.mockRestore();
        });

        it('throwing in afterSend hook does not crash the service', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
            service.hook().afterSend().do(() => { throw new Error('hook error'); });
            await expect(service.send()).resolves.toBeUndefined();
            expect(spy).toHaveBeenCalledWith('Hook callback error:', expect.any(Error));
            spy.mockRestore();
        });
    });

    describe('reentrant send from hooks', () => {
        it('reentrant send() from beforeSendLoop does not deadlock (single iteration)', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'A' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const iterations: string[] = [];
            service.hook().beforeSend().do(() => iterations.push('before'));
            service.hook().afterSend().do(() => iterations.push('after'));
            service.hook().beforeSendLoop().do(() => {
                service.send(); // reentrant
            });
            await service.send();
            expect(iterations).toEqual(['before', 'after']);
        });

        it('reentrant send() from afterSend triggers extra iteration', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'A' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
                { type: StreamEventType.Content, text: 'B' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            let called = false;
            service.hook().afterSend().do(() => {
                if (!called) {
                    called = true;
                    service.send(); // reentrant
                }
            });
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(2);
            expect(messages[0]!.content).toBe('A');
            expect(messages[1]!.content).toBe('B');
        });

        it('reentrant send() does not deadlock', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            const wait = new Promise<void>((resolve) => {
                service.hook().beforeSendLoop().do(() => {
                    service.send().then(resolve);
                });
            });
            await service.send();
            await expect(wait).resolves.toBeUndefined();
        });
    });

    describe('hook() accessor', () => {
        it('returns a ServiceHookBuilder', () => {
            const service = new TestChatService([]);
            const builder = service.hook();
            expect(builder).toBeDefined();
            expect(typeof builder.beforeSendLoop).toBe('function');
            expect(typeof builder.afterSendLoop).toBe('function');
            expect(typeof builder.beforeSend).toBe('function');
            expect(typeof builder.afterSend).toBe('function');
        });
    });
});
