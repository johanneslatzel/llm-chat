import { describe, it, expect } from 'vitest';
import {
    InlineMarkerFinish,
    InlineMarkerParser,
    InlineMarkerType,
    type MarkerDefinition,
    type MarkerSegment
} from '../../../src/service/inline-markers.js';

const REASONING: MarkerDefinition<InlineMarkerType.Reasoning> = {
    type: InlineMarkerType.Reasoning,
    open: '<r>',
    close: '</r>',
    finish: InlineMarkerFinish.Marked
};

const TOOL: MarkerDefinition<InlineMarkerType.ToolCall> = {
    type: InlineMarkerType.ToolCall,
    open: '<t>',
    close: '</t>',
    finish: InlineMarkerFinish.Text,
    emitEmpty: true,
    emitPartial: false
};

const DEFINITIONS: readonly MarkerDefinition<
    InlineMarkerType.Reasoning | InlineMarkerType.ToolCall
>[] = [REASONING, TOOL];

function parse(
    chunks: string[],
    definitions: readonly MarkerDefinition<string>[] = DEFINITIONS
): MarkerSegment<string>[] {
    const parser = new InlineMarkerParser(definitions);
    return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.finish()];
}

function joined(segments: MarkerSegment<string>[], type: string): string {
    return segments
        .filter((segment) => segment.type === type)
        .map((segment) => segment.text)
        .join('');
}

describe('InlineMarkerParser', () => {
    it('parses interleaved marked regions in order', () => {
        expect(parse(['a<r>r1</r>b<t>t1</t>c'])).toEqual([
            { type: 'text', text: 'a' },
            { type: 'reasoning', text: 'r1' },
            { type: 'text', text: 'b' },
            { type: 'toolCall', text: 't1' },
            { type: 'text', text: 'c' }
        ]);
    });

    it('recognizes marker boundaries split at every character', () => {
        const input = 'a<r>r</r>b<t>t</t>c';
        for (let index = 0; index <= input.length; index++) {
            const segments = parse([input.slice(0, index), input.slice(index)]);
            expect(joined(segments, 'text')).toBe('abc');
            expect(joined(segments, 'reasoning')).toBe('r');
            expect(joined(segments, 'toolCall')).toBe('t');
        }
    });

    it('handles one-character chunks', () => {
        expect(parse([...'a<r>r</r>b<t>t</t>c'])).toEqual([
            { type: 'text', text: 'a' },
            { type: 'reasoning', text: 'r' },
            { type: 'text', text: 'b' },
            { type: 'toolCall', text: 't' },
            { type: 'text', text: 'c' }
        ]);
    });

    it('handles empty input and consecutive empty pushes', () => {
        const parser = new InlineMarkerParser(DEFINITIONS);
        expect(parser.push('')).toEqual([]);
        expect(parser.push('')).toEqual([]);
        expect(parser.finish()).toEqual([]);
    });

    it('drops empty marked segments unless emitEmpty is set', () => {
        expect(parse(['<r></r>'])).toEqual([]);
        expect(parse(['<t></t>'])).toEqual([{ type: 'toolCall', text: '' }]);
        expect(parse(['a<r></r>b'])).toEqual([
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' }
        ]);
    });

    it('flushes unclosed marked blocks according to the definition policy', () => {
        expect(parse(['<r>abc'])).toEqual([{ type: 'reasoning', text: 'abc' }]);
        expect(parse(['<t>abc'])).toEqual([{ type: 'text', text: '<t>abc' }]);
        expect(parse(['<r>'])).toEqual([]);
        expect(parse(['<t>'])).toEqual([{ type: 'text', text: '<t>' }]);
    });

    it('treats a partial opening marker at EOF as text', () => {
        expect(parse(['a<r'])).toEqual([
            { type: 'text', text: 'a' },
            { type: 'text', text: '<r' }
        ]);
        expect(parse(['a<t'])).toEqual([
            { type: 'text', text: 'a' },
            { type: 'text', text: '<t' }
        ]);
    });

    it('treats stray closing markers and nested openings correctly', () => {
        expect(parse(['</r>'])).toEqual([{ type: 'text', text: '</r>' }]);
        expect(parse(['<r><r>x</r>'])).toEqual([{ type: 'reasoning', text: '<r>x' }]);
        expect(parse(['<t><r>x</t>'])).toEqual([{ type: 'toolCall', text: '<r>x' }]);
    });

    it('prefers the longest opening marker on a tie', () => {
        const short: MarkerDefinition<'short'> = {
            type: 'short',
            open: '<x>',
            close: '</x>',
            finish: InlineMarkerFinish.Marked
        };
        const long: MarkerDefinition<'long'> = {
            type: 'long',
            open: '<x><y>',
            close: '</y>',
            finish: InlineMarkerFinish.Marked
        };

        expect(parse(['<x><y>v</y>'], [short, long])).toEqual([
            { type: 'long', text: 'v' }
        ]);
        expect(parse(['<x><y>v</y>'], [long, short])).toEqual([
            { type: 'long', text: 'v' }
        ]);
    });

    it('selects the earliest opening marker across definitions', () => {
        const a: MarkerDefinition<'a'> = {
            type: 'a',
            open: '<a>',
            close: '</a>',
            finish: InlineMarkerFinish.Marked
        };
        const b: MarkerDefinition<'b'> = {
            type: 'b',
            open: '<b>',
            close: '</b>',
            finish: InlineMarkerFinish.Marked
        };

        expect(parse(['<a>1</a><b>2</b>'], [b, a])).toEqual([
            { type: 'a', text: '1' },
            { type: 'b', text: '2' }
        ]);
        expect(parse(['<a>1</a><b>2</b>'], [a, b])).toEqual([
            { type: 'a', text: '1' },
            { type: 'b', text: '2' }
        ]);
    });

    it('supports single-character marker pairs', () => {
        const single: MarkerDefinition<'s'>[] = [
            { type: 's', open: '[', close: ']', finish: InlineMarkerFinish.Marked }
        ];
        expect(parse(['a[b]c'], single)).toEqual([
            { type: 'text', text: 'a' },
            { type: 's', text: 'b' },
            { type: 'text', text: 'c' }
        ]);
        expect(parse(['abc'], single)).toEqual([{ type: 'text', text: 'abc' }]);
    });

    it('preserves unicode and multiline text exactly', () => {
        expect(parse(['héllo\n<r>réfléchi\n</r>世界'])).toEqual([
            { type: 'text', text: 'héllo\n' },
            { type: 'reasoning', text: 'réfléchi\n' },
            { type: 'text', text: '世界' }
        ]);
    });

    it('resets buffered text and active state', () => {
        const parser = new InlineMarkerParser(DEFINITIONS);
        parser.push('<r>abc');
        parser.reset();
        expect(parser.push('x')).toEqual([{ type: 'text', text: 'x' }]);
        expect(parser.finish()).toEqual([]);
    });

    it('flushes once and resets after finish', () => {
        const parser = new InlineMarkerParser(DEFINITIONS);
        expect(parser.push('<r>abc')).toEqual([{ type: 'reasoning', text: 'abc' }]);
        expect(parser.finish()).toEqual([]);
        expect(parser.finish()).toEqual([]);
        expect(parser.push('x')).toEqual([{ type: 'text', text: 'x' }]);
    });

    it('rejects an empty definition list', () => {
        expect(() => new InlineMarkerParser([])).toThrow(
            'At least one inline marker definition is required.'
        );
    });

    it('rejects empty markers', () => {
        expect(
            () =>
                new InlineMarkerParser([
                    { type: 'a', open: '', close: '</a>', finish: InlineMarkerFinish.Marked }
                ])
        ).toThrow('Inline marker open/close must be non-empty.');
        expect(
            () =>
                new InlineMarkerParser([
                    { type: 'a', open: '<a>', close: '', finish: InlineMarkerFinish.Marked }
                ])
        ).toThrow('Inline marker open/close must be non-empty.');
    });

    it('rejects identical markers and duplicate opening markers', () => {
        expect(
            () =>
                new InlineMarkerParser([
                    { type: 'a', open: '<a>', close: '<a>', finish: InlineMarkerFinish.Marked }
                ])
        ).toThrow('Inline marker open/close must differ.');

        expect(
            () =>
                new InlineMarkerParser([
                    { type: 'a', open: '<a>', close: '</a>', finish: InlineMarkerFinish.Marked },
                    { type: 'b', open: '<a>', close: '</b>', finish: InlineMarkerFinish.Marked }
                ])
        ).toThrow('Duplicate inline marker open: <a>');
    });
});
