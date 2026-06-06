import { describe, it, expect, vi } from 'vitest';
import { ChatRole, chatFromJSON, type ToolCall } from '../../../src/index.js';
import { Chat } from '../../../src/chats/chat.js';

describe('Chat', () => {
    describe('system message', () => {
        it('exposes system message via systemMessage accessor', () => {
            const chat = new Chat();
            chat.system('You are a helpful assistant.');
            expect(chat.getSystem()).not.toBeNull();
            expect(chat.getSystem()!.role).toBe(ChatRole.System);
            expect(chat.getSystem()!.content).toBe('You are a helpful assistant.');
        });

        it('updates existing system message content without duplication', () => {
            const chat = new Chat();
            chat.system('Original system message.');
            chat.system('Updated system message.');
            expect(chat.getSystem()).not.toBeNull();
            expect(chat.getSystem()!.content).toBe('Updated system message.');
        });

        it('system message stays first after adding other messages', () => {
            const chat = new Chat();
            chat.system('System prompt.');
            chat.user('Hello');
            chat.assistant('Hi there');
            const messages = chat.messages();
            expect(messages).toHaveLength(2);
            expect(chat.getSystem()!.content).toBe('System prompt.');
            expect(messages[0]!.role).toBe(ChatRole.User);
            expect(messages[1]!.role).toBe(ChatRole.Assistant);
        });
    });

    describe('adding messages', () => {
        it('appends user message', () => {
            const chat = new Chat();
            chat.user('Hello');
            const messages = chat.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.User);
            expect(messages[0]!.content).toBe('Hello');
        });

        it('appends assistant message with optional tool_calls', () => {
            const chat = new Chat();
            const toolCall: ToolCall = {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"London"}' }
            };
            chat.assistant('Let me check', [toolCall]);
            const messages = chat.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.Assistant);
            expect(messages[0]!.tool_calls).toEqual([toolCall]);
        });

        it('appends assistant message without tool_calls', () => {
            const chat = new Chat();
            chat.assistant('Sure thing');
            const messages = chat.messages();
            expect(messages[0]!.tool_calls).toBeUndefined();
        });

        it('appends tool result message with tool_call_id', () => {
            const chat = new Chat();
            chat.tool('Result data', 'call_1');
            const messages = chat.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.Tool);
            expect(messages[0]!.content).toBe('Result data');
            expect(messages[0]!.tool_call_id).toBe('call_1');
        });

        it('appends reasoning message', () => {
            const chat = new Chat();
            chat.reasoning('Thinking step by step...');
            const messages = chat.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.Reasoning);
            expect(messages[0]!.content).toBe('Thinking step by step...');
        });
    });

    describe('messages', () => {
        it('returns a copy of messages (immutability)', () => {
            const chat = new Chat();
            chat.user('Hello');
            const messages = chat.messages();
            messages.push({ role: ChatRole.User, content: 'Injected', createdAt: new Date() });
            expect(chat.messages()).toHaveLength(1);
        });
    });

    describe('messages()', () => {
        it('returns messages via the public API method', () => {
            const chat = new Chat();
            chat.system('System');
            chat.user('Hello');
            chat.assistant('World');
            const msgs = chat.messages();
            expect(msgs).toHaveLength(2);
            expect(msgs[0]!.role).toBe(ChatRole.User);
            expect(msgs[1]!.role).toBe(ChatRole.Assistant);
        });

        it('returns a copy (immutability)', () => {
            const chat = new Chat();
            chat.user('Hello');
            const msgs = chat.messages();
            msgs.push({ role: ChatRole.User, content: 'Injected', createdAt: new Date() });
            expect(chat.messages()).toHaveLength(1);
        });

        it('returns empty array on fresh chat with no system message', () => {
            const chat = new Chat();
            expect(chat.messages()).toHaveLength(0);
        });
    });

    describe('clear', () => {
        it('removes all messages including system', () => {
            const chat = new Chat();
            chat.system('System');
            chat.user('Hello');
            chat.assistant('World');
            chat.clear();
            expect(chat.messages()).toHaveLength(0);
        });

        it('works on empty chat', () => {
            const chat = new Chat();
            expect(() => chat.clear()).not.toThrow();
            expect(chat.messages()).toHaveLength(0);
        });
    });

    describe('chatFromJSON', () => {
        it('restores chat state from JSON via standalone function', () => {
            const chat = new Chat();
            chat.system('System');
            chat.user('Hello');
            const json = chat.toJSON();
            const restored = chatFromJSON(json);
            expect(restored.messages()).toHaveLength(1);
            expect(restored.messages()[0]!.content).toBe('Hello');
            expect(restored.getSystem()!.content).toBe('System');
        });

        it('chatFromJSON preserves sessionId', () => {
            const chat = new Chat();
            chat.user('Hello');
            const json = chat.toJSON();
            const restored = chatFromJSON(json);
            expect(restored.toJSON().sessionId).toBe(chat.sessionId);
        });

        it('handles empty messages', () => {
            const restored = chatFromJSON({ systemMessage: null, messages: [] });
            expect(restored.messages()).toHaveLength(0);
        });

        it('returns a ChatInterface', () => {
            const restored = chatFromJSON({ systemMessage: null, messages: [] });
            expect(typeof restored.messages).toBe('function');
            expect(typeof restored.toJSON).toBe('function');
            expect(typeof restored.hook).toBe('function');
        });
    });

    describe('serialization', () => {
        it('generates a unique sessionId for each chat instance', () => {
            const chat1 = new Chat();
            const chat2 = new Chat();
            expect(chat1.sessionId).toBeTruthy();
            expect(chat2.sessionId).toBeTruthy();
            expect(chat1.sessionId).not.toBe(chat2.sessionId);
        });

        it('toJSON returns systemMessage and messages', () => {
            const chat = new Chat();
            chat.system('System');
            chat.user('Hello');
            const json = chat.toJSON();
            expect(json.sessionId).toBe(chat.sessionId);
            expect(json.systemMessage).toBeTruthy();
            expect(json.systemMessage!.content).toBe('System');
            expect(json.messages).toHaveLength(1);
            expect(json.messages[0]!.content).toBe('Hello');
        });

        it('fromJSON preserves sessionId', () => {
            const original = new Chat();
            original.system('System');
            const json = original.toJSON();
            const restored = Chat.fromJSON(json);
            expect(restored.sessionId).toBe(original.sessionId);
        });

        it('fromJSON generates new sessionId when JSON has none', () => {
            const restored = Chat.fromJSON({ systemMessage: null, messages: [] });
            expect(restored.sessionId).toBeTruthy();
        });

        it('fromJSON restores chat state correctly', () => {
            const original = new Chat();
            original.system('System');
            original.user('Hello');
            const json = original.toJSON();
            const restored = Chat.fromJSON(json);
            expect(restored.messages()).toHaveLength(1);
            expect(restored.messages()[0]!.content).toBe('Hello');
            expect(restored.getSystem()!.content).toBe('System');
        });

        it('fromJSON handles empty messages', () => {
            const restored = Chat.fromJSON({ systemMessage: null, messages: [] });
            expect(restored.messages()).toHaveLength(0);
        });

        it('fromJSON without system message works', () => {
            const json = {
                systemMessage: null,
                messages: [{ role: ChatRole.User, content: 'Hello', createdAt: new Date().toISOString() }]
            };
            const restored = Chat.fromJSON(json);
            expect(restored.messages()).toHaveLength(1);
        });

        it('toJSON returns shallow copies of messages', () => {
            const chat = new Chat();
            chat.user('Hello');
            const json = chat.toJSON();
            json.messages[0]!.content = 'Modified';
            expect(chat.messages()[0]!.content).toBe('Hello');
        });
    });

    describe('hooks', () => {
        it('fires hook callback when message matches regex and roles', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));

            chat.user('hello world');

            expect(onMatch).toHaveBeenCalledTimes(1);
            const [msg, m] = onMatch.mock.calls[0]!;
            expect(msg.role).toBe(ChatRole.User);
            expect(msg.content).toBe('hello world');
            expect(m[0]).toBe('hello');
        });

        it('does not fire hook when roles do not match', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message(ChatRole.Assistant).regex(/hello/).do((message, matches) => onMatch(message, matches));

            chat.user('hello world');

            expect(onMatch).not.toHaveBeenCalled();
        });

        it('does not fire hook when regex does not match', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message(ChatRole.User).regex(/nope/).do((message, matches) => onMatch(message, matches));

            chat.user('hello world');

            expect(onMatch).not.toHaveBeenCalled();
        });

        it('fires hook for reasoning messages', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message(ChatRole.Reasoning).regex(/step/).do((message, matches) => onMatch(message, matches));

            chat.reasoning('Thinking step by step');

            expect(onMatch).toHaveBeenCalledTimes(1);
            const [msg] = onMatch.mock.calls[0]!;
            expect(msg.content).toBe('Thinking step by step');
        });

        it('accepts regex as a string', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message(ChatRole.User).regex('hello').do((message, matches) => onMatch(message, matches));

            chat.user('hello world');

            expect(onMatch).toHaveBeenCalledTimes(1);
        });

        it('supports multiple hooks on the same chat', () => {
            const chat = new Chat();
            const onMatch1 = vi.fn();
            const onMatch2 = vi.fn();
            chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch1(message, matches));
            chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch2(message, matches));

            chat.user('hello');

            expect(onMatch1).toHaveBeenCalledTimes(1);
            expect(onMatch2).toHaveBeenCalledTimes(1);
        });

        it('dispose() stops a hook from firing', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            const hook = chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));
            hook.dispose();
            chat.user('hello');
            expect(onMatch).not.toHaveBeenCalled();
        });

        it('dispose() does not throw if called twice', () => {
            const chat = new Chat();
            const hook = chat.hook().message(ChatRole.User).regex(/hello/).do(() => {});
            hook.dispose();
            expect(() => hook.dispose()).not.toThrow();
        });

        it('maxTriggers fires unlimited by default', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));

            chat.user('hello');
            chat.user('hello again');
            chat.user('hello third');

            expect(onMatch).toHaveBeenCalledTimes(3);
        });

        it('maxTriggers with custom value stops after N fires', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message(ChatRole.User).regex(/hello/).maxTriggers(2).do((message, matches) => onMatch(message, matches));

            chat.user('hello');
            chat.user('hello again');
            chat.user('hello third');

            expect(onMatch).toHaveBeenCalledTimes(2);
        });

        it('maxTriggers Infinity allows unlimited fires', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message(ChatRole.User).regex(/hello/).maxTriggers(Infinity).do((message, matches) => onMatch(message, matches));

            chat.user('hello');
            chat.user('hello again');
            chat.user('hello third');

            expect(onMatch).toHaveBeenCalledTimes(3);
        });

        it('maxTriggers prevents re-entrant self-triggering', () => {
            const chat = new Chat();
            const onMatch = vi.fn();

            chat.hook().message(ChatRole.User).regex(/trigger/).maxTriggers(1).do((_message) => {
                onMatch(_message);
                chat.user('trigger again');
            });

            chat.user('trigger first');

            expect(onMatch).toHaveBeenCalledTimes(1);
        });

        it('dispose() unsubscribes hook entirely', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            const hook = chat.hook().message(ChatRole.User).regex(/hello/).maxTriggers(1).do((message, matches) => onMatch(message, matches));

            chat.user('hello');
            expect(onMatch).toHaveBeenCalledTimes(1);

            hook.dispose();
            onMatch.mockClear();

            chat.user('hello');
            expect(onMatch).not.toHaveBeenCalled();
        });

        it('matches by role only when regex is not set', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message(ChatRole.User).do((message, matches) => onMatch(message, matches));

            chat.user('any content at all');
            chat.assistant('should not match');

            expect(onMatch).toHaveBeenCalledTimes(1);
            const [msg] = onMatch.mock.calls[0]!;
            expect(msg.content).toBe('any content at all');
        });

        it('matches by regex only when roles is not set', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            chat.hook().message().regex(/hello/).maxTriggers(Infinity).do((message, matches) => onMatch(message, matches));

            chat.user('hello world');
            chat.assistant('hello back');
            chat.user('goodbye');

            expect(onMatch).toHaveBeenCalledTimes(2);
            const [, m0] = onMatch.mock.calls[0]!;
            const [, m1] = onMatch.mock.calls[1]!;
            expect(m0[0]).toBe('hello');
            expect(m1[0]).toBe('hello');
        });

        it('chat.hook().message() returns a builder with do()', () => {
            const chat = new Chat();
            const onMatch = vi.fn();
            const hook = chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));
            expect(hook).toBeTruthy();
            expect(typeof hook.dispose).toBe('function');

            chat.user('hello');
            expect(onMatch).toHaveBeenCalledTimes(1);
        });

        describe('matching combinations', () => {
            it('does not match when neither roles nor regex is set', () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message().do((message, matches) => onMatch(message, matches));
                chat.user('hello');
                chat.assistant('world');
                expect(onMatch).not.toHaveBeenCalled();
            });

            it('does not match when regex is not set on message()', () => {
                const chat = new Chat();
                const onMatch = vi.fn();
                chat.hook().message().do((message, matches) => onMatch(message, matches));
                chat.user('hello');
                expect(onMatch).not.toHaveBeenCalled();
            });

            describe('roles only (no regex)', () => {
                it('matches any content for matching role', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message(ChatRole.User).maxTriggers(Infinity).do((message, matches) => onMatch(message, matches));

                    chat.user('anything at all');
                    chat.user('more content');
                    chat.assistant('skip me');

                    expect(onMatch).toHaveBeenCalledTimes(2);
                });

                it('does not match non-matching role', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message(ChatRole.Assistant).do((message, matches) => onMatch(message, matches));

                    chat.user('user message');
                    chat.reasoning('thinking...');

                    expect(onMatch).not.toHaveBeenCalled();
                });

                it('provides synthetic matches with full content', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message(ChatRole.User).do((message, matches) => onMatch(message, matches));

                    chat.user('specific text here');

                    expect(onMatch).toHaveBeenCalledTimes(1);
                    const [, m] = onMatch.mock.calls[0]!;
                    expect(m[0]).toBe('specific text here');
                });

                it('matches reasoning with roles only', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message(ChatRole.Reasoning).do((message, matches) => onMatch(message, matches));

                    chat.reasoning('step by step');

                    expect(onMatch).toHaveBeenCalledTimes(1);
                    const [msg] = onMatch.mock.calls[0]!;
                    expect(msg.role).toBe(ChatRole.Reasoning);
                });
            });

            describe('regex only (no roles)', () => {
                it('matches any role when regex matches', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message().regex(/hello/i).maxTriggers(Infinity).do((message, matches) => onMatch(message, matches));

                    chat.user('Hello!');
                    chat.assistant('hello there');
                    chat.reasoning('say hello');

                    expect(onMatch).toHaveBeenCalledTimes(3);
                });

                it('does not match when regex does not match', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message().regex(/xyz/).do((message, matches) => onMatch(message, matches));

                    chat.user('hello');
                    chat.assistant('world');

                    expect(onMatch).not.toHaveBeenCalled();
                });

                it('provides regex match groups', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message().regex(/(\w+) (\w+)/).do((message, matches) => onMatch(message, matches));

                    chat.user('foo bar');

                    expect(onMatch).toHaveBeenCalledTimes(1);
                    const [, m] = onMatch.mock.calls[0]!;
                    expect(m[0]).toBe('foo bar');
                    expect(m[1]).toBe('foo');
                    expect(m[2]).toBe('bar');
                });
            });

            describe('both roles and regex set', () => {
                it('matches when both match', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message(ChatRole.User).regex(/hello/).do((message, matches) => onMatch(message, matches));

                    chat.user('hello');

                    expect(onMatch).toHaveBeenCalledTimes(1);
                });

                it('does not match when role matches but regex does not', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message(ChatRole.User).regex(/nope/).do((message, matches) => onMatch(message, matches));

                    chat.user('hello');

                    expect(onMatch).not.toHaveBeenCalled();
                });

                it('does not match when regex matches but role does not', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message(ChatRole.Assistant).regex(/hello/).do((message, matches) => onMatch(message, matches));

                    chat.user('hello');

                    expect(onMatch).not.toHaveBeenCalled();
                });

                it('matches multiple roles', () => {
                    const chat = new Chat();
                    const onMatch = vi.fn();
                    chat.hook().message(ChatRole.User, ChatRole.Assistant).regex(/hello/).maxTriggers(Infinity).do((message, matches) => onMatch(message, matches));

                    chat.user('hello user');
                    chat.assistant('hello assistant');
                    chat.reasoning('hello thinking');

                    expect(onMatch).toHaveBeenCalledTimes(2);
                });
            });
        });
    });
});
