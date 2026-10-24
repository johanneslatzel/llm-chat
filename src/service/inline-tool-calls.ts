import { randomUUID } from 'node:crypto';
import type { ToolCall } from '../chat/types.js';
import type { InlineMarkerPair } from './inline-markers.js';

/** Opening and closing markers used to delimit inline tool-call payloads. */
export type InlineToolCallMarkers = InlineMarkerPair;

/** Default explicit marker pair for inline tool calls. */
export const DEFAULT_INLINE_TOOL_CALL_MARKERS: InlineToolCallMarkers = {
    open: '<tool_call>',
    close: '</tool_call>'
};

/**
 * Index base for tool-call deltas synthesised from inline blocks.
 *
 * Structured provider deltas normally use small, zero-based indices. The base
 * keeps inline call accumulators separate without changing the tool-call
 * assembly code.
 */
export const INLINE_TOOL_CALL_INDEX_BASE = 1_000_000;

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeArguments(value: unknown): string | null {
    if (value === undefined || value === null) return '{}';

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) return '{}';
        try {
            const parsed: unknown = JSON.parse(trimmed);
            return isRecord(parsed) ? trimmed : null;
        } catch {
            return null;
        }
    }

    if (!isRecord(value)) return null;
    return JSON.stringify(value) as string;
}

function parseOne(value: unknown, id: string): ToolCall | null {
    if (!isRecord(value)) return null;

    const fn = isRecord(value['function']) ? value['function'] : undefined;
    const name = fn?.['name'] ?? value['name'] ?? value['tool'];
    if (typeof name !== 'string' || name.trim().length === 0) return null;

    const rawArguments = fn?.['arguments'] ?? value['arguments'] ?? value['parameters'];
    const args = normalizeArguments(rawArguments);
    if (args === null) return null;

    return {
        id,
        type: 'function',
        function: {
            name: name.trim(),
            arguments: args
        }
    };
}

/**
 * Parse a closed `<tool_call>` payload into structured tool calls.
 *
 * Supported shapes:
 * - `{ "name": string, "arguments"?: object | JSON string }`
 * - `{ "tool": string, "parameters"?: object | JSON string }`
 * - `{ "function": { "name": string, "arguments"?: object | JSON string } }`
 * - an array of any of the above
 *
 * Arguments must be an object or a JSON string representing an object. The
 * payload is all-or-nothing: if any call is malformed, `null` is returned and
 * the caller can preserve the original block as ordinary content.
 *
 * @param payload - Raw text between the configured markers.
 * @param idFactory - Generates an id for the call at the given index.
 */
export function parseInlineToolCalls(
    payload: string,
    idFactory: (index: number) => string = () => randomUUID()
): ToolCall[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        return null;
    }

    const values = Array.isArray(parsed) ? parsed : [parsed];
    if (values.length === 0) return null;

    const calls: ToolCall[] = [];
    for (let index = 0; index < values.length; index++) {
        const call = parseOne(values[index], idFactory(index));
        if (call === null) return null;
        calls.push(call);
    }
    return calls;
}
