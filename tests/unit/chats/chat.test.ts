import { describe, it, expect, vi } from 'vitest';
import { ChatRole, chatFromJSON, type ToolCall } from '../../../src/index.js';
import { Chat } from '../../../src/chats/chat.js';

describe('Chat', async () => {
    describe('system message', async () => {
        it('exposes system message via systemMessage accessor', async () => {
            const chat = new Chat();
            await chat.system('You are a helpful assistant.');
            expect(chat.getSystem()).not.toBeNull();
            expect(chat.getSystem()!.role).toBe(ChatRole.System);
            expect(chat.getSystem()!.content).toBe('You are a helpful assistant.');
        });

        it('updates existing system message content without duplication', async () => {
            const chat = new Chat();
            await chat.system('Original system message.');
            await chat.system('Updated system message.');
            expect(chat.getSystem()).not.toBeNull();
            expect(chat.getSystem()!.content).toBe('Updated system message.');
        });

        it('system message stays first after adding other messages', async () => {
            const chat = new Chat();
            await chat.system('System prompt.');
            await chat.user('Hello');
            await chat.assistant('Hi there');
            const messages = chat.messages();
            expect(messages).toHaveLength(2);
            expect(chat.getSystem()!.content).toBe('System prompt.');
            expect(messages[0]!.role).toBe(ChatRole.User);
            expect(messages[1]!.role).toBe(ChatRole.Assistant);
        });
    });

    describe('adding messages', async () => {
        it('appends user message', async () => {
            const chat = new Chat();
            await chat.user('Hello');
            const messages = chat.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.User);
            expect(messages[0]!.content).toBe('Hello');
        });

        it('appends assistant message with optional tool_calls', async () => {
            const chat = new Chat();
            const toolCall: ToolCall = {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"London"}' }
            };
            await chat.assistant('Let me check', [toolCall]);
            const messages = chat.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.Assistant);
            expect(messages[0]!.tool_calls).toEqual([toolCall]);
        });

        it('appends assistant message without tool_calls', async () => {
            const chat = new Chat();
            await chat.assistant('Sure thing');
            const messages = chat.messages();
            expect(messages[0]!.tool_calls).toBeUndefined();
        });

        it('appends tool result message with tool_call_id', async () => {
            const chat = new Chat();
            await chat.tool('Result data', 'call_1');
            const messages = chat.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.Tool);
            expect(messages[0]!.content).toBe('Result data');
            expect(messages[0]!.tool_call_id).toBe('call_1');
        });

        it('appends reasoning message', async () => {
            const chat = new Chat();
            await chat.reasoning('Thinking step by step...');
            const messages = chat.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.Reasoning);
            expect(messages[0]!.content).toBe('Thinking step by step...');
        });
    });

    describe('messages', async () => {
        it('returns a copy of messages (immutability)', async () => {
            const chat = new Chat();
            await chat.user('Hello');
            const messages = chat.messages();
            messages.push({ role: ChatRole.User, content: 'Injected', createdAt: new Date() });
            expect(chat.messages()).toHaveLength(1);
        });
    });

    describe('messages()', async () => {
        it('returns messages via the public API method', async () => {
            const chat = new Chat();
            await chat.system('System');
            await chat.user('Hello');
            await chat.assistant('World');
            const msgs = chat.messages();
            expect(msgs).toHaveLength(2);
            expect(msgs[0]!.role).toBe(ChatRole.User);
            expect(msgs[1]!.role).toBe(ChatRole.Assistant);
        });

        it('returns a copy (immutability)', async () => {
            const chat = new Chat();
            await chat.user('Hello');
            const msgs = chat.messages();
            msgs.push({ role: ChatRole.User, content: 'Injected', createdAt: new Date() });
            expect(chat.messages()).toHaveLength(1);
        });

        it('returns empty array on fresh chat with no system message', async () => {
            const chat = new Chat();
            expect(chat.messages()).toHaveLength(0);
        });
    });

    describe('clear', async () => {
        it('removes all messages including system', async () => {
            const chat = new Chat();
            await chat.system('System');
            await chat.user('Hello');
            await chat.assistant('World');
            chat.clear();
            expect(chat.messages()).toHaveLength(0);
        });

        it('works on empty chat', async () => {
            const chat = new Chat();
            expect(() => chat.clear()).not.toThrow();
            expect(chat.messages()).toHaveLength(0);
        });
    });

    describe('addAll', async () => {
        it('adds non-system messages', async () => {
            const chat = new Chat();
            await chat.addAll([
                { role: ChatRole.User, content: 'Hello', createdAt: new Date() },
                { role: ChatRole.Assistant, content: 'Hi', createdAt: new Date() },
            ]);
            expect(chat.messages()).toHaveLength(2);
        });

        it('adds system message when none exists', async () => {
            const chat = new Chat();
            await chat.addAll([
                { role: ChatRole.System, content: 'You are a bot.', createdAt: new Date() },
                { role: ChatRole.User, content: 'Hello', createdAt: new Date() },
            ]);
            expect(chat.getSystem()!.content).toBe('You are a bot.');
            expect(chat.messages()).toHaveLength(1);
        });

        it('updates existing system message', async () => {
            const chat = new Chat();
            await chat.system('Original system');
            await chat.addAll([
                { role: ChatRole.System, content: 'Updated system', createdAt: new Date() },
            ]);
            expect(chat.getSystem()!.content).toBe('Updated system');
            expect(chat.messages()).toHaveLength(0);
        });
    });

    describe('chatFromJSON', async () => {
        it('restores chat state from JSON via standalone function', async () => {
            const chat = new Chat();
            await chat.system('System');
            await chat.user('Hello');
            const json = chat.toJSON();
            const restored = chatFromJSON(json);
            expect(restored.messages()).toHaveLength(1);
            expect(restored.messages()[0]!.content).toBe('Hello');
            expect(restored.getSystem()!.content).toBe('System');
        });

        it('chatFromJSON preserves sessionId', async () => {
            const chat = new Chat();
            await chat.user('Hello');
            const json = chat.toJSON();
            const restored = chatFromJSON(json);
            expect(restored.toJSON().sessionId).toBe(chat.sessionId);
        });

        it('handles empty messages', async () => {
            const restored = chatFromJSON({ systemMessage: null, messages: [] });
            expect(restored.messages()).toHaveLength(0);
        });

        it('returns a ChatInterface', async () => {
            const restored = chatFromJSON({ systemMessage: null, messages: [] });
            expect(typeof restored.messages).toBe('function');
            expect(typeof restored.toJSON).toBe('function');
            expect(typeof restored.hook).toBe('function');
        });
    });

    describe('serialization', async () => {
        it('generates a unique sessionId for each chat instance', async () => {
            const chat1 = new Chat();
            const chat2 = new Chat();
            expect(chat1.sessionId).toBeTruthy();
            expect(chat2.sessionId).toBeTruthy();
            expect(chat1.sessionId).not.toBe(chat2.sessionId);
        });

        it('toJSON returns systemMessage and messages', async () => {
            const chat = new Chat();
            await chat.system('System');
            await chat.user('Hello');
            const json = chat.toJSON();
            expect(json.sessionId).toBe(chat.sessionId);
            expect(json.systemMessage).toBeTruthy();
            expect(json.systemMessage!.content).toBe('System');
            expect(json.messages).toHaveLength(1);
            expect(json.messages[0]!.content).toBe('Hello');
        });

        it('fromJSON preserves sessionId', async () => {
            const original = new Chat();
            await original.system('System');
            const json = original.toJSON();
            const restored = Chat.fromJSON(json);
            expect(restored.sessionId).toBe(original.sessionId);
        });

        it('fromJSON generates new sessionId when JSON has none', async () => {
            const restored = Chat.fromJSON({ systemMessage: null, messages: [] });
            expect(restored.sessionId).toBeTruthy();
        });

        it('fromJSON restores chat state correctly', async () => {
            const original = new Chat();
            await original.system('System');
            await original.user('Hello');
            const json = original.toJSON();
            const restored = Chat.fromJSON(json);
            expect(restored.messages()).toHaveLength(1);
            expect(restored.messages()[0]!.content).toBe('Hello');
            expect(restored.getSystem()!.content).toBe('System');
        });

        it('fromJSON handles empty messages', async () => {
            const restored = Chat.fromJSON({ systemMessage: null, messages: [] });
            expect(restored.messages()).toHaveLength(0);
        });

        it('fromJSON without system message works', async () => {
            const json = {
                systemMessage: null,
                messages: [{ role: ChatRole.User, content: 'Hello', createdAt: new Date().toISOString() }]
            };
            const restored = Chat.fromJSON(json);
            expect(restored.messages()).toHaveLength(1);
        });

        it('toJSON returns shallow copies of messages', async () => {
            const chat = new Chat();
            await chat.user('Hello');
            const json = chat.toJSON();
            json.messages[0]!.content = 'Modified';
            expect(chat.messages()[0]!.content).toBe('Hello');
        });
    });

    describe('hooks', async () => {
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
            internalOnMessage({ role: ChatRole.User, content: 'hello', createdAt: new Date() });
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
});
