import { describe, it, expect, vi } from 'vitest';
import { ChunkStream, ChunkType, ContentChunk, ReasoningChunk, ToolCallDeltaChunk, FinishChunk, type StreamSummary } from '../../../src/chats/stream.js';
import { FinishReason } from '../../../src/chats/chat.js';

describe('ChunkStream', () => {
    describe('chunk creation', () => {
        it('adds content chunks with sequential seq', () => {
            const stream = new ChunkStream();
            stream.addContentChunk('Hello');
            stream.addContentChunk(' World');
            const chunks = stream.chunks();
            expect(chunks).toHaveLength(2);
            expect(chunks[0]!.type).toBe(ChunkType.Content);
            expect((chunks[0]! as ContentChunk).text).toBe('Hello');
            expect(chunks[0]!.seq).toBe(0);
            expect(chunks[1]!.seq).toBe(1);
        });

        it('adds reasoning chunks', () => {
            const stream = new ChunkStream();
            stream.addReasoningChunk('Thinking...');
            const chunks = stream.chunks();
            expect(chunks).toHaveLength(1);
            expect(chunks[0]!.type).toBe(ChunkType.Reasoning);
            expect((chunks[0]! as ReasoningChunk).text).toBe('Thinking...');
        });

        it('adds tool call delta chunks', () => {
            const stream = new ChunkStream();
            stream.addToolCallDeltaChunk('{"key": "val"}', 0, 'call_1', 'test_tool');
            const chunks = stream.chunks();
            expect(chunks).toHaveLength(1);
            expect(chunks[0]!.type).toBe(ChunkType.ToolCallDelta);
            expect((chunks[0]! as ToolCallDeltaChunk).text).toBe('{"key": "val"}');
            expect((chunks[0]! as ToolCallDeltaChunk).toolCallIndex).toBe(0);
            expect((chunks[0]! as ToolCallDeltaChunk).toolCallId).toBe('call_1');
            expect((chunks[0]! as ToolCallDeltaChunk).toolCallName).toBe('test_tool');
        });

        it('adds tool call delta without optional id/name', () => {
            const stream = new ChunkStream();
            stream.addToolCallDeltaChunk('partial', 0);
            const chunks = stream.chunks();
            expect(chunks[0]!.type).toBe(ChunkType.ToolCallDelta);
            expect((chunks[0]! as any).toolCallId).toBeUndefined();
            expect((chunks[0]! as any).toolCallName).toBeUndefined();
        });

        it('adds finish chunk', () => {
            const stream = new ChunkStream();
            stream.addFinishChunk(FinishReason.Stop);
            const chunks = stream.chunks();
            expect(chunks).toHaveLength(1);
            expect(chunks[0]!.type).toBe(ChunkType.Finish);
            expect((chunks[0]! as FinishChunk).finishReason).toBe(FinishReason.Stop);
        });

        it('adds artificial finish chunk', () => {
            const stream = new ChunkStream();
            stream.addFinishChunk(FinishReason.Stop, true);
            const chunks = stream.chunks();
            expect(chunks[0]!.type).toBe(ChunkType.Finish);
            expect((chunks[0]! as FinishChunk).isArtificial).toBe(true);
        });

        it('seq increments sequentially across mixed chunk types', () => {
            const stream = new ChunkStream();
            stream.addContentChunk('Hello');
            stream.addReasoningChunk('Think');
            stream.addToolCallDeltaChunk('data', 0);
            stream.addFinishChunk(FinishReason.Stop);
            const chunks = stream.chunks();
            expect(chunks[0]!.seq).toBe(0);
            expect(chunks[1]!.seq).toBe(1);
            expect(chunks[2]!.seq).toBe(2);
            expect(chunks[3]!.seq).toBe(3);
        });

        it('sets batch on each chunk', () => {
            const stream = new ChunkStream();
            stream.addContentChunk('Hello');
            expect(stream.chunks()[0]!.batch).toBe(0);
        });
    });

    describe('multiple finish chunks', () => {
        it('allows multiple finish chunks (tool-call rounds)', () => {
            const stream = new ChunkStream();
            stream.addFinishChunk(FinishReason.ToolCalls);
            stream.addFinishChunk(FinishReason.Stop);
            const chunks = stream.chunks();
            const finishChunks = chunks.filter((c): c is FinishChunk => c.type === ChunkType.Finish);
            expect(finishChunks).toHaveLength(2);
            expect(finishChunks[0]!.finishReason).toBe(FinishReason.ToolCalls);
            expect(finishChunks[1]!.finishReason).toBe(FinishReason.Stop);
        });
    });

    describe('finishReason', () => {
        it('returns undefined before any finish chunk', () => {
            const stream = new ChunkStream();
            expect(stream.finishReason()).toBeUndefined();
        });

        it('returns the last finish reason', () => {
            const stream = new ChunkStream();
            stream.addFinishChunk(FinishReason.ToolCalls);
            expect(stream.finishReason()).toBe(FinishReason.ToolCalls);
            stream.addFinishChunk(FinishReason.Stop);
            expect(stream.finishReason()).toBe(FinishReason.Stop);
        });
    });

    describe('clear', () => {
        it('clears all chunks and resets finishReason', () => {
            const stream = new ChunkStream();
            stream.addContentChunk('Hello');
            stream.addFinishChunk(FinishReason.Stop);
            stream.clear();
            expect(stream.chunks()).toHaveLength(0);
            expect(stream.finishReason()).toBeUndefined();
        });

        it('resets seq and increments batch after clear', () => {
            const stream = new ChunkStream();
            stream.addContentChunk('First');
            expect(stream.chunks()[0]!.seq).toBe(0);
            expect(stream.chunks()[0]!.batch).toBe(0);
            stream.clear();
            stream.addContentChunk('Second');
            expect(stream.chunks()[0]!.seq).toBe(0);
            expect(stream.chunks()[0]!.batch).toBe(1);
        });

        it('clears registered hooks so they no longer fire on new chunks', () => {
            const stream = new ChunkStream();
            const handler = vi.fn();
            stream.hook().chunks().do(handler);

            stream.addContentChunk('before');
            expect(handler).toHaveBeenCalledTimes(1);

            stream.clear();

            stream.addContentChunk('after');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('retainHooks keeps hooks active after clear', () => {
            const stream = new ChunkStream();
            const handler = vi.fn();
            stream.hook().chunks().do(handler);

            stream.addContentChunk('before');
            expect(handler).toHaveBeenCalledTimes(1);

            stream.clear(true);

            stream.addContentChunk('after');
            expect(handler).toHaveBeenCalledTimes(2);
        });
    });

    describe('hook', () => {
        it('fires content chunk hooks', () => {
            const stream = new ChunkStream();
            const handler = vi.fn();
            stream.hook().chunks(ChunkType.Content).do(handler);
            stream.addContentChunk('Hello');
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ type: ChunkType.Content, text: 'Hello' })
            );
        });

        it('fires reasoning chunk hooks', () => {
            const stream = new ChunkStream();
            const handler = vi.fn();
            stream.hook().chunks(ChunkType.Reasoning).do(handler);
            stream.addReasoningChunk('Thinking...');
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ type: ChunkType.Reasoning, text: 'Thinking...' })
            );
        });

        it('fires tool call delta hooks', () => {
            const stream = new ChunkStream();
            const handler = vi.fn();
            stream.hook().chunks(ChunkType.ToolCallDelta).do(handler);
            stream.addToolCallDeltaChunk('{"key": "v"}', 0, 'call_1', 't');
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ type: ChunkType.ToolCallDelta, text: '{"key": "v"}' })
            );
        });

        it('fires finish chunk hooks', () => {
            const stream = new ChunkStream();
            const handler = vi.fn();
            stream.hook().chunks(ChunkType.Finish).do(handler);
            stream.addFinishChunk(FinishReason.Stop);
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ type: ChunkType.Finish, finishReason: FinishReason.Stop })
            );
        });

        it('filters by chunk type', () => {
            const stream = new ChunkStream();
            const contentHandler = vi.fn();
            const reasoningHandler = vi.fn();
            stream.hook().chunks(ChunkType.Content).do(contentHandler);
            stream.hook().chunks(ChunkType.Reasoning).do(reasoningHandler);
            stream.addContentChunk('Hello');
            stream.addReasoningChunk('Think');
            expect(contentHandler).toHaveBeenCalledTimes(1);
            expect(reasoningHandler).toHaveBeenCalledTimes(1);
            expect(contentHandler).toHaveBeenCalledWith(
                expect.objectContaining({ type: ChunkType.Content })
            );
            expect(reasoningHandler).toHaveBeenCalledWith(
                expect.objectContaining({ type: ChunkType.Reasoning })
            );
        });

        it('fires for all types when no type filter given', () => {
            const stream = new ChunkStream();
            const handler = vi.fn();
            stream.hook().chunks().do(handler);
            stream.addContentChunk('Hello');
            stream.addReasoningChunk('Think');
            expect(handler).toHaveBeenCalledTimes(2);
        });

        it('two concurrent hook listeners both fire', () => {
            const stream = new ChunkStream();
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            stream.hook().chunks(ChunkType.Content).do(handler1);
            stream.hook().chunks(ChunkType.Content).do(handler2);
            stream.addContentChunk('Hello');
            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);
        });

        it('supports disposal', () => {
            const stream = new ChunkStream();
            const handler = vi.fn();
            const hook = stream.hook().chunks(ChunkType.Content).do(handler);
            hook.dispose();
            stream.addContentChunk('Hello');
            expect(handler).not.toHaveBeenCalled();
        });

        it('isDisposed guard in _onChunk prevents callback after dispose', () => {
            const stream = new ChunkStream();
            const handler = vi.fn();
            const hook = stream.hook().chunks(ChunkType.Content).do(handler);
            const internalOnChunk = (hook as any)._onChunk;
            hook.dispose();
            internalOnChunk({ type: ChunkType.Content, text: 'Hello', seq: 0, batch: 0 });
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('chunks() readonly view', () => {
        it('returns a copy of the chunk array', () => {
            const stream = new ChunkStream();
            stream.addContentChunk('Hello');
            const view = stream.chunks();
            const view2 = stream.chunks();
            expect(view).not.toBe(view2);
            expect(view).toEqual(view2);
        });

        it('mutating the returned array does not affect internal state', () => {
            const stream = new ChunkStream();
            stream.addContentChunk('Hello');
            const view = stream.chunks();
            (view as any[]).push({} as any);
            expect(stream.chunks()).toHaveLength(1);
        });
    });

    describe('summary', () => {
        function makeSummary(): StreamSummary {
            return {
                content: 'hello',
                reasoning: '',
                toolCallCount: 0,
                finishReason: FinishReason.Stop,
                timestamp: new Date('2025-01-01')
            };
        }

        it('returns added summaries', () => {
            const stream = new ChunkStream();
            stream.addSummary(makeSummary());
            const s2 = makeSummary();
            s2.content = 'world';
            stream.addSummary(s2);
            const summaries = stream.summary();
            expect(summaries).toHaveLength(2);
            expect(summaries[0]!.content).toBe('hello');
            expect(summaries[1]!.content).toBe('world');
        });

        it('clears summaries', () => {
            const stream = new ChunkStream();
            stream.addSummary(makeSummary());
            stream.clearSummaries();
            expect(stream.summary()).toHaveLength(0);
        });

        it('returns a copy of the summaries array', () => {
            const stream = new ChunkStream();
            stream.addSummary(makeSummary());
            const view = stream.summary();
            expect(view).not.toBe(stream.summary());
        });
    });
});
