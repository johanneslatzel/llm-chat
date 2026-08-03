import { describe, it, expect } from 'vitest';
import { MessageQueue } from '../../../src/chat/queue.js';
import { ChatMessageOrigin, ChatRole } from '../../../src/chat/types.js';

describe('MessageQueue', () => {
    it('queues and drains user message', async () => {
        const q = new MessageQueue();
        await q.user('Hello');
        const msgs = await q.drain();
        expect(msgs).toHaveLength(1);
        expect(msgs[0]!.role).toBe(ChatRole.User);
        expect(msgs[0]!.content).toBe('Hello');
    });

    it('queues assistant message without tool_calls', async () => {
        const q = new MessageQueue();
        await q.assistant('Sure thing');
        const msgs = await q.drain();
        expect(msgs[0]!.role).toBe(ChatRole.Assistant);
        expect(msgs[0]!.tool_calls).toBeUndefined();
    });

    it('queues assistant message with tool_calls', async () => {
        const q = new MessageQueue();
        await q.assistant('Let me check', [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }]);
        const msgs = await q.drain();
        expect(msgs[0]!.tool_calls).toHaveLength(1);
    });

    it('queues tool message', async () => {
        const q = new MessageQueue();
        await q.tool('Result data', 'call_1');
        const msgs = await q.drain();
        expect(msgs[0]!.role).toBe(ChatRole.Tool);
        expect(msgs[0]!.tool_call_id).toBe('call_1');
    });

    it('queues reasoning message', async () => {
        const q = new MessageQueue();
        await q.reasoning('Thinking...');
        const msgs = await q.drain();
        expect(msgs[0]!.role).toBe(ChatRole.Reasoning);
        expect(msgs[0]!.content).toBe('Thinking...');
    });

    it('drain returns empty array on empty queue', async () => {
        const q = new MessageQueue();
        const msgs = await q.drain();
        expect(msgs).toHaveLength(0);
    });

    it('drain atomically empties the queue', async () => {
        const q = new MessageQueue();
        await q.user('Hello');
        await q.user('World');
        const msgs = await q.drain();
        expect(msgs).toHaveLength(2);
        const again = await q.drain();
        expect(again).toHaveLength(0);
    });

    describe('messages', () => {
        it('returns a shallow copy without draining', async () => {
            const q = new MessageQueue();
            await q.user('Hello');
            await q.user('World');
            const peeked = await q.messages();
            expect(peeked).toHaveLength(2);
            expect(peeked[0]!.content).toBe('Hello');
            expect(peeked[1]!.content).toBe('World');

            const afterPeek = await q.drain();
            expect(afterPeek).toHaveLength(2);
        });

        it('returns empty array on empty queue', async () => {
            const q = new MessageQueue();
            const peeked = await q.messages();
            expect(peeked).toHaveLength(0);
        });

        it('returned array is a copy (immutability)', async () => {
            const q = new MessageQueue();
            await q.user('Hello');
            const peeked = await q.messages();
            peeked.push({ role: ChatRole.User, content: 'Injected', createdAt: new Date(), origin: ChatMessageOrigin.User });
            const after = await q.messages();
            expect(after).toHaveLength(1);
        });
    });
});
