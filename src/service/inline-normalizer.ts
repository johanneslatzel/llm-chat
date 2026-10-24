import {
    InlineMarkerFinish,
    InlineMarkerParser,
    InlineMarkerType,
    type MarkerDefinition,
    type MarkerSegment
} from './inline-markers.js';
import type { InlineReasoningMarkers } from './inline-reasoning.js';
import {
    INLINE_TOOL_CALL_INDEX_BASE,
    parseInlineToolCalls,
    type InlineToolCallMarkers
} from './inline-tool-calls.js';
import { StreamEventType, type StreamEvent } from './stream-events.js';

/** Options that control which inline markers the normalizer parses. */
export type InlineNormalizationOptions = {
    /** Whether to parse inline reasoning markers. */
    readonly parseInlineReasoning: boolean;
    /** Marker pair used when reasoning parsing is enabled. */
    readonly reasoningMarkers: InlineReasoningMarkers;
    /** Whether to parse inline tool-call markers. */
    readonly parseInlineToolCalls: boolean;
    /** Marker pair used when tool-call parsing is enabled. */
    readonly toolCallMarkers: InlineToolCallMarkers;
};

type InlineMarkerKind = InlineMarkerType.Reasoning | InlineMarkerType.ToolCall;
type InlineMarkerDefinition = MarkerDefinition<InlineMarkerKind>;
type InlineMarkerSegment = MarkerSegment<InlineMarkerKind>;

function buildDefinitions(options: InlineNormalizationOptions): InlineMarkerDefinition[] {
    const definitions: InlineMarkerDefinition[] = [];

    if (options.parseInlineReasoning) {
        definitions.push({
            type: InlineMarkerType.Reasoning,
            open: options.reasoningMarkers.open,
            close: options.reasoningMarkers.close,
            finish: InlineMarkerFinish.Marked
        });
    }

    if (options.parseInlineToolCalls) {
        definitions.push({
            type: InlineMarkerType.ToolCall,
            open: options.toolCallMarkers.open,
            close: options.toolCallMarkers.close,
            finish: InlineMarkerFinish.Text,
            emitEmpty: true,
            emitPartial: false
        });
    }

    return definitions;
}

/**
 * Converts inline marker content into service stream events.
 *
 * The normalizer owns one parser and the inline tool-call counter for a single
 * provider stream. It maps text, reasoning, and tool-call segments, and flushes
 * the parser before finish events, end of stream, and errors.
 */
export class InlineStreamNormalizer {
    private readonly _parser: InlineMarkerParser<InlineMarkerKind>;
    private readonly _toolCallMarkers: InlineToolCallMarkers;
    private _nextToolCallIndex = 0;

    constructor(
        definitions: readonly InlineMarkerDefinition[],
        toolCallMarkers: InlineToolCallMarkers
    ) {
        this._parser = new InlineMarkerParser(definitions);
        this._toolCallMarkers = toolCallMarkers;
    }

    /**
     * Wraps a provider stream and normalizes its content events.
     *
     * Non-content events pass through unchanged. Buffered segments are flushed
     * before a provider finish event, at end of stream, and before errors are
     * rethrown.
     */
    async *normalize(stream: AsyncIterable<StreamEvent>): AsyncIterable<StreamEvent> {
        try {
            for await (const event of stream) {
                if (event.type === StreamEventType.Content) {
                    yield* this._push(event.text);
                } else if (event.type === StreamEventType.Finish) {
                    yield* this._finish();
                    yield event;
                } else {
                    yield event;
                }
            }
            yield* this._finish();
        } catch (err) {
            yield* this._finish();
            throw err;
        }
    }

    private _push(text: string): StreamEvent[] {
        return this._mapSegments(this._parser.push(text));
    }

    private _finish(): StreamEvent[] {
        return this._mapSegments(this._parser.finish());
    }

    private _mapSegments(segments: readonly InlineMarkerSegment[]): StreamEvent[] {
        return segments.flatMap((segment) => this._mapSegment(segment));
    }

    private _mapSegment(segment: InlineMarkerSegment): StreamEvent[] {
        if (segment.type === InlineMarkerType.Text) {
            return [{ type: StreamEventType.Content, text: segment.text }];
        }
        if (segment.type === InlineMarkerType.Reasoning) {
            return [{ type: StreamEventType.Reasoning, text: segment.text }];
        }

        const calls = parseInlineToolCalls(segment.text);
        if (calls === null) {
            return [
                {
                    type: StreamEventType.Content,
                    text: this._toolCallMarkers.open + segment.text + this._toolCallMarkers.close
                }
            ];
        }
        return calls.map((call): StreamEvent => ({
            type: StreamEventType.ToolCallDelta,
            index: INLINE_TOOL_CALL_INDEX_BASE + this._nextToolCallIndex++,
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments
        }));
    }
}

/**
 * Creates a normalizer for the enabled marker kinds.
 *
 * @returns A normalizer, or `null` when both inline parsers are disabled.
 */
export function createInlineStreamNormalizer(
    options: InlineNormalizationOptions
): InlineStreamNormalizer | null {
    const definitions = buildDefinitions(options);
    if (definitions.length === 0) return null;
    return new InlineStreamNormalizer(definitions, options.toolCallMarkers);
}
