import { Hook } from '../hooks/hook.js';
import { HookBuilderBase } from '../hooks/hook-builder.js';
import { FinishReason } from '../chat/types.js';
import {
    ChunkType,
    ContentChunk,
    ReasoningChunk,
    ToolCallDeltaChunk,
    FinishChunk,
    Chunk,
    ChunkStreamInterface,
    StreamSummary
} from './stream-types.js';

/** Accumulates streaming chunks, tracks finish reasons, and emits hook events. */
export class ChunkStream implements ChunkStreamInterface {
    private _chunks: Chunk[] = [];
    private _finishReason: FinishReason | undefined;
    private _seq = 0;
    private _batch = 0;
    private _chunkListeners = new Set<(chunk: Chunk) => void>();
    private _summaries: StreamSummary[] = [];

    /** Append a content chunk. */
    addContentChunk(text: string): void {
        const chunk: ContentChunk = {
            type: ChunkType.Content,
            text,
            timestamp: new Date(),
            seq: this._seq++,
            batch: this._batch
        };
        this._chunks.push(chunk);
        this._notify(chunk);
    }

    /** Append a reasoning / thinking chunk. */
    addReasoningChunk(text: string): void {
        const chunk: ReasoningChunk = {
            type: ChunkType.Reasoning,
            text,
            timestamp: new Date(),
            seq: this._seq++,
            batch: this._batch
        };
        this._chunks.push(chunk);
        this._notify(chunk);
    }

    /** Append a tool call delta chunk. */
    addToolCallDeltaChunk(
        text: string,
        toolCallIndex: number,
        toolCallId?: string,
        toolCallName?: string
    ): void {
        const chunk: ToolCallDeltaChunk = {
            type: ChunkType.ToolCallDelta,
            text,
            timestamp: new Date(),
            seq: this._seq++,
            batch: this._batch,
            toolCallIndex,
            ...(toolCallId !== undefined ? { toolCallId } : {}),
            ...(toolCallName !== undefined ? { toolCallName } : {})
        };
        this._chunks.push(chunk);
        this._notify(chunk);
    }

    /** Append a finish chunk with the given reason. */
    addFinishChunk(reason: FinishReason, isArtificial?: boolean): void {
        const chunk: FinishChunk = {
            type: ChunkType.Finish,
            finishReason: reason,
            timestamp: new Date(),
            seq: this._seq++,
            batch: this._batch,
            ...(isArtificial !== undefined ? { isArtificial } : {})
        };
        this._chunks.push(chunk);
        this._finishReason = reason;
        this._notify(chunk);
    }

    chunks(): readonly Chunk[] {
        return [...this._chunks];
    }

    finishReason(): FinishReason | undefined {
        return this._finishReason;
    }

    clear(retainHooks?: boolean): void {
        this._chunks = [];
        this._finishReason = undefined;
        this._seq = 0;
        this._batch++;
        if (!retainHooks) this._chunkListeners.clear();
    }

    hook(): StreamHookBuilder {
        return new StreamHookBuilder(this);
    }

    /** Subscribe to new chunks (used internally by hooks). */
    onChunk(handler: (chunk: Chunk) => void): void {
        this._chunkListeners.add(handler);
    }

    /** Unsubscribe a chunk handler. */
    offChunk(handler: (chunk: Chunk) => void): void {
        this._chunkListeners.delete(handler);
    }

    /** Record a completed stream summary. */
    addSummary(summary: StreamSummary): void {
        this._summaries.push(summary);
    }

    summary(): readonly StreamSummary[] {
        return [...this._summaries];
    }

    clearSummaries(): void {
        this._summaries = [];
    }

    private _notify(chunk: Chunk): void {
        this._chunkListeners.forEach((fn) => fn(chunk));
    }
}

/** Entry point for building stream chunk hooks. Created by {@link ChunkStreamInterface.hook}. */
export class StreamHookBuilder {
    constructor(private _stream: ChunkStream) {}

    /** Build a chunk hook, optionally filtered by chunk types. */
    chunks(...types: ChunkType[]): StreamChunkFilterBuilder {
        return new StreamChunkFilterBuilder(this._stream, types);
    }
}

/** Builder that configures and registers a stream chunk hook with optional chunk-type filtering. */
export class StreamChunkFilterBuilder extends HookBuilderBase<(chunk: Chunk) => void> {
    constructor(
        private _stream: ChunkStream,
        private _types: ChunkType[]
    ) {
        super();
    }

    /** Register the hook. The callback receives each matching chunk. */
    do(callback: (chunk: Chunk) => void): Hook {
        return new StreamChunkHook(this._stream, this._types, callback);
    }
}

class StreamChunkHook extends Hook {
    private _stream: ChunkStream;
    private _types: ChunkType[];
    private _callback: (chunk: Chunk) => void;

    constructor(stream: ChunkStream, types: ChunkType[], callback: (chunk: Chunk) => void) {
        super();
        this._stream = stream;
        this._types = types;
        this._callback = callback;
        stream.onChunk(this._onChunk);
    }

    private _onChunk = (chunk: Chunk): void => {
        if (this.isDisposed()) return;
        if (this._types.length > 0 && !this._types.includes(chunk.type)) return;
        this.safeInvoke(() => this._callback(chunk));
    };

    protected onDispose(): void {
        this._stream.offChunk(this._onChunk);
    }
}
