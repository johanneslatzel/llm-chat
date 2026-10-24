import { describe, it, expect } from 'vitest';
import {
    PartialToolResult,
    PropertyType,
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters
} from '../../../src/index.js';

describe('ToolParameterProperty — hidden aliases', () => {
    it('defaults to no aliases', () => {
        const prop = ToolParameterProperty.array('Paths');
        expect(prop.aliases).toEqual([]);
    });

    it('accepts returns a copy with aliases in declaration order', () => {
        const original = ToolParameterProperty.array('Paths');
        const aliased = original.accepts('path', 'file');
        expect(aliased).not.toBe(original);
        expect(original.aliases).toEqual([]);
        expect(aliased.aliases).toEqual(['path', 'file']);
        expect(aliased.type).toBe(PropertyType.Array);
        expect(aliased.description).toBe('Paths');
    });

    it('accepts appends aliases across calls', () => {
        const prop = ToolParameterProperty.array('Paths').accepts('path').accepts('file');
        expect(prop.aliases).toEqual(['path', 'file']);
    });

    it('copies the aliases array passed to the constructor', () => {
        const aliases = ['path'];
        const prop = new ToolParameterProperty(
            'Paths',
            PropertyType.Array,
            undefined,
            undefined,
            undefined,
            aliases
        );
        aliases.push('file');
        expect(prop.aliases).toEqual(['path']);
    });
});

describe('ToolParameters — alias validation', () => {
    it('rejects an empty alias', () => {
        expect(
            () => new ToolParameters({ paths: ToolParameterProperty.array('Paths').accepts('') })
        ).toThrow('must be a non-empty string');
    });

    it('rejects an alias with surrounding whitespace', () => {
        expect(
            () =>
                new ToolParameters({
                    paths: ToolParameterProperty.array('Paths').accepts(' path ')
                })
        ).toThrow('without surrounding whitespace');
    });

    it('rejects an alias equal to the canonical name', () => {
        expect(
            () =>
                new ToolParameters({
                    paths: ToolParameterProperty.array('Paths').accepts('paths')
                })
        ).toThrow('must differ from the canonical name');
    });

    it('rejects an alias that collides with a declared parameter', () => {
        expect(
            () =>
                new ToolParameters({
                    paths: ToolParameterProperty.array('Paths').accepts('path'),
                    path: ToolParameterProperty.string('A path')
                })
        ).toThrow('collides with a declared parameter name');
    });

    it('rejects a duplicate alias on the same parameter', () => {
        expect(
            () =>
                new ToolParameters({
                    paths: ToolParameterProperty.array('Paths').accepts('path', 'path')
                })
        ).toThrow('is declared more than once');
    });

    it('rejects a duplicate alias on different parameters', () => {
        expect(
            () =>
                new ToolParameters({
                    paths: ToolParameterProperty.array('Paths').accepts('item'),
                    urls: ToolParameterProperty.array('Urls').accepts('item')
                })
        ).toThrow("is declared for both 'paths' and 'urls'");
    });
});

describe('ToolParameters — normalizeArguments', () => {
    it('returns the same object when no aliases are declared', () => {
        const params = new ToolParameters({ name: ToolParameterProperty.string('Name') });
        const args = { name: 'x' };
        expect(params.normalizeArguments(args)).toBe(args);
    });

    it('maps an alias when the canonical key is absent', () => {
        const params = new ToolParameters(
            { paths: ToolParameterProperty.array('Paths').accepts('path') },
            ['paths']
        );
        expect(params.normalizeArguments({ path: 'a.txt' })).toEqual({ paths: ['a.txt'] });
    });

    it('keeps the canonical key when both canonical and alias are present', () => {
        const params = new ToolParameters(
            { paths: ToolParameterProperty.array('Paths').accepts('path') },
            ['paths']
        );
        expect(params.normalizeArguments({ paths: ['a.txt'], path: 'b.txt' })).toEqual({
            paths: ['a.txt']
        });
    });

    it('uses the first present alias in declaration order', () => {
        const params = new ToolParameters(
            { paths: ToolParameterProperty.array('Paths').accepts('path', 'file') },
            ['paths']
        );
        expect(params.normalizeArguments({ path: 'a.txt', file: 'b.txt' })).toEqual({
            paths: ['a.txt']
        });
    });

    it('falls through to a later alias when the first is absent', () => {
        const params = new ToolParameters(
            { paths: ToolParameterProperty.array('Paths').accepts('path', 'file') },
            ['paths']
        );
        expect(params.normalizeArguments({ file: 'b.txt' })).toEqual({ paths: ['b.txt'] });
    });

    it('keeps array alias values as arrays', () => {
        const params = new ToolParameters(
            { paths: ToolParameterProperty.array('Paths').accepts('path') },
            ['paths']
        );
        expect(params.normalizeArguments({ path: ['a.txt', 'b.txt'] })).toEqual({
            paths: ['a.txt', 'b.txt']
        });
    });

    it('does not wrap scalar values for non-array parameters', () => {
        const params = new ToolParameters({
            name: ToolParameterProperty.string('Name').accepts('label')
        });
        expect(params.normalizeArguments({ label: 'x' })).toEqual({ name: 'x' });
    });

    it('preserves unrelated keys and does not mutate the input', () => {
        const params = new ToolParameters(
            { paths: ToolParameterProperty.array('Paths').accepts('path') },
            ['paths']
        );
        const args = { path: 'a.txt', extra: 1 };
        expect(params.normalizeArguments(args)).toEqual({ paths: ['a.txt'], extra: 1 });
        expect(args).toEqual({ path: 'a.txt', extra: 1 });
    });

    it('ignores an alias whose value is undefined', () => {
        const params = new ToolParameters(
            { paths: ToolParameterProperty.array('Paths').accepts('path') },
            ['paths']
        );
        expect(params.normalizeArguments({ path: undefined })).toEqual({});
    });

    it('skips properties without aliases when other properties have them', () => {
        const params = new ToolParameters({
            paths: ToolParameterProperty.array('Paths').accepts('path'),
            recursive: ToolParameterProperty.boolean('Recursive')
        });
        expect(params.normalizeArguments({ path: 'a.txt', recursive: true })).toEqual({
            paths: ['a.txt'],
            recursive: true
        });
    });
});

describe('Tool — hidden aliases', () => {
    class AliasTool extends Tool {
        constructor() {
            super(
                'alias_tool',
                'A tool with a hidden alias',
                new ToolParameters(
                    { paths: ToolParameterProperty.array('Paths').accepts('path') },
                    ['paths']
                )
            );
        }

        protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
            return { result: JSON.stringify(args.paths), status: ResultStatus.Success };
        }
    }

    it('normalizes aliases before onExecute', async () => {
        const results = await new AliasTool().execute({ path: 'a.txt' });
        expect(results[0]!.result).toBe('["a.txt"]');
    });

    it('exposes normalization for pre-validation callers', () => {
        expect(new AliasTool().normalizeArguments({ path: 'a.txt' })).toEqual({
            paths: ['a.txt']
        });
    });

    it('does not expose aliases in the OpenAI schema', () => {
        const json = JSON.parse(JSON.stringify(new AliasTool().toOpenAI()));
        expect(json.function.parameters.properties).toEqual({
            paths: { type: 'array', description: 'Paths', items: { type: 'string' } }
        });
        expect(json.function.parameters.required).toEqual(['paths']);
        expect(json.function.parameters.properties.path).toBeUndefined();
    });
});
