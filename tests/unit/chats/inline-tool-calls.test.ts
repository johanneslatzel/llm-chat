import { describe, it, expect } from 'vitest';
import {
    DEFAULT_INLINE_TOOL_CALL_MARKERS,
    INLINE_TOOL_CALL_INDEX_BASE,
    parseInlineToolCalls
} from '../../../src/service/inline-tool-calls.js';

function idFactory(index: number): string {
    return `call_${index}`;
}

describe('inline tool calls', () => {
    it('exposes the documented defaults', () => {
        expect(DEFAULT_INLINE_TOOL_CALL_MARKERS).toEqual({
            open: '<tool_call>',
            close: '</tool_call>'
        });
        expect(INLINE_TOOL_CALL_INDEX_BASE).toBe(1_000_000);
    });

    it('parses the name and arguments object shape', () => {
        expect(
            parseInlineToolCalls(
                '{"name":"test_tool","arguments":{"x":1}}',
                idFactory
            )
        ).toEqual([
            {
                id: 'call_0',
                type: 'function',
                function: { name: 'test_tool', arguments: '{"x":1}' }
            }
        ]);
    });

    it('accepts arguments as a JSON string', () => {
        expect(
            parseInlineToolCalls(
                '{"name":"test_tool","arguments":"{\\"x\\":1}"}',
                idFactory
            )
        ).toEqual([
            {
                id: 'call_0',
                type: 'function',
                function: { name: 'test_tool', arguments: '{"x":1}' }
            }
        ]);
    });

    it('parses the tool and parameters aliases', () => {
        expect(
            parseInlineToolCalls(
                '{"tool":"test_tool","parameters":{"x":1}}',
                idFactory
            )
        ).toEqual([
            {
                id: 'call_0',
                type: 'function',
                function: { name: 'test_tool', arguments: '{"x":1}' }
            }
        ]);
    });

    it('parses the function wrapper shape', () => {
        expect(
            parseInlineToolCalls(
                '{"function":{"name":"test_tool","arguments":{"x":1}}}',
                idFactory
            )
        ).toEqual([
            {
                id: 'call_0',
                type: 'function',
                function: { name: 'test_tool', arguments: '{"x":1}' }
            }
        ]);
    });

    it('prefers function arguments over top-level arguments', () => {
        expect(
            parseInlineToolCalls(
                '{"name":"top","function":{"name":"nested","arguments":{"a":1}},"arguments":{"b":2}}',
                idFactory
            )
        ).toEqual([
            {
                id: 'call_0',
                type: 'function',
                function: { name: 'nested', arguments: '{"a":1}' }
            }
        ]);
    });

    it('falls back to the top-level name when function has no name', () => {
        expect(
            parseInlineToolCalls(
                '{"function":{},"name":"fallback","parameters":{"x":1}}',
                idFactory
            )
        ).toEqual([
            {
                id: 'call_0',
                type: 'function',
                function: { name: 'fallback', arguments: '{"x":1}' }
            }
        ]);
    });

    it('trims the tool name', () => {
        expect(
            parseInlineToolCalls('{"name":"  test_tool  "}', idFactory)
        ).toEqual([
            {
                id: 'call_0',
                type: 'function',
                function: { name: 'test_tool', arguments: '{}' }
            }
        ]);
    });

    it('defaults missing, null and empty arguments to an empty object', () => {
        for (const payload of [
            '{"name":"test_tool"}',
            '{"name":"test_tool","arguments":null}',
            '{"name":"test_tool","arguments":""}'
        ]) {
            expect(parseInlineToolCalls(payload, idFactory)).toEqual([
                {
                    id: 'call_0',
                    type: 'function',
                    function: { name: 'test_tool', arguments: '{}' }
                }
            ]);
        }
    });

    it('parses an array of calls and assigns ids by index', () => {
        expect(
            parseInlineToolCalls(
                '[{"name":"first"},{"name":"second","arguments":{"x":2}}]',
                idFactory
            )
        ).toEqual([
            {
                id: 'call_0',
                type: 'function',
                function: { name: 'first', arguments: '{}' }
            },
            {
                id: 'call_1',
                type: 'function',
                function: { name: 'second', arguments: '{"x":2}' }
            }
        ]);
    });

    it('generates ids when no factory is provided', () => {
        const calls = parseInlineToolCalls('{"name":"test_tool"}');
        expect(calls).toHaveLength(1);
        expect(typeof calls![0]!.id).toBe('string');
        expect(calls![0]!.id.length).toBeGreaterThan(0);
    });

    it('returns null for malformed or unsupported payloads', () => {
        for (const payload of [
            '',
            '   ',
            '{',
            '42',
            '"text"',
            'null',
            '[]',
            '{"arguments":{}}',
            '{"name":"   "}',
            '{"name":42}',
            '{"tool":42}',
            '{"name":"test_tool","arguments":"not json"}',
            '{"name":"test_tool","arguments":"[]"}',
            '{"name":"test_tool","arguments":"42"}',
            '{"name":"test_tool","arguments":[]}',
            '{"name":"test_tool","arguments":42}',
            '[{"name":"ok"},{"arguments":{}}]'
        ]) {
            expect(parseInlineToolCalls(payload, idFactory)).toBeNull();
        }
    });
});
