import { describe, it, expect } from 'vitest';
import { PropertyType, ResultStatus, Tool, ToolParameters, ToolParameterProperty, type PartialToolResult } from '../../../src/index.js';

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
        const result = await tool.execute({ input: 'hello' });
        expect(result.tool).toBe('test_tool');
        expect(result.result).toBe('Executed with: hello');
        expect(result.status).toBe(ResultStatus.Success);
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
        expect(success.status).toBe(ResultStatus.Success);
        expect(success.result).toBe('x is hello');

        const failure = await tool.execute({});
        expect(failure.status).toBe(ResultStatus.Error);
        expect(failure.result).toBe("Error: Missing required parameter: 'x'");
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

describe('ResultStatus', () => {
    it('has Success and Error values', () => {
        expect(ResultStatus.Success).toBe('success');
        expect(ResultStatus.Error).toBe('error');
    });
});
