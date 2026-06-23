import { FinishReason } from '../chat/types.js';
import type { HasHooks } from '../hooks/hook-builder.js';
import type { StreamHookBuilder } from './stream.js';

/** Discriminant for stream chunk types emitted by a {@link ChunkStream}. */
export enum ChunkType {
    Content = 'content',
    Reasoning = 'reasoning',
    ToolCallDelta = 'tool_call_delta',
    Finish = 'finish'
}

type ChunkBase = {
    timestamp: Date;
    seq: number;
    batch: number;
};

type TextChunk = ChunkBase & {
    text: string;
};

/** A chunk carrying content text (the model's reply). */
export type ContentChunk = TextChunk & { type: ChunkType.Content };
/** A chunk carrying reasoning / thinking text. */
export type ReasoningChunk = TextChunk & { type: ChunkType.Reasoning };
/** A chunk carrying a tool call delta (partial function name/arguments). */
export type ToolCallDeltaChunk = TextChunk & {
    type: ChunkType.ToolCallDelta;
    toolCallIndex: number;
    toolCallId?: string;
    toolCallName?: string;
};
/** A chunk signalling the stream is finished with a given reason. */
export type FinishChunk = ChunkBase & {
    type: ChunkType.Finish;
    finishReason: FinishReason;
    isArtificial?: boolean;
};

/** Union of all possible chunk types emitted during streaming. */
export type Chunk = ContentChunk | ReasoningChunk | ToolCallDeltaChunk | FinishChunk;

/** Aggregated summary of a completed stream (content, reasoning, tool calls, finish reason). */
export type StreamSummary = {
    content: string;
    reasoning: string;
    toolCallCount: number;
    finishReason: FinishReason;
    timestamp: Date;
};

/** Interface for a chunk-based stream with hook support and summary aggregation. */
export interface ChunkStreamInterface extends HasHooks<StreamHookBuilder> {
    /** All chunks accumulated so far (shallow copy). */
    chunks(): readonly Chunk[];
    /** The final finish reason once the stream has ended, or `undefined`. */
    finishReason(): FinishReason | undefined;
    /** Access the hook builder to register chunk hooks. */
    hook(): StreamHookBuilder;
    /** All stream summaries aggregated so far (each provider call produces one). */
    summary(): readonly StreamSummary[];
    /** Remove all chunks and optionally hooks. */
    clear(retainHooks?: boolean): void;
    /** Remove accumulated summaries only. */
    clearSummaries(): void;
}
