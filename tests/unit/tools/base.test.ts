import { describe, it, expect } from 'vitest';
import { ResultStatus, Tool, ToolParameters, ToolParameterProperty, type PartialToolResult } from '../../../src/index.js';

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
});

describe('ToolParameterProperty', () => {
    it('stores type and description', () => {
        const prop = new ToolParameterProperty('A parameter');
        expect(prop.type).toBe('string');
        expect(prop.description).toBe('A parameter');
    });
});

describe('ResultStatus', () => {
    it('has Success and Error values', () => {
        expect(ResultStatus.Success).toBe('success');
        expect(ResultStatus.Error).toBe('error');
    });
});
