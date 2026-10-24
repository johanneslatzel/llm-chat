import {
    InlineMarkerFinish,
    InlineMarkerParser,
    InlineMarkerType,
    type InlineMarkerPair,
    type MarkerSegment
} from './inline-markers.js';

/** Discriminant for ordinary content versus reasoning text segments. */
export enum TextSegmentType {
    Content = 'content',
    Reasoning = 'reasoning'
}

/** A contiguous piece of ordinary content or reasoning text. */
export type TextSegment =
    | { type: TextSegmentType.Content; text: string }
    | { type: TextSegmentType.Reasoning; text: string };

/** Opening and closing markers used to delimit inline reasoning text. */
export type InlineReasoningMarkers = InlineMarkerPair;

/** Default explicit marker pair used when no custom pair is configured. */
export const DEFAULT_INLINE_REASONING_MARKERS: InlineReasoningMarkers = {
    open: '<think>',
    close: '</think>'
};

/**
 * Incrementally splits streamed text into content and reasoning segments.
 *
 * The parser is provider-independent and deliberately not Markdown-aware: it
 * recognises only the configured explicit marker pair. Markers may be split
 * across arbitrary push boundaries. Text that is not part of a recognised
 * marker is preserved exactly.
 *
 * The underlying generic parser is fixed to `InlineMarkerType.Reasoning`.
 * This wrapper has only one marked kind, so every non-text segment is
 * reasoning by construction and no tool-call branch is needed.
 *
 * In content mode only the opening marker is special. In reasoning mode only
 * the closing marker is special. A nested opening marker is therefore treated
 * as literal reasoning text, and a stray closing marker in content mode is
 * treated as literal content. Closing an unclosed block with {@link finish}
 * emits the remaining text as reasoning.
 */
export class InlineReasoningParser {
    /**
     * The generic is fixed to the reasoning marker kind. This parser has no
     * other marked type, so every non-text segment is reasoning by
     * construction.
     */
    private readonly _parser: InlineMarkerParser<InlineMarkerType.Reasoning>;

    constructor(markers: InlineReasoningMarkers = DEFAULT_INLINE_REASONING_MARKERS) {
        if (markers.open.length === 0 || markers.close.length === 0) {
            throw new Error('Inline reasoning markers must be non-empty.');
        }
        if (markers.open === markers.close) {
            throw new Error('Inline reasoning markers must differ.');
        }
        this._parser = new InlineMarkerParser([
            {
                type: InlineMarkerType.Reasoning,
                open: markers.open,
                close: markers.close,
                finish: InlineMarkerFinish.Marked
            }
        ]);
    }

    /**
     * Feed a text fragment and return every segment that can be emitted safely.
     *
     * A suffix that could still become the active marker is held back until a
     * later push or {@link finish} reveals whether it is a marker.
     */
    push(text: string): TextSegment[] {
        return this._toTextSegments(this._parser.push(text));
    }

    /**
     * Flush all buffered text as the current mode and reset the parser.
     *
     * An unclosed reasoning block is emitted as reasoning. A partial marker
     * prefix is emitted as ordinary text. The parser is reset afterwards, so a
     * second call returns an empty array.
     */
    finish(): TextSegment[] {
        return this._toTextSegments(this._parser.finish());
    }

    /** Clear buffered text and return to content mode. */
    reset(): void {
        this._parser.reset();
    }

    /**
     * Maps parser segments to the wrapper's content/reasoning shape. The
     * parser is fixed to the reasoning marker kind, so the fallback branch is
     * always ordinary text.
     */
    private _toTextSegments(segments: MarkerSegment<InlineMarkerType.Reasoning>[]): TextSegment[] {
        return segments.map((segment) =>
            segment.type === InlineMarkerType.Reasoning
                ? { type: TextSegmentType.Reasoning, text: segment.text }
                : { type: TextSegmentType.Content, text: segment.text }
        );
    }
}
