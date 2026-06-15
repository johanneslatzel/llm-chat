import { describe, it, expect } from 'vitest';
import { MessageQueue } from '../../../src/chats/queue.js';
import { ChatRole } from '../../../src/chats/chat.js';

describe('MessageQueue', () => {
    it('queues and clears user message', async () => {
        const q = new MessageQueue();
        await q.user('Hello');
        const msgs = await q.clear();
        expect(msgs).toHaveLength(1);
        expect(msgs[0]!.role).toBe(ChatRole.User);
        expect(msgs[0]!.content).toBe('Hello');
    });

    it('queues assistant message without tool_calls', async () => {
        const q = new MessageQueue();
        await q.assistant('Sure thing');
        const msgs = await q.clear();
        expect(msgs[0]!.role).toBe(ChatRole.Assistant);
        expect(msgs[0]!.tool_calls).toBeUndefined();
    });

    it('queues assistant message with tool_calls', async () => {
        const q = new MessageQueue();
        await q.assistant('Let me check', [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }]);
        const msgs = await q.clear();
        expect(msgs[0]!.tool_calls).toHaveLength(1);
    });

    it('queues tool message', async () => {
        const q = new MessageQueue();
        await q.tool('Result data', 'call_1');
        const msgs = await q.clear();
        expect(msgs[0]!.role).toBe(ChatRole.Tool);
        expect(msgs[0]!.tool_call_id).toBe('call_1');
    });

    it('queues reasoning message', async () => {
        const q = new MessageQueue();
        await q.reasoning('Thinking...');
        const msgs = await q.clear();
        expect(msgs[0]!.role).toBe(ChatRole.Reasoning);
        expect(msgs[0]!.content).toBe('Thinking...');
    });

    it('clear returns empty array on empty queue', async () => {
        const q = new MessageQueue();
        const msgs = await q.clear();
        expect(msgs).toHaveLength(0);
    });

    it('clear atomically drains all messages', async () => {
        const q = new MessageQueue();
        await q.user('Hello');
        await q.user('World');
        const msgs = await q.clear();
        expect(msgs).toHaveLength(2);
        const again = await q.clear();
        expect(again).toHaveLength(0);
    });
});
