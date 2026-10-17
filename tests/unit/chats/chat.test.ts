import { describe, it, expect, vi } from 'vitest';
import { ChatMessageOrigin, ChatRole, chatFromJSON, Prompt, type ToolCall } from '../../../src/index.js';
import { Chat } from '../../../src/chat/chat.js';

describe('Chat', async () => {
    describe('system message', async () => {
        it('exposes system message via systemMessage accessor', async () => {
            const chat = new Chat();
            chat.system().add(new Prompt('Title', 'You are a helpful assistant.'));
            expect(chat.getSystem()).not.toBeNull();
            expect(chat.getSystem()!.role).toBe(ChatRole.System);
            expect(chat.getSystem()!.content).toContain('You are a helpful assistant.');
        });

        it('supports adding multiple components', async () => {
            const chat = new Chat();
            chat.system().add(new Prompt('First', 'Original content.'));
            chat.system().add(new Prompt('Second', 'Additional content.'));
            expect(chat.getSystem()).not.toBeNull();
            expect(chat.getSystem()!.content).toContain('Original content.');
            expect(chat.getSystem()!.content).toContain('Additional content.');
        });

        it('system message stays first after adding other messages', async () => {
            const chat = new Chat();
            chat.system().add(new Prompt('Title', 'System prompt.'));
            await chat.user('Hello');
            await chat.assistant('Hi there');
            const messages = chat.messages();
            expect(messages).toHaveLength(2);
            expect(chat.getSystem()!.content).toContain('System prompt.');
            expect(messages[0]!.role).toBe(ChatRole.User);
            expect(messages[1]!.role).toBe(ChatRole.Assistant);
        });

        it('uses an installed system resolver instead of the tree', () => {
            const chat = new Chat();
            chat.system().add(new Prompt('Title', 'Tree content.'));
            chat.setSystemResolver(() => ({
                role: ChatRole.System,
                content: 'Resolved override.',
                createdAt: new Date(),
                origin: ChatMessageOrigin.System
            }));
            expect(chat.getSystem()!.content).toBe('Resolved override.');
        });

        it('falls back to the tree when the resolver returns undefined', () => {
            const chat = new Chat();
            chat.system().add(new Prompt('Title', 'Tree content.'));
            chat.setSystemResolver(() => undefined);
            expect(chat.getSystem()!.content).toContain('Tree content.');
        });

        it('returns null when the resolver returns undefined and the tree is empty', () => {
            const chat = new Chat();
            chat.setSystemResolver(() => undefined);
            expect(chat.getSystem()).toBeNull();
        });

        it('keeps the resolver after clear()', () => {
            const chat = new Chat();
            chat.setSystemResolver(() => ({
                role: ChatRole.System,
                content: 'Resolved override.',
                createdAt: new Date(),
                origin: ChatMessageOrigin.System
            }));
            chat.clear();
            expect(chat.getSystem()!.content).toBe('Resolved override.');
        });

        it('restores tree-only behavior when the resolver is removed', () => {
            const chat = new Chat();
            chat.system().add(new Prompt('Title', 'Tree content.'));
            chat.setSystemResolver(() => ({
                role: ChatRole.System,
                content: 'Resolved override.',
                createdAt: new Date(),
                origin: ChatMessageOrigin.System
            }));
            chat.setSystemResolver(null);
            expect(chat.getSystem()!.content).toContain('Tree content.');
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
            messages.push({ role: ChatRole.User, content: 'Injected', createdAt: new Date(), origin: ChatMessageOrigin.User });
            expect(chat.messages()).toHaveLength(1);
        });
    });

    describe('messages()', async () => {
        it('returns messages via the public API method', async () => {
            const chat = new Chat();
            chat.system().add(new Prompt('Title', 'System'));
            await chat.user('Hello');
            await chat.assistant('World');
            const msgs = chat.messages();
            expect(msgs).toHaveLength(2);
            expect(msgs[0]!.role).toBe(ChatRole.User);
            expect(msgs[1]!.role).toBe(ChatRole.Assistant);
        });

        it('returns deep copy (message object mutations are isolated)', async () => {
            const chat = new Chat();
            await chat.user('Hello');
            const msgs = chat.messages();
            msgs[0]!.content = 'mutated';
            msgs[0]!.createdAt.setFullYear(2000);
            expect(chat.messages()[0]!.content).toBe('Hello');
            expect(chat.messages()[0]!.createdAt.getFullYear()).not.toBe(2000);
        });

        it('returns empty array on fresh chat with no system message', async () => {
            const chat = new Chat();
            expect(chat.messages()).toHaveLength(0);
        });
    });

    describe('clear', async () => {
        it('removes all messages including system and historic', async () => {
            const chat = new Chat();
            chat.system().add(new Prompt('Title', 'System'));
            await chat.user('Hello');
            await chat.handoff({ apply: () => [] });
            chat.clear();
            expect(chat.messages()).toHaveLength(0);
            expect(chat.historicMessages()).toHaveLength(0);
            expect(chat.getSystem()).toBeNull();
        });

        it('works on empty chat', async () => {
            const chat = new Chat();
            expect(() => chat.clear()).not.toThrow();
            expect(chat.messages()).toHaveLength(0);
        });

        it('clears in-place (same container object after clear)', async () => {
            const chat = new Chat();
            const sys = chat.system();
            sys.add(new Prompt('Title', 'content'));
            chat.clear();
            expect(chat.system()).toBe(sys);
            expect(chat.system().hasContent()).toBe(false);
        });

        it('clears registered hooks so they no longer fire on new messages', async () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.hook().message(ChatRole.User).do((msg) => handler(msg.content));

            await chat.user('before');
            expect(handler).toHaveBeenCalledTimes(1);

            chat.clear();

            await chat.user('after');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('retainHooks keeps hooks active after clear', async () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.hook().message(ChatRole.User).do((msg) => handler(msg.content));

            await chat.user('before');
            expect(handler).toHaveBeenCalledTimes(1);

            chat.clear(true);

            await chat.user('after');
            expect(handler).toHaveBeenCalledTimes(2);
        });
    });

    describe('addAll', async () => {
        it('adds non-system messages', async () => {
            const chat = new Chat();
            await chat.addAll([
                { role: ChatRole.User, content: 'Hello', createdAt: new Date(), origin: ChatMessageOrigin.User },
                { role: ChatRole.Assistant, content: 'Hi', createdAt: new Date(), origin: ChatMessageOrigin.Model },
            ]);
            expect(chat.messages()).toHaveLength(2);
        });

        it('rejects system messages via addAll', async () => {
            const chat = new Chat();
            await expect(
                chat.addAll([
                    { role: ChatRole.System, content: 'You are a bot.', createdAt: new Date(), origin: ChatMessageOrigin.System },
                    { role: ChatRole.User, content: 'Hello', createdAt: new Date(), origin: ChatMessageOrigin.User },
                ])
            ).rejects.toThrow('Cannot add system messages via addAll');
            expect(chat.messages()).toHaveLength(0);
        });
    });

    describe('chatFromJSON', async () => {
        it('restores chat state from JSON via standalone function', async () => {
            const chat = new Chat();
            chat.system().add(new Prompt('System Prompt', 'System'));
            await chat.user('Hello');
            const json = chat.toJSON();
            const restored = chatFromJSON(json);
            expect(restored.messages()).toHaveLength(1);
            expect(restored.messages()[0]!.content).toBe('Hello');
            expect(restored.getSystem()!.content).toContain('System');
        });

        it('chatFromJSON preserves sessionId', async () => {
            const chat = new Chat();
            await chat.user('Hello');
            const json = chat.toJSON();
            const restored = chatFromJSON(json);
            expect(restored.toJSON().sessionId).toBe(chat.sessionId());
        });

        it('handles empty messages', async () => {
            const restored = chatFromJSON({ sessionId: '', systemPrompt: null, messages: [] });
            expect(restored.messages()).toHaveLength(0);
        });

        it('returns a ChatInterface', async () => {
            const restored = chatFromJSON({ sessionId: '', systemPrompt: null, messages: [] });
            expect(typeof restored.messages).toBe('function');
            expect(typeof restored.toJSON).toBe('function');
            expect(typeof restored.hook).toBe('function');
        });
    });

    describe('serialization', async () => {
        it('generates a unique sessionId for each chat instance', async () => {
            const chat1 = new Chat();
            const chat2 = new Chat();
            expect(chat1.sessionId()).toBeTruthy();
            expect(chat2.sessionId()).toBeTruthy();
            expect(chat1.sessionId()).not.toBe(chat2.sessionId());
        });

        it('exposes sessionId via ChatInterface', async () => {
            const chat: import('../../../src/index.js').ChatInterface = new Chat();
            expect(chat.sessionId()).toBeTruthy();
            expect(typeof chat.sessionId()).toBe('string');
        });

        it('toJSON requires sessionId in ChatJSON', async () => {
            const chat = new Chat();
            await chat.user('Hello');
            const json: import('../../../src/index.js').ChatJSON = chat.toJSON();
            expect(json.sessionId).toBe(chat.sessionId());
        });

        it('toJSON returns systemPrompt and messages', async () => {
            const chat = new Chat();
            chat.system().add(new Prompt('System Prompt', 'System'));
            await chat.user('Hello');
            const json = chat.toJSON();
            expect(json.sessionId).toBe(chat.sessionId());
            expect(json.systemPrompt).toBeTruthy();
            const prompt: any = json.systemPrompt;
            expect(prompt.type).toBe('container');
            expect(prompt.components).toHaveLength(1);
            expect(prompt.components[0].type).toBe('prompt');
            expect(prompt.components[0].content).toBe('System');
            expect(json.messages).toHaveLength(1);
            expect(json.messages[0]!.content).toBe('Hello');
        });

        it('fromJSON preserves sessionId', async () => {
            const original = new Chat();
            original.system().add(new Prompt('System Prompt', 'System'));
            const json = original.toJSON();
            const restored = Chat.fromJSON(json);
            expect(restored.sessionId()).toBe(original.sessionId());
        });

        it('fromJSON generates new sessionId when JSON has none', async () => {
            const restored = Chat.fromJSON({ sessionId: '', systemPrompt: null, messages: [] });
            expect(restored.sessionId()).toBeTruthy();
        });

        it('fromJSON restores chat state correctly', async () => {
            const original = new Chat();
            original.system().add(new Prompt('System Prompt', 'System'));
            await original.user('Hello');
            const json = original.toJSON();
            const restored = Chat.fromJSON(json);
            expect(restored.messages()).toHaveLength(1);
            expect(restored.messages()[0]!.content).toBe('Hello');
            expect(restored.getSystem()!.content).toContain('System');
        });

        it('fromJSON handles empty messages', async () => {
            const restored = Chat.fromJSON({ sessionId: '', systemPrompt: null, messages: [] });
            expect(restored.messages()).toHaveLength(0);
        });

        it('fromJSON without system message works', async () => {
            const json = {
                sessionId: '',
                systemPrompt: null,
                messages: [{ role: ChatRole.User, content: 'Hello', createdAt: new Date().toISOString(), origin: ChatMessageOrigin.User }]
            };
            const restored = Chat.fromJSON(json);
            expect(restored.messages()).toHaveLength(1);
            expect(restored.messages()[0]!.origin).toBe(ChatMessageOrigin.User);
        });

        it('toJSON returns shallow copies of messages', async () => {
            const chat = new Chat();
            await chat.user('Hello');
            const json = chat.toJSON();
            json.messages[0]!.content = 'Modified';
            expect(chat.messages()[0]!.content).toBe('Hello');
        });
    });

    describe('silent', async () => {
        it('suppresses message emission to hooks when silent is true', async () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.hook().message(ChatRole.User).do((msg) => handler(msg.content));
            chat.silent(true);
            await chat.user('hello');
            expect(handler).not.toHaveBeenCalled();
        });

        it('resumes message emission after silent(false)', async () => {
            const chat = new Chat();
            const handler = vi.fn();
            chat.hook().message(ChatRole.User).do((msg) => handler(msg.content));
            chat.silent(true);
            await chat.user('first');
            expect(handler).not.toHaveBeenCalled();
            chat.silent(false);
            await chat.user('second');
            expect(handler).toHaveBeenCalledWith('second');
        });

        it('messages are still added to history when silent', async () => {
            const chat = new Chat();
            chat.silent(true);
            await chat.user('hello');
            expect(chat.messages()).toHaveLength(1);
            expect(chat.messages()[0]!.content).toBe('hello');
        });
    });

    describe('clearMessages', async () => {
        it('removes conversation and historic messages, preserving system prompt and hooks', async () => {
            const chat = new Chat();
            chat.system().add(new Prompt('Title', 'System prompt'));
            await chat.user('Hello');
            await chat.handoff({ apply: () => [] });
            expect(chat.historicMessages()).toHaveLength(1);
            const handler = vi.fn();
            chat.hook().message(ChatRole.User).do((msg) => handler(msg.content));
            chat.clearMessages();
            expect(chat.messages()).toHaveLength(0);
            expect(chat.historicMessages()).toHaveLength(0);
            expect(chat.getSystem()).not.toBeNull();
            expect(chat.getSystem()!.content).toContain('System prompt');
            await chat.user('after');
            expect(handler).toHaveBeenCalledWith('after');
        });

        it('works on empty chat', async () => {
            const chat = new Chat();
            expect(() => chat.clearMessages()).not.toThrow();
            expect(chat.messages()).toHaveLength(0);
        });
    });
});
