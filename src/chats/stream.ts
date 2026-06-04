import { Hook } from '../hooks/hook.js';
import { HookBuilderBase, HasHooks } from '../hooks/hook-builder.js';
import { FinishReason } from './chat.js';

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

export type ContentChunk = TextChunk & { type: ChunkType.Content };
export type ReasoningChunk = TextChunk & { type: ChunkType.Reasoning };
export type ToolCallDeltaChunk = TextChunk & {
    type: ChunkType.ToolCallDelta;
    toolCallIndex: number;
    toolCallId?: string;
    toolCallName?: string;
};
export type FinishChunk = ChunkBase & {
    type: ChunkType.Finish;
    finishReason: FinishReason;
    isArtificial?: boolean;
};

export type Chunk = ContentChunk | ReasoningChunk | ToolCallDeltaChunk | FinishChunk;

export interface ChunkStreamInterface extends HasHooks<StreamHookBuilder> {
    chunks(): readonly Chunk[];
    finishReason(): FinishReason | undefined;
    hook(): StreamHookBuilder;
}

export class ChunkStream implements ChunkStreamInterface {
    private _chunks: Chunk[] = [];
    private _finishReason: FinishReason | undefined;
    private _seq = 0;
    private _batch = 0;
    private _chunkListeners = new Set<(chunk: Chunk) => void>();

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

    clear(): void {
        this._chunks = [];
        this._finishReason = undefined;
        this._seq = 0;
        this._batch++;
    }

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

export class StreamHookBuilder {
    constructor(private _stream: ChunkStream) {}

    chunks(...types: ChunkType[]): StreamChunkFilterBuilder {
        return new StreamChunkFilterBuilder(this._stream, types);
    }
}

export class StreamChunkFilterBuilder extends HookBuilderBase<(chunk: Chunk) => void> {
    constructor(
        private _stream: ChunkStream,
        private _types: ChunkType[]
    ) {
        super();
    }

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
