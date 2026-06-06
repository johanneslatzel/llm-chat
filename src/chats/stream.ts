import { Hook } from '../hooks/hook.js';
import { HookBuilderBase, HasHooks } from '../hooks/hook-builder.js';
import { FinishReason } from './chat.js';

/** Discriminant for the four chunk types yielded by a stream. */
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

/** A text content delta from the model. */
export type ContentChunk = TextChunk & { type: ChunkType.Content };
/** A reasoning content delta from the model. */
export type ReasoningChunk = TextChunk & { type: ChunkType.Reasoning };
/** A partial tool call delta (arguments are streamed incrementally). */
export type ToolCallDeltaChunk = TextChunk & {
    type: ChunkType.ToolCallDelta;
    toolCallIndex: number;
    toolCallId?: string;
    toolCallName?: string;
};
/** Signals the end of a stream, carrying the final {@link FinishReason}. */
export type FinishChunk = ChunkBase & {
    type: ChunkType.Finish;
    finishReason: FinishReason;
    isArtificial?: boolean;
};

/** Union of all possible chunk types in a stream. */
export type Chunk = ContentChunk | ReasoningChunk | ToolCallDeltaChunk | FinishChunk;

/** Readable stream of chunks produced by a service call. Access the full list via {@link chunks}. */
export interface ChunkStreamInterface extends HasHooks<StreamHookBuilder> {
    /** Snapshot of all chunks emitted so far (defensive copy). */
    chunks(): readonly Chunk[];
    /** The final finish reason, or `undefined` if the stream hasn't finished yet. */
    finishReason(): FinishReason | undefined;
    /** Access the hook builder for stream chunk events. */
    hook(): StreamHookBuilder;
}

/** Collects and exposes stream chunks. Notifies chunk listeners on each addition. */
export class ChunkStream implements ChunkStreamInterface {
    private _chunks: Chunk[] = [];
    private _finishReason: FinishReason | undefined;
    private _seq = 0;
    private _batch = 0;
    private _chunkListeners = new Set<(chunk: Chunk) => void>();

    /** Record a text content delta. */
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

    /** Record a reasoning content delta. */
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

    /** Record a partial tool call delta (arguments may be streamed across multiple chunks). */
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

    /** Record a finish signal with its reason. Sets `isArtificial` when the stream ended without an explicit finish event. */
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

    /** @inheritDoc */
    chunks(): readonly Chunk[] {
        return [...this._chunks];
    }

    /** @inheritDoc */
    finishReason(): FinishReason | undefined {
        return this._finishReason;
    }

    /** Clear all chunks, reset the sequence, and increment the batch counter. */
    clear(): void {
        this._chunks = [];
        this._finishReason = undefined;
        this._seq = 0;
        this._batch++;
    }

    /** @inheritDoc */
    hook(): StreamHookBuilder {
        return new StreamHookBuilder(this);
    }

    onChunk(handler: (chunk: Chunk) => void): void {
        this._chunkListeners.add(handler);
    }

    offChunk(handler: (chunk: Chunk) => void): void {
        this._chunkListeners.delete(handler);
    }

    private _notify(chunk: Chunk): void {
        this._chunkListeners.forEach((fn) => fn(chunk));
    }
}

// --- Hook builders ---

/** Builder for stream chunk hooks. Start with {@link chunks} to filter by type. */
export class StreamHookBuilder {
    constructor(private _stream: ChunkStream) {}

    /** Filter chunks by type(s). Returns a builder to register the callback. */
    chunks(...types: ChunkType[]): StreamChunkFilterBuilder {
        return new StreamChunkFilterBuilder(this._stream, types);
    }
}

/** Builder that registers a chunk hook, optionally filtered by chunk type. */
export class StreamChunkFilterBuilder extends HookBuilderBase<(chunk: Chunk) => void> {
    constructor(
        private _stream: ChunkStream,
        private _types: ChunkType[]
    ) {
        super();
    }

    /** Register the callback. Fires for each chunk matching the selected types. */
    do(callback: (chunk: Chunk) => void): Hook {
        return new StreamChunkHook(this._stream, this._types, callback);
    }
}

// --- Hook implementations ---

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
