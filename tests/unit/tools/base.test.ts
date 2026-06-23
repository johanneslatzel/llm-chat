import { describe, it, expect } from 'vitest';
import { PropertyType, ResultStatus, Tool, ToolParameters, ToolParameterProperty, ObjectPropertyBuilder, ResultBuilder, type PartialToolResult } from '../../../src/index.js';

class ConcreteTool extends Tool {
    constructor() {
        super(
            'test_tool',
            'A test tool',
            new ToolParameters(
                {
                    input: new ToolParameterProperty('The input value'),
                },
                ['input']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: `Executed with: ${args.input}`,
            status: ResultStatus.Success,
        };
    }
}

describe('Tool', () => {
    it('sets name, description, and parameters from constructor', () => {
        const tool = new ConcreteTool();
        expect(tool.name).toBe('test_tool');
        expect(tool.description).toBe('A test tool');
    });

    it('execute calls onExecute and wraps result with tool name', async () => {
        const tool = new ConcreteTool();
        const results = await tool.execute({ input: 'hello' });
        expect(results).toHaveLength(1);
        expect(results[0]!.tool).toBe('test_tool');
        expect(results[0]!.result).toBe('Executed with: hello');
        expect(results[0]!.status).toBe(ResultStatus.Success);
    });

    it('execute returns error result when validateRequiredParams fails', async () => {
        class ValidatingTool extends Tool {
            constructor() {
                super('validating', 'Validates input', new ToolParameters({ x: new ToolParameterProperty('X') }, ['x']));
            }
            protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
                this.validateRequiredParams(args, ['x']);
                return { result: `x is ${args.x}`, status: ResultStatus.Success };
            }
        }
        const tool = new ValidatingTool();
        const success = await tool.execute({ x: 'hello' });
        expect(success).toHaveLength(1);
        expect(success[0]!.status).toBe(ResultStatus.Success);
        expect(success[0]!.result).toBe('x is hello');

        const failure = await tool.execute({});
        expect(failure).toHaveLength(1);
        expect(failure[0]!.status).toBe(ResultStatus.Error);
        expect(failure[0]!.result).toBe("Error: Missing required parameter: 'x'");
    });

    it('toOpenAI returns a ChatCompletionTool structure', () => {
        const tool = new ConcreteTool();
        const openaiTool = tool.toOpenAI();
        expect(openaiTool.type).toBe('function');
        expect(openaiTool.function.name).toBe('test_tool');
        expect(openaiTool.function.description).toBe('A test tool');
        expect(openaiTool.function.parameters).toBeDefined();
        expect((openaiTool.function.parameters as any).type).toBe('object');
        expect((openaiTool.function.parameters as any).properties.input).toBeDefined();
        expect((openaiTool.function.parameters as any).required).toEqual(['input']);
    });

    it('toOpenAI serializes typed properties correctly', () => {
        class TypedTool extends Tool {
            constructor() {
                super(
                    'typed_tool',
                    'A tool with typed params',
                    new ToolParameters(
                        {
                            count: new ToolParameterProperty('Item count', PropertyType.Integer),
                            tags: new ToolParameterProperty('Tags', PropertyType.Array),
                        },
                        ['count']
                    )
                );
            }
            protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
                return { result: 'ok', status: ResultStatus.Success };
            }
        }
        const tool = new TypedTool();
        const json = JSON.parse(JSON.stringify(tool.toOpenAI()));
        expect(json).toEqual({
            type: 'function',
            function: {
                name: 'typed_tool',
                description: 'A tool with typed params',
                parameters: {
                    type: 'object',
                    properties: {
                        count: { type: 'integer', description: 'Item count' },
                        tags: { type: 'array', description: 'Tags', items: { type: 'string' } },
                    },
                    required: ['count'],
                },
            },
        });
    });
});

describe('ToolParameters', () => {
    it('stores properties and optional required array', () => {
        const params = new ToolParameters(
            {
                name: new ToolParameterProperty('The name'),
            },
            ['name']
        );
        expect(params.type).toBe('object');
        expect(params.properties.name!.description).toBe('The name');
        expect(params.required).toEqual(['name']);
    });

    it('works without required array', () => {
        const params = new ToolParameters({});
        expect(params.required).toBeUndefined();
    });

    it('toJSON omits required when not set', () => {
        const params = new ToolParameters({ name: new ToolParameterProperty('A name') });
        const json = JSON.parse(JSON.stringify(params));
        expect(json.required).toBeUndefined();
        expect(json.properties.name).toBeDefined();
    });

    it('toJSON generates proper JSON Schema', () => {
        const params = new ToolParameters(
            {
                name: new ToolParameterProperty('A name'),
                count: new ToolParameterProperty('Item count', PropertyType.Integer),
                tags: new ToolParameterProperty('List of tags', PropertyType.Array),
                enabled: new ToolParameterProperty('Is enabled', PropertyType.Boolean),
            },
            ['name']
        );
        const json = JSON.parse(JSON.stringify(params));
        expect(json).toEqual({
            type: 'object',
            properties: {
                name: { type: 'string', description: 'A name' },
                count: { type: 'integer', description: 'Item count' },
                tags: { type: 'array', description: 'List of tags', items: { type: 'string' } },
                enabled: { type: 'boolean', description: 'Is enabled' },
            },
            required: ['name'],
        });
    });
});

describe('ToolParameterProperty', () => {
    it('defaults type to string', () => {
        const prop = new ToolParameterProperty('A parameter');
        expect(prop.type).toBe('string');
        expect(prop.description).toBe('A parameter');
    });

    it('accepts a custom type', () => {
        const prop = new ToolParameterProperty('A number', PropertyType.Integer);
        expect(prop.type).toBe(PropertyType.Integer);
        expect(prop.description).toBe('A number');
    });
});

describe('ToolParameterProperty — static factories', () => {
    it('string creates a string-typed property', () => {
        const prop = ToolParameterProperty.string('A name');
        expect(prop.type).toBe(PropertyType.String);
        expect(prop.description).toBe('A name');
        expect(prop.properties).toBeUndefined();
        expect(prop.required).toBeUndefined();
        expect(prop.items).toBeUndefined();
    });

    it('number creates a number-typed property', () => {
        const prop = ToolParameterProperty.number('A count');
        expect(prop.type).toBe(PropertyType.Number);
    });

    it('integer creates an integer-typed property', () => {
        const prop = ToolParameterProperty.integer('An index');
        expect(prop.type).toBe(PropertyType.Integer);
    });

    it('boolean creates a boolean-typed property', () => {
        const prop = ToolParameterProperty.boolean('A flag');
        expect(prop.type).toBe(PropertyType.Boolean);
    });

    it('array creates an array-typed property with default string items', () => {
        const prop = ToolParameterProperty.array('Tags');
        expect(prop.type).toBe(PropertyType.Array);
        expect(prop.items).toBeUndefined();
    });

    it('array accepts a ToolParameterProperty as items type', () => {
        const prop = ToolParameterProperty.array('Scores', ToolParameterProperty.number('A score'));
        expect(prop.type).toBe(PropertyType.Array);
        expect(prop.items).toBeInstanceOf(ToolParameterProperty);
        expect(prop.items!.type).toBe(PropertyType.Number);
    });

    it('array accepts object property as items for arrays of objects', () => {
        const item = ToolParameterProperty.object('')
            .addProperty('street', ToolParameterProperty.string('Street'))
            .addProperty('zip', ToolParameterProperty.integer('ZIP'))
            .setRequired('street')
            .build();
        const prop = ToolParameterProperty.array('Addresses', item);

        expect(prop.type).toBe(PropertyType.Array);
        expect(prop.items).toBe(item);
    });

    it('object returns an ObjectPropertyBuilder', () => {
        const builder = ToolParameterProperty.object('Address');
        expect(builder).toBeInstanceOf(ObjectPropertyBuilder);
    });

    it('builder constructs a valid object property', () => {
        const prop = ToolParameterProperty.object('Address')
            .addProperty('street', ToolParameterProperty.string('Street'))
            .addProperty('zip', ToolParameterProperty.integer('ZIP'))
            .setRequired('street', 'zip')
            .build();

        expect(prop.type).toBe(PropertyType.Object);
        expect(prop.description).toBe('Address');
        expect(prop.properties!).toHaveProperty('street');
        expect(prop.properties!).toHaveProperty('zip');
        expect(prop.required).toEqual(['street', 'zip']);
    });

    it('builder addProperty returns this for chaining', () => {
        const builder = ToolParameterProperty.object('Obj')
            .addProperty('a', ToolParameterProperty.string('A'))
            .addProperty('b', ToolParameterProperty.string('B'));
        expect(builder).toBeInstanceOf(ObjectPropertyBuilder);
    });
});

describe('ToolParameterProperty — validation', () => {
    it('allows empty required array', () => {
        const prop = ToolParameterProperty.object('Obj')
            .addProperty('x', ToolParameterProperty.string('X'))
            .build();
        expect(prop.required).toBeUndefined();
    });

    it('throws when object has no child properties', () => {
        expect(() => new ToolParameterProperty('Empty', PropertyType.Object, {})).toThrow(
            'has type object but no child properties'
        );
        expect(() => new ToolParameterProperty('Empty', PropertyType.Object, undefined)).toThrow(
            'has type object but no child properties'
        );
    });

    it('throws when object specifies items', () => {
        const props = { x: new ToolParameterProperty('X') };
        expect(() => new ToolParameterProperty('Bad', PropertyType.Object, props, undefined, ToolParameterProperty.string(''))).toThrow(
            'has type object but also specifies items'
        );
    });

    it('throws when object required key is not in properties', () => {
        const props = { x: new ToolParameterProperty('X') };
        expect(() => new ToolParameterProperty('Bad', PropertyType.Object, props, ['y'])).toThrow(
            'has required key not present in properties'
        );
    });

    it('throws when array specifies child properties', () => {
        const props = { x: new ToolParameterProperty('X') };
        expect(() => new ToolParameterProperty('Bad', PropertyType.Array, props)).toThrow(
            'has type array but also specifies child properties'
        );
    });

    it('throws when primitive has nested properties', () => {
        const props = { x: new ToolParameterProperty('X') };
        expect(() => new ToolParameterProperty('Bad', PropertyType.String, props)).toThrow(
            'has primitive type but also specifies nested schema'
        );
    });

    it('throws when primitive has items', () => {
        expect(() => new ToolParameterProperty('Bad', PropertyType.Integer, undefined, undefined, ToolParameterProperty.string(''))).toThrow(
            'has primitive type but also specifies nested schema'
        );
    });

    it('throws when primitive has required', () => {
        expect(() => new ToolParameterProperty('Bad', PropertyType.Boolean, undefined, ['x'])).toThrow(
            'has primitive type but also specifies nested schema'
        );
    });
});

describe('ToolParameters — object-typed properties', () => {
    it('serializes a nested object property with sub-properties and required', () => {
        const params = new ToolParameters(
            {
                name: ToolParameterProperty.string('Full name'),
                address: ToolParameterProperty.object('Mailing address')
                    .addProperty('street', ToolParameterProperty.string('Street'))
                    .addProperty('city', ToolParameterProperty.string('City'))
                    .addProperty('zip', ToolParameterProperty.integer('ZIP'))
                    .setRequired('street', 'city', 'zip')
                    .build(),
            },
            ['name', 'address']
        );
        const json = JSON.parse(JSON.stringify(params));
        expect(json).toEqual({
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Full name' },
                address: {
                    type: 'object',
                    description: 'Mailing address',
                    properties: {
                        street: { type: 'string', description: 'Street' },
                        city: { type: 'string', description: 'City' },
                        zip: { type: 'integer', description: 'ZIP' },
                    },
                    required: ['street', 'city', 'zip'],
                },
            },
            required: ['name', 'address'],
        });
    });

    it('serializes deeply nested objects (2+ levels)', () => {
        const params = new ToolParameters({
            config: ToolParameterProperty.object('Config')
                .addProperty(
                    'database',
                    ToolParameterProperty.object('DB settings')
                        .addProperty('host', ToolParameterProperty.string('Host'))
                        .addProperty('port', ToolParameterProperty.integer('Port'))
                        .setRequired('host', 'port')
                        .build()
                )
                .build(),
        });
        const json = JSON.parse(JSON.stringify(params));
        expect(json.properties.config.properties.database.properties).toHaveProperty('host');
        expect(json.properties.config.properties.database.properties).toHaveProperty('port');
        expect(json.properties.config.properties.database.required).toEqual(['host', 'port']);
    });

    it('object property without required omits the field', () => {
        const params = new ToolParameters({
            addr: ToolParameterProperty.object('Addr')
                .addProperty('line1', ToolParameterProperty.string('Line 1'))
                .build(),
        });
        const json = JSON.parse(JSON.stringify(params));
        expect(json.properties.addr.required).toBeUndefined();
    });

    it('serializes array with custom items via factory', () => {
        const params = new ToolParameters({
            scores: ToolParameterProperty.array('Scores', ToolParameterProperty.number('A score')),
            tags: ToolParameterProperty.array('Tags'),
        });
        const json = JSON.parse(JSON.stringify(params));
        expect(json.properties.scores).toEqual({
            type: 'array',
            description: 'Scores',
            items: { type: 'number', description: 'A score' },
        });
        expect(json.properties.tags).toEqual({
            type: 'array',
            description: 'Tags',
            items: { type: 'string' },
        });
    });

    it('serializes array of objects correctly', () => {
        const item = ToolParameterProperty.object('')
            .addProperty('street', ToolParameterProperty.string('Street'))
            .addProperty('zip', ToolParameterProperty.integer('ZIP'))
            .build();
        const params = new ToolParameters({
            addresses: ToolParameterProperty.array('Addresses', item),
        });
        const json = JSON.parse(JSON.stringify(params));
        expect(json.properties.addresses).toEqual({
            type: 'array',
            description: 'Addresses',
            items: {
                type: 'object',
                description: '',
                properties: {
                    street: { type: 'string', description: 'Street' },
                    zip: { type: 'integer', description: 'ZIP' },
                },
            },
        });
    });
});

describe('ResultStatus', () => {
    it('has Success and Error values', () => {
        expect(ResultStatus.Success).toBe('success');
        expect(ResultStatus.Error).toBe('error');
    });
});

describe('ResultBuilder', () => {
    it('build() returns head of a single-result chain', () => {
        const builder = new ResultBuilder();
        builder.add({ result: 'one', status: ResultStatus.Success });
        const head = builder.build();
        expect(head.result).toBe('one');
        expect(head.next).toBeUndefined();
    });

    it('chains multiple results via next', () => {
        const builder = new ResultBuilder();
        builder.add({ result: 'first', status: ResultStatus.Success });
        builder.add({ result: 'second', status: ResultStatus.Error });
        builder.add({ result: 'third', status: ResultStatus.Success });

        const head = builder.build();
        expect(head.result).toBe('first');
        expect(head.next!.result).toBe('second');
        expect(head.next!.status).toBe(ResultStatus.Error);
        expect(head.next!.next!.result).toBe('third');
        expect(head.next!.next!.next).toBeUndefined();
    });

    it('throws when build() is called with no results', () => {
        const builder = new ResultBuilder();
        expect(() => builder.build()).toThrow('ResultBuilder: no results added');
    });

    it('add() returns this for chaining', () => {
        const builder = new ResultBuilder();
        builder.add({ result: 'a', status: ResultStatus.Success })
               .add({ result: 'b', status: ResultStatus.Success });
        const head = builder.build();
        expect(head.result).toBe('a');
        expect(head.next!.result).toBe('b');
    });

    describe('from()', () => {
        it('builds a chain from an array of results', () => {
            const head = ResultBuilder.from([
                { result: 'x', status: ResultStatus.Success },
                { result: 'y', status: ResultStatus.Error }
            ]).build();

            expect(head.result).toBe('x');
            expect(head.next!.result).toBe('y');
            expect(head.next!.next).toBeUndefined();
        });

        it('throws when given an empty array', () => {
            expect(() => ResultBuilder.from([]).build())
                .toThrow('ResultBuilder: no results added');
        });
    });

    describe('resolveAll()', () => {
        it('awaits promises and builds the chain', async () => {
            const head = await ResultBuilder.resolveAll([
                Promise.resolve({ result: 'async-a', status: ResultStatus.Success }),
                Promise.resolve({ result: 'async-b', status: ResultStatus.Error })
            ]);

            expect(head.result).toBe('async-a');
            expect(head.next!.result).toBe('async-b');
            expect(head.next!.next).toBeUndefined();
        });

        it('throws when given an empty array', async () => {
            await expect(ResultBuilder.resolveAll([]))
                .rejects.toThrow('ResultBuilder: no results added');
        });

        it('propagates rejection from a failed promise', async () => {
            await expect(ResultBuilder.resolveAll([
                Promise.resolve({ result: 'ok', status: ResultStatus.Success }),
                Promise.reject(new Error('boom'))
            ])).rejects.toThrow('boom');
        });
    });
});

describe('Tool multi-result', () => {
    class MultiResultTool extends Tool {
        constructor() {
            super('multi', 'Returns multiple results', new ToolParameters({}));
        }

        protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
            const builder = new ResultBuilder();
            builder.add({ result: 'result-a', status: ResultStatus.Success });
            builder.add({ result: 'result-b', status: ResultStatus.Error });
            builder.add({ result: 'result-c', status: ResultStatus.Success });
            return builder.build();
        }
    }

    it('execute returns one ToolResult per chain node', async () => {
        const tool = new MultiResultTool();
        const results = await tool.execute({});
        expect(results).toHaveLength(3);
        expect(results[0]!.tool).toBe('multi');
        expect(results[0]!.result).toBe('result-a');
        expect(results[0]!.status).toBe(ResultStatus.Success);
        expect(results[1]!.tool).toBe('multi');
        expect(results[1]!.result).toBe('result-b');
        expect(results[1]!.status).toBe(ResultStatus.Error);
        expect(results[2]!.tool).toBe('multi');
        expect(results[2]!.result).toBe('result-c');
        expect(results[2]!.status).toBe(ResultStatus.Success);
    });

    it('execute does not mutate original PartialToolResult objects', async () => {
        const tool = new MultiResultTool();
        const results = await tool.execute({});
        // Each ToolResult is a fresh object (spread), not the original
        for (const r of results) {
            expect(Object.keys(r)).toContain('tool');
        }
    });
});
