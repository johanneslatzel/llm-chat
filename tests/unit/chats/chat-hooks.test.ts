import { describe, it, expect, vi } from 'vitest';
import { ChatMessageOrigin, ChatRole } from '../../../src/index.js';
import { Chat } from '../../../src/chat/chat.js';

describe('Chat hooks', async () => {
    it('fires hook callback when message matches regex and roles', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));

        await chat.user('hello world');

        expect(onMatch).toHaveBeenCalledTimes(1);
        const [msg, m] = onMatch.mock.calls[0]!;
        expect(msg.role).toBe(ChatRole.User);
        expect(msg.content).toBe('hello world');
        expect(m[0]).toBe('hello');
    });

    it('does not fire hook when roles do not match', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        chat.hook().message(ChatRole.Assistant).regex(/hello/).do((message, matches) => onMatch(message, matches));

        await chat.user('hello world');

        expect(onMatch).not.toHaveBeenCalled();
    });

    it('does not fire hook when regex does not match', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        chat.hook().message(ChatRole.User).regex(/nope/).do((message, matches) => onMatch(message, matches));

        await chat.user('hello world');

        expect(onMatch).not.toHaveBeenCalled();
    });

    it('fires hook for reasoning messages', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        chat.hook().message(ChatRole.Reasoning).regex(/step/).do((message, matches) => onMatch(message, matches));

        await chat.reasoning('Thinking step by step');

        expect(onMatch).toHaveBeenCalledTimes(1);
        const [msg] = onMatch.mock.calls[0]!;
        expect(msg.content).toBe('Thinking step by step');
    });

    it('accepts regex as a string', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        chat.hook().message(ChatRole.User).regex('hello').do((message, matches) => onMatch(message, matches));

        await chat.user('hello world');

        expect(onMatch).toHaveBeenCalledTimes(1);
    });

    it('supports multiple hooks on the same chat', async () => {
        const chat = new Chat();
        const onMatch1 = vi.fn();
        const onMatch2 = vi.fn();
        chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch1(message, matches));
        chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch2(message, matches));

        await chat.user('hello');

        expect(onMatch1).toHaveBeenCalledTimes(1);
        expect(onMatch2).toHaveBeenCalledTimes(1);
    });

    it('dispose() stops a hook from firing', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        const hook = chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));
        hook.dispose();
        await chat.user('hello');
        expect(onMatch).not.toHaveBeenCalled();
    });

    it('isDisposed guard in _onMessage prevents callback after dispose', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        const hook = chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));
        const internalOnMessage = (hook as any)._onMessage;
        hook.dispose();
        internalOnMessage({ role: ChatRole.User, content: 'hello', createdAt: new Date(), origin: ChatMessageOrigin.User });
        expect(onMatch).not.toHaveBeenCalled();
    });

    it('dispose() does not throw if called twice', async () => {
        const chat = new Chat();
        const hook = chat.hook().message(ChatRole.User).regex(/hello/).do(() => {});
        hook.dispose();
        expect(() => hook.dispose()).not.toThrow();
    });

    it('maxTriggers fires unlimited by default', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));

        await chat.user('hello');
        await chat.user('hello again');
        await chat.user('hello third');

        expect(onMatch).toHaveBeenCalledTimes(3);
    });

    it('maxTriggers with custom value stops after N fires', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        chat.hook().message(ChatRole.User).regex(/hello/).maxTriggers(2).do((message, matches) => onMatch(message, matches));

        await chat.user('hello');
        await chat.user('hello again');
        await chat.user('hello third');

        expect(onMatch).toHaveBeenCalledTimes(2);
    });

    it('maxTriggers Infinity allows unlimited fires', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        chat.hook().message(ChatRole.User).regex(/hello/).maxTriggers(Infinity).do((message, matches) => onMatch(message, matches));

        await chat.user('hello');
        await chat.user('hello again');
        await chat.user('hello third');

        expect(onMatch).toHaveBeenCalledTimes(3);
    });

    it('maxTriggers prevents re-entrant self-triggering', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();

        chat.hook().message(ChatRole.User).regex(/trigger/).maxTriggers(1).do(async (_message) => {
            onMatch(_message);
            await chat.user('trigger again');
        });

        await chat.user('trigger first');

        expect(onMatch).toHaveBeenCalledTimes(1);
    });

    it('dispose() unsubscribes hook entirely', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        const hook = chat.hook().message(ChatRole.User).regex(/hello/).maxTriggers(1).do((message, matches) => onMatch(message, matches));

        await chat.user('hello');
        expect(onMatch).toHaveBeenCalledTimes(1);

        hook.dispose();
        onMatch.mockClear();

        await chat.user('hello');
        expect(onMatch).not.toHaveBeenCalled();
    });

    it('matches by role only when regex is not set', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        chat.hook().message(ChatRole.User).do((message, matches) => onMatch(message, matches));

        await chat.user('any content at all');
        await chat.assistant('should not match');

        expect(onMatch).toHaveBeenCalledTimes(1);
        const [msg] = onMatch.mock.calls[0]!;
        expect(msg.content).toBe('any content at all');
    });

    it('matches by regex only when roles is not set', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        chat.hook().message().regex(/hello/).maxTriggers(Infinity).do((message, matches) => onMatch(message, matches));

        await chat.user('hello world');
        await chat.assistant('hello back');
        await chat.user('goodbye');

        expect(onMatch).toHaveBeenCalledTimes(2);
        const [, m0] = onMatch.mock.calls[0]!;
        const [, m1] = onMatch.mock.calls[1]!;
        expect(m0[0]).toBe('hello');
        expect(m1[0]).toBe('hello');
    });

    it('chat.hook().message() returns a builder with do()', async () => {
        const chat = new Chat();
        const onMatch = vi.fn();
        const hook = chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));
        expect(hook).toBeTruthy();
        expect(typeof hook.dispose).toBe('function');

        await chat.user('hello');
        expect(onMatch).toHaveBeenCalledTimes(1);
    });

    describe('matching combinations', async () => {
        it('does not match when neither roles nor regex is set', async () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message().do((message, matches) => onMatch(message, matches));
            await chat.user('hello');
            await chat.assistant('world');
            expect(onMatch).not.toHaveBeenCalled();
        });

        it('does not match when regex is not set on message()', async () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message().do((message, matches) => onMatch(message, matches));
            await chat.user('hello');
            expect(onMatch).not.toHaveBeenCalled();
        });

        describe('roles only (no regex)', async () => {
            it('matches any content for matching role', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message(ChatRole.User).maxTriggers(Infinity).do((message, matches) => onMatch(message, matches));

                await chat.user('anything at all');
                await chat.user('more content');
                await chat.assistant('skip me');

                expect(onMatch).toHaveBeenCalledTimes(2);
            });

            it('does not match non-matching role', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message(ChatRole.Assistant).do((message, matches) => onMatch(message, matches));

                await chat.user('user message');
                await chat.reasoning('thinking...');

                expect(onMatch).not.toHaveBeenCalled();
            });

            it('provides synthetic matches with full content', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message(ChatRole.User).do((message, matches) => onMatch(message, matches));

                await chat.user('specific text here');

                expect(onMatch).toHaveBeenCalledTimes(1);
                const [, m] = onMatch.mock.calls[0]!;
                expect(m[0]).toBe('specific text here');
            });

            it('matches reasoning with roles only', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message(ChatRole.Reasoning).do((message, matches) => onMatch(message, matches));

                await chat.reasoning('step by step');

                expect(onMatch).toHaveBeenCalledTimes(1);
                const [msg] = onMatch.mock.calls[0]!;
                expect(msg.role).toBe(ChatRole.Reasoning);
            });
        });

        describe('regex only (no roles)', async () => {
            it('matches any role when regex matches', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message().regex(/hello/i).maxTriggers(Infinity).do((message, matches) => onMatch(message, matches));

                await chat.user('Hello!');
                await chat.assistant('hello there');
                await chat.reasoning('say hello');

                expect(onMatch).toHaveBeenCalledTimes(3);
            });

            it('does not match when regex does not match', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message().regex(/xyz/).do((message, matches) => onMatch(message, matches));

                await chat.user('hello');
                await chat.assistant('world');

                expect(onMatch).not.toHaveBeenCalled();
            });

            it('provides regex match groups', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message().regex(/(\w+) (\w+)/).do((message, matches) => onMatch(message, matches));

                await chat.user('foo bar');

                expect(onMatch).toHaveBeenCalledTimes(1);
                const [, m] = onMatch.mock.calls[0]!;
                expect(m[0]).toBe('foo bar');
                expect(m[1]).toBe('foo');
                expect(m[2]).toBe('bar');
            });
        });

        describe('both roles and regex set', async () => {
            it('matches when both match', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));

                await chat.user('hello');

                expect(onMatch).toHaveBeenCalledTimes(1);
            });

            it('does not match when role matches but regex does not', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message(ChatRole.User).regex(/nope/).do((message, matches) => onMatch(message, matches));

                await chat.user('hello');

                expect(onMatch).not.toHaveBeenCalled();
            });

            it('does not match when regex matches but role does not', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message(ChatRole.Assistant).regex(/hello/).do((message, matches) => onMatch(message, matches));

                await chat.user('hello');

                expect(onMatch).not.toHaveBeenCalled();
            });

            it('matches multiple roles', async () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message(ChatRole.User, ChatRole.Assistant).regex(/hello/).maxTriggers(Infinity).do((message, matches) => onMatch(message, matches));

                await chat.user('hello user');
                await chat.assistant('hello assistant');
                await chat.reasoning('hello thinking');

                expect(onMatch).toHaveBeenCalledTimes(2);
            });
        });
    });
});
