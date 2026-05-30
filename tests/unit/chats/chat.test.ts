import { describe, it, expect, vi } from 'vitest';
import { ChatRole, FinishReason, chatFromJSON, type ToolCall } from '../../../src/index.js';
import { Chat, ChatEvent } from '../../../src/chats/chat.js';

describe('Chat', () => {
    describe('system message', () => {
        it('sets system message as first message', () => {
            const chat = new Chat();
            chat.system('You are a helpful assistant.');
            const messages = chat.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.System);
            expect(messages[0]!.content).toBe('You are a helpful assistant.');
        });

        it('updates existing system message content without duplication', () => {
            const chat = new Chat();
            chat.system('Original system message.');
            chat.system('Updated system message.');
            const messages = chat.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.content).toBe('Updated system message.');
        });

        it('system message stays first after adding other messages', () => {
            const chat = new Chat();
            chat.system('System prompt.');
            chat.user('Hello');
            chat.assistant('Hi there');
            const messages = chat.getMessages();
            expect(messages).toHaveLength(3);
            expect(messages[0]!.role).toBe(ChatRole.System);
            expect(messages[1]!.role).toBe(ChatRole.User);
            expect(messages[2]!.role).toBe(ChatRole.Assistant);
        });
    });

    describe('adding messages', () => {
        it('appends user message and emits Message event', () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.on(ChatEvent.Message, handler);
            chat.user('Hello');
            const messages = chat.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.User);
            expect(messages[0]!.content).toBe('Hello');
            expect(handler).toHaveBeenCalledWith(messages[0]);
        });

        it('appends assistant message with optional tool_calls', () => {
            const chat = new Chat();
            const toolCall: ToolCall = {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"London"}' }
            };
            chat.assistant('Let me check', [toolCall]);
            const messages = chat.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.Assistant);
            expect(messages[0]!.tool_calls).toEqual([toolCall]);
        });

        it('appends assistant message without tool_calls', () => {
            const chat = new Chat();
            chat.assistant('Sure thing');
            const messages = chat.getMessages();
            expect(messages[0]!.tool_calls).toBeUndefined();
        });

        it('appends tool result message with tool_call_id', () => {
            const chat = new Chat();
            chat.tool('Result data', 'call_1');
            const messages = chat.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe(ChatRole.Tool);
            expect(messages[0]!.content).toBe('Result data');
            expect(messages[0]!.tool_call_id).toBe('call_1');
        });
    });

    describe('event system', () => {
        it('emits Message event for user, assistant, and tool calls', () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.on(ChatEvent.Message, handler);
            chat.user('Hello');
            chat.assistant('World');
            chat.tool('Result', 'call_1');
            expect(handler).toHaveBeenCalledTimes(3);
        });

        it('emits Chunk event', () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.on(ChatEvent.Chunk, handler);
            chat.chunk('Hello');
            chat.chunk(' World');
            expect(handler).toHaveBeenCalledTimes(2);
            expect(handler).toHaveBeenCalledWith('Hello');
            expect(handler).toHaveBeenCalledWith(' World');
        });

        it('emits Reasoning event', () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.on(ChatEvent.Reasoning, handler);
            chat.reasoning('Thinking step by step...');
            expect(handler).toHaveBeenCalledWith('Thinking step by step...');
        });

        it('creates a ChatMessage with Reasoning role', () => {
            const chat = new Chat();
            chat.reasoning('Thinking step by step...');
            const messages = chat.getMessages();
            const last = messages[messages.length - 1]!;
            expect(last.role).toBe(ChatRole.Reasoning);
            expect(last.content).toBe('Thinking step by step...');
        });

        it('emits Message event for reasoning', () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.on(ChatEvent.Message, handler);
            chat.reasoning('Thinking...');
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ role: ChatRole.Reasoning, content: 'Thinking...' })
            );
        });

        it('emits Finish event', () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.on(ChatEvent.Finish, handler);
            chat.finish(FinishReason.Stop);
            expect(handler).toHaveBeenCalledWith(FinishReason.Stop);
        });

        it('can remove a specific event handler with off()', () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.on(ChatEvent.Message, handler);
            chat.user('Hello');
            expect(handler).toHaveBeenCalledTimes(1);
            chat.off(ChatEvent.Message, handler);
            chat.user('World');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('supports multiple listeners on the same event', () => {
            const chat = new Chat();
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            chat.on(ChatEvent.Message, handler1);
            chat.on(ChatEvent.Message, handler2);
            chat.user('Hello');
            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);
        });

        it('does not throw when emitting with no listeners', () => {
            const chat = new Chat();
            expect(() => chat.chunk('test')).not.toThrow();
            expect(() => chat.finish(FinishReason.Stop)).not.toThrow();
        });

        it('handlers can be added and removed independently', () => {
            const chat = new Chat();
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            chat.on(ChatEvent.Chunk, handler1);
            chat.on(ChatEvent.Chunk, handler2);
            chat.off(ChatEvent.Chunk, handler1);
            chat.chunk('test');
            expect(handler1).not.toHaveBeenCalled();
            expect(handler2).toHaveBeenCalledTimes(1);
        });
    });

    describe('getMessages', () => {
        it('returns a copy of messages (immutability)', () => {
            const chat = new Chat();
            chat.user('Hello');
            const messages = chat.getMessages();
            messages.push({ role: ChatRole.User, content: 'Injected' });
            expect(chat.getMessages()).toHaveLength(1);
        });
    });

    describe('messages()', () => {
        it('returns messages via the public API method', () => {
            const chat = new Chat();
            chat.system('System');
            chat.user('Hello');
            chat.assistant('World');
            const msgs = chat.messages();
            expect(msgs).toHaveLength(3);
            expect(msgs[0]!.role).toBe(ChatRole.System);
            expect(msgs[1]!.role).toBe(ChatRole.User);
            expect(msgs[2]!.role).toBe(ChatRole.Assistant);
        });

        it('returns a copy (immutability)', () => {
            const chat = new Chat();
            chat.user('Hello');
            const msgs = chat.messages();
            msgs.push({ role: ChatRole.User, content: 'Injected' });
            expect(chat.messages()).toHaveLength(1);
        });

        it('returns empty array on fresh chat with no system message', () => {
            const chat = new Chat();
            expect(chat.messages()).toHaveLength(0);
        });
    });

    describe('clear', () => {
        it('removes all non-system messages', () => {
            const chat = new Chat();
            chat.system('System');
            chat.user('Hello');
            chat.assistant('World');
            chat.clear();
            expect(chat.getMessages()).toHaveLength(1);
            expect(chat.getMessages()[0]!.content).toBe('System');
        });

        it('updates system prompt when content is provided', () => {
            const chat = new Chat();
            chat.system('Old system');
            chat.user('Hello');
            chat.clear('New system');
            const messages = chat.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.content).toBe('New system');
        });

        it('works on empty chat', () => {
            const chat = new Chat();
            expect(() => chat.clear()).not.toThrow();
            expect(chat.getMessages()).toHaveLength(0);
        });
    });

    describe('chatFromJSON', () => {
        it('restores chat state from JSON via standalone function', () => {
            const chat = new Chat();
            chat.system('System');
            chat.user('Hello');
            const json = chat.toJSON();
            const restored = chatFromJSON(json);
            expect(restored.messages()).toHaveLength(2);
            expect(restored.messages()[0]!.content).toBe('System');
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
        it('toJSON returns systemMessage and messages', () => {
            const chat = new Chat();
            chat.system('System');
            chat.user('Hello');
            const json = chat.toJSON();
            expect(json.systemMessage).toBeTruthy();
            expect(json.systemMessage!.content).toBe('System');
            expect(json.messages).toHaveLength(2);
        });

        it('fromJSON restores chat state correctly', () => {
            const original = new Chat();
            original.system('System');
            original.user('Hello');
            const json = original.toJSON();
            const restored = Chat.fromJSON(json);
            expect(restored.getMessages()).toHaveLength(2);
            expect(restored.getMessages()[0]!.content).toBe('System');
            expect(restored.getMessages()[1]!.content).toBe('Hello');
        });

        it('fromJSON handles empty messages', () => {
            const restored = Chat.fromJSON({ systemMessage: null, messages: [] });
            expect(restored.getMessages()).toHaveLength(0);
        });

        it('fromJSON without system message works', () => {
            const json = {
                systemMessage: null,
                messages: [{ role: ChatRole.User, content: 'Hello' }]
            };
            const restored = Chat.fromJSON(json);
            expect(restored.getMessages()).toHaveLength(1);
        });

        it('toJSON returns shallow copies of messages', () => {
            const chat = new Chat();
            chat.user('Hello');
            const json = chat.toJSON();
            json.messages[0]!.content = 'Modified';
            expect(chat.getMessages()[0]!.content).toBe('Hello');
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

        it('chunk() hook fires callback on chunk events', () => {
            const chat = new Chat();
            const onChunk = vi.fn();
            chat.hook().chunk(onChunk);
            chat.chunk('Hello');
            chat.chunk(' World');
            expect(onChunk).toHaveBeenCalledTimes(2);
            expect(onChunk).toHaveBeenCalledWith(chat, 'Hello');
            expect(onChunk).toHaveBeenCalledWith(chat, ' World');
        });

        it('chunk() hook dispose stops callbacks', () => {
            const chat = new Chat();
            const onChunk = vi.fn();
            const hook = chat.hook().chunk(onChunk);
            hook.dispose();
            chat.chunk('Hello');
            expect(onChunk).not.toHaveBeenCalled();
        });

        it('reasoning() hook fires callback on reasoning events', () => {
            const chat = new Chat();
            const onReasoning = vi.fn();
            chat.hook().reasoning(onReasoning);
            chat.reasoning('Thinking step by step');
            expect(onReasoning).toHaveBeenCalledTimes(1);
            expect(onReasoning).toHaveBeenCalledWith(chat, 'Thinking step by step');
        });

        it('reasoning() hook dispose stops callbacks', () => {
            const chat = new Chat();
            const onReasoning = vi.fn();
            const hook = chat.hook().reasoning(onReasoning);
            hook.dispose();
            chat.reasoning('Thinking...');
            expect(onReasoning).not.toHaveBeenCalled();
        });

        it('finish() hook fires callback on finish events', () => {
            const chat = new Chat();
            const onFinish = vi.fn();
            chat.hook().finish(onFinish);
            chat.finish(FinishReason.Stop);
            expect(onFinish).toHaveBeenCalledTimes(1);
            expect(onFinish).toHaveBeenCalledWith(chat, FinishReason.Stop);
        });

        it('finish() hook dispose stops callbacks', () => {
            const chat = new Chat();
            const onFinish = vi.fn();
            const hook = chat.hook().finish(onFinish);
            hook.dispose();
            chat.finish(FinishReason.Stop);
            expect(onFinish).not.toHaveBeenCalled();
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



