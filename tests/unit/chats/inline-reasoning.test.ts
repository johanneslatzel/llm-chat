import { describe, it, expect } from 'vitest';
import {
    DEFAULT_INLINE_REASONING_MARKERS,
    InlineReasoningParser,
    TextSegmentType,
    type InlineReasoningMarkers,
    type TextSegment
} from '../../../src/service/inline-reasoning.js';

const DEFAULT_MARKERS: InlineReasoningMarkers = {
    open: '<think>',
    close: '</think>'
};

function parse(chunks: string[], markers: InlineReasoningMarkers = DEFAULT_MARKERS): TextSegment[] {
    const parser = new InlineReasoningParser(markers);
    return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.finish()];
}

function textOf(segments: TextSegment[], type: TextSegmentType): string {
    return segments
        .filter((segment) => segment.type === type)
        .map((segment) => segment.text)
        .join('');
}

function expectContentAndReasoning(chunks: string[], content: string, reasoning: string): void {
    const segments = parse(chunks);
    expect(textOf(segments, TextSegmentType.Content)).toBe(content);
    expect(textOf(segments, TextSegmentType.Reasoning)).toBe(reasoning);
}

describe('InlineReasoningParser', () => {
    it('uses the documented default markers', () => {
        expect(DEFAULT_INLINE_REASONING_MARKERS).toEqual({
            open: '<think>',
            close: '</think>'
        });

        const parser = new InlineReasoningParser();
        expect(parser.push('<think>abc</think>')).toEqual([
            { type: 'reasoning', text: 'abc' }
        ]);
    });

    it('parses a complete reasoning block in one fragment', () => {
        expect(parse(['<think>abc</think>'])).toEqual([{ type: 'reasoning', text: 'abc' }]);
    });

    it('preserves content before, between and after reasoning blocks', () => {
        expect(parse(['a<think>b</think>c'])).toEqual([
            { type: 'content', text: 'a' },
            { type: 'reasoning', text: 'b' },
            { type: 'content', text: 'c' }
        ]);
    });

    it('parses multiple reasoning blocks in order', () => {
        expect(parse(['<think>a</think> <think>b</think>'])).toEqual([
            { type: 'reasoning', text: 'a' },
            { type: 'content', text: ' ' },
            { type: 'reasoning', text: 'b' }
        ]);
    });

    it('parses consecutive reasoning blocks without content between them', () => {
        expect(parse(['<think>a</think><think>b</think>'])).toEqual([
            { type: 'reasoning', text: 'a' },
            { type: 'reasoning', text: 'b' }
        ]);
    });

    it('recognizes markers split at every character boundary', () => {
        const input = '<think>abc</think>';
        for (let index = 0; index <= input.length; index++) {
            const segments = parse([input.slice(0, index), input.slice(index)]);
            expect(textOf(segments, TextSegmentType.Content)).toBe('');
            expect(textOf(segments, TextSegmentType.Reasoning)).toBe('abc');
        }
    });

    it('handles one-character chunks', () => {
        expect(parse([...'a<think>b</think>c'])).toEqual([
            { type: 'content', text: 'a' },
            { type: 'reasoning', text: 'b' },
            { type: 'content', text: 'c' }
        ]);
    });

    it('preserves content and reasoning across every two-cut partition', () => {
        const input = 'a<think>b</think>c';
        for (let first = 0; first <= input.length; first++) {
            for (let second = first; second <= input.length; second++) {
                expectContentAndReasoning(
                    [input.slice(0, first), input.slice(first, second), input.slice(second)],
                    'ac',
                    'b'
                );
            }
        }
    });

    it('does not duplicate or lose text across arbitrary chunk boundaries', () => {
        const input = 'before <think>one</think> middle <think>two</think> after';
        expectContentAndReasoning([input], 'before  middle  after', 'onetwo');

        for (const size of [1, 2, 3, 5, 8]) {
            const chunks: string[] = [];
            for (let index = 0; index < input.length; index += size) {
                chunks.push(input.slice(index, index + size));
            }
            expectContentAndReasoning(chunks, 'before  middle  after', 'onetwo');
        }
    });

    it('produces no segment for an empty reasoning block', () => {
        expect(parse(['<think></think>'])).toEqual([]);
        expect(parse(['a<think></think>b'])).toEqual([
            { type: 'content', text: 'a' },
            { type: 'content', text: 'b' }
        ]);
    });

    it('handles empty input and consecutive empty fragments', () => {
        const parser = new InlineReasoningParser();
        expect(parser.push('')).toEqual([]);
        expect(parser.push('')).toEqual([]);
        expect(parser.finish()).toEqual([]);
    });

    it('treats a partial opening marker at EOF as content', () => {
        expect(parse(['a<thi'])).toEqual([
            { type: 'content', text: 'a' },
            { type: 'content', text: '<thi' }
        ]);
        expect(parse(['<thi'])).toEqual([{ type: 'content', text: '<thi' }]);
    });

    it('flushes an unclosed reasoning block at EOF as reasoning', () => {
        expect(parse(['<think>abc'])).toEqual([{ type: 'reasoning', text: 'abc' }]);
    });

    it('keeps a partial closing marker inside an unclosed block as reasoning', () => {
        expect(parse(['<think>abc</thi'])).toEqual([
            { type: 'reasoning', text: 'abc' },
            { type: 'reasoning', text: '</thi' }
        ]);
    });

    it('treats a stray closing marker in content mode as literal content', () => {
        expect(parse(['a</think>b'])).toEqual([{ type: 'content', text: 'a</think>b' }]);
    });

    it('treats a nested opening marker as literal reasoning text', () => {
        expect(parse(['<think>a<think>b</think>c'])).toEqual([
            { type: 'reasoning', text: 'a<think>b' },
            { type: 'content', text: 'c' }
        ]);
    });

    it('handles unicode and multiline text', () => {
        expect(parse(['héllo\n<think>réfléchi\n</think>世界'])).toEqual([
            { type: 'content', text: 'héllo\n' },
            { type: 'reasoning', text: 'réfléchi\n' },
            { type: 'content', text: '世界' }
        ]);
    });

    it('preserves ordinary text exactly', () => {
        const ordinary = 'a < b & c > d\n\t😀 < /think >';
        expect(parse([ordinary])).toEqual([{ type: 'content', text: ordinary }]);
    });

    it('supports single-character marker pairs', () => {
        const markers: InlineReasoningMarkers = { open: '[', close: ']' };
        expect(parse(['a[b]c'], markers)).toEqual([
            { type: 'content', text: 'a' },
            { type: 'reasoning', text: 'b' },
            { type: 'content', text: 'c' }
        ]);
        expect(parse(['abc'], markers)).toEqual([{ type: 'content', text: 'abc' }]);
    });

    it('resets buffered text and the reasoning mode', () => {
        const parser = new InlineReasoningParser();
        parser.push('<think>abc');
        parser.reset();
        expect(parser.push('x')).toEqual([{ type: 'content', text: 'x' }]);
        expect(parser.finish()).toEqual([]);

        parser.push('<thi');
        parser.reset();
        expect(parser.push('nk>x')).toEqual([{ type: 'content', text: 'nk>x' }]);
    });

    it('flushes once and resets after finish', () => {
        const parser = new InlineReasoningParser();
        expect(parser.push('<thi')).toEqual([]);
        expect(parser.finish()).toEqual([{ type: 'content', text: '<thi' }]);
        expect(parser.finish()).toEqual([]);

        expect(parser.push('<think>abc</thi')).toEqual([
            { type: 'reasoning', text: 'abc' }
        ]);
        expect(parser.finish()).toEqual([{ type: 'reasoning', text: '</thi' }]);
        expect(parser.push('x')).toEqual([{ type: 'content', text: 'x' }]);
    });

    it('rejects empty markers', () => {
        expect(() => new InlineReasoningParser({ open: '', close: 'x' })).toThrow(
            'Inline reasoning markers must be non-empty.'
        );
        expect(() => new InlineReasoningParser({ open: 'x', close: '' })).toThrow(
            'Inline reasoning markers must be non-empty.'
        );
    });

    it('rejects identical markers', () => {
        expect(() => new InlineReasoningParser({ open: 'x', close: 'x' })).toThrow(
            'Inline reasoning markers must differ.'
        );
    });
});
