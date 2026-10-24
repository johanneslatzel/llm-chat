/** An opening and closing marker pair. */
export type InlineMarkerPair = {
    open: string;
    close: string;
};

/** Discriminant for the built-in marker segment kinds. */
export enum InlineMarkerType {
    Text = 'text',
    Reasoning = 'reasoning',
    ToolCall = 'toolCall'
}

/** Policy for flushing an unclosed marked block. */
export enum InlineMarkerFinish {
    Marked = 'marked',
    Text = 'text'
}

/**
 * Definition of one marked region in a stream.
 *
 * `TType` is the segment type emitted for the text between `open` and `close`.
 * It is a type parameter so each caller can state exactly which marked kinds
 * its parser produces. The parser keeps that union on every emitted
 * `MarkerSegment`, which lets callers narrow on `segment.type` instead of
 * casting. The type is a string because it becomes the runtime `type`
 * discriminant.
 */
export type MarkerDefinition<TType extends string> = {
    /** Segment type emitted for the content between the markers. */
    type: TType;
    open: string;
    close: string;
    /**
     * How an unclosed block is flushed by {@link InlineMarkerParser.finish}:
     * {@link InlineMarkerFinish.Marked} emits the buffered text as the marked
     * type; {@link InlineMarkerFinish.Text} emits the opening marker plus the
     * buffer as ordinary text.
     */
    finish: InlineMarkerFinish;
    /** Emit an empty marked segment for an empty closed block. */
    emitEmpty?: boolean;
    /**
     * Emit marked text incrementally before the closing marker is found.
     * Defaults to `true`. Set to `false` when the payload must be complete
     * before it can be interpreted, as with tool calls.
     */
    emitPartial?: boolean;
};

/**
 * A segment emitted by {@link InlineMarkerParser}.
 *
 * The text arm is always {@link InlineMarkerType.Text}. The marked arm uses the
 * parser's `TType`, so the union describes only the marked kinds that parser
 * was configured to recognise.
 */
export type MarkerSegment<TType extends string> =
    { type: InlineMarkerType.Text; text: string } | { type: TType; text: string };

/**
 * A definition match found in the buffered text.
 *
 * `TType` preserves the owning parser's marker union so the matched definition
 * can be stored as the active definition without widening its type.
 */
type OpenMatch<TType extends string> = {
    definition: MarkerDefinition<TType>;
    index: number;
};

/**
 * Incrementally splits text into ordinary text and one or more marked regions.
 *
 * The parser recognises only explicit marker pairs. Marker text may be split
 * across arbitrary push boundaries. Suffixes that could still become the
 * active marker are held back; all other text is emitted immediately.
 *
 * In text mode the earliest opening marker (longest wins on a tie) selects the
 * active definition. While a definition is active, only its closing marker is
 * special; other markers are ordinary payload text.
 *
 * `TType` is the union of marked segment kinds this parser accepts. It is fixed
 * when the parser is constructed and carried through every `push` and `finish`
 * result. That keeps the result a discriminated union, so callers can handle
 * text, reasoning, and tool-call segments without casts. The parser itself does
 * not depend on the concrete marker enums.
 */
export class InlineMarkerParser<TType extends string> {
    private _buffer = '';
    private _active: MarkerDefinition<TType> | null = null;
    private readonly _definitions: readonly MarkerDefinition<TType>[];

    /**
     * @param definitions Marker definitions. Their `type` values form the
     * parser's `TType` union.
     */
    constructor(definitions: readonly MarkerDefinition<TType>[]) {
        if (definitions.length === 0) {
            throw new Error('At least one inline marker definition is required.');
        }
        const openMarkers = new Set<string>();
        for (const definition of definitions) {
            if (definition.open.length === 0 || definition.close.length === 0) {
                throw new Error('Inline marker open/close must be non-empty.');
            }
            if (definition.open === definition.close) {
                throw new Error('Inline marker open/close must differ.');
            }
            if (openMarkers.has(definition.open)) {
                throw new Error(`Duplicate inline marker open: ${definition.open}`);
            }
            openMarkers.add(definition.open);
        }
        this._definitions = definitions;
    }

    /** Feed a text fragment and return every segment that can be emitted safely. */
    push(text: string): MarkerSegment<TType>[] {
        if (text.length === 0) return [];
        this._buffer += text;
        const segments: MarkerSegment<TType>[] = [];

        for (;;) {
            if (this._active === null) {
                const match = this._findOpen(this._buffer);
                if (match !== null) {
                    this._emitText(segments, this._buffer.slice(0, match.index));
                    this._buffer = this._buffer.slice(match.index + match.definition.open.length);
                    this._active = match.definition;
                    continue;
                }

                const keep = this._partialSuffixLength(
                    this._buffer,
                    this._definitions.map((definition) => definition.open)
                );
                if (keep < this._buffer.length) {
                    this._emitText(segments, this._buffer.slice(0, this._buffer.length - keep));
                    this._buffer = this._buffer.slice(this._buffer.length - keep);
                }
                return segments;
            }

            const marker = this._active.close;
            const at = this._buffer.indexOf(marker);
            if (at !== -1) {
                this._emitMarked(segments, this._active, this._buffer.slice(0, at));
                this._buffer = this._buffer.slice(at + marker.length);
                this._active = null;
                continue;
            }

            if (this._active.emitPartial === false) {
                return segments;
            }

            const keep = this._partialSuffixLength(this._buffer, [marker]);
            if (keep < this._buffer.length) {
                this._emitMarked(
                    segments,
                    this._active,
                    this._buffer.slice(0, this._buffer.length - keep)
                );
                this._buffer = this._buffer.slice(this._buffer.length - keep);
            }
            return segments;
        }
    }

    /**
     * Flush all buffered text and reset the parser.
     *
     * A partial opening marker is emitted as ordinary text. An unclosed marked
     * block follows its definition's `finish` policy.
     */
    finish(): MarkerSegment<TType>[] {
        const segments: MarkerSegment<TType>[] = [];
        if (this._active === null) {
            this._emitText(segments, this._buffer);
        } else if (this._active.finish === InlineMarkerFinish.Marked) {
            this._emitMarked(segments, this._active, this._buffer);
        } else {
            this._emitText(segments, this._active.open + this._buffer);
        }
        this.reset();
        return segments;
    }

    /** Clear buffered text and return to text mode. */
    reset(): void {
        this._buffer = '';
        this._active = null;
    }

    private _findOpen(text: string): OpenMatch<TType> | null {
        let best: OpenMatch<TType> | null = null;
        for (const definition of this._definitions) {
            const index = text.indexOf(definition.open);
            if (index === -1) continue;
            if (
                best === null ||
                index < best.index ||
                (index === best.index && definition.open.length > best.definition.open.length)
            ) {
                best = { definition, index };
            }
        }
        return best;
    }

    private _partialSuffixLength(text: string, markers: readonly string[]): number {
        let best = 0;
        for (const marker of markers) {
            const max = Math.min(text.length, marker.length - 1);
            for (let length = max; length > best; length--) {
                if (text.endsWith(marker.slice(0, length))) {
                    best = length;
                    break;
                }
            }
        }
        return best;
    }

    private _emitText(segments: MarkerSegment<TType>[], text: string): void {
        if (text.length === 0) return;
        segments.push({ type: InlineMarkerType.Text, text });
    }

    private _emitMarked(
        segments: MarkerSegment<TType>[],
        definition: MarkerDefinition<TType>,
        text: string
    ): void {
        if (text.length === 0 && !definition.emitEmpty) return;
        segments.push({ type: definition.type, text });
    }
}
