import { ResultStatus, Tool, ToolParameters, ToolParameterProperty, type PartialToolResult } from '../../src/index.js';

export class AlphaTool extends Tool {
    constructor() {
        super(
            'alpha',
            'Alpha tool',
            new ToolParameters(
                { x: new ToolParameterProperty('Input x') },
                ['x']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: `Alpha: ${args.x}`,
            status: ResultStatus.Success,
        };
    }
}

export class BetaTool extends Tool {
    constructor() {
        super(
            'beta',
            'Beta tool',
            new ToolParameters({})
        );
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: 'Beta executed',
            status: ResultStatus.Success,
        };
    }
}

export class FailingTool extends Tool {
    constructor() {
        super('failing', 'Failing tool', new ToolParameters({}));
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        throw new Error('Intentional failure');
    }
}

export class ThrowsNonErrorTool extends Tool {
    constructor() {
        super('throws_non_error', 'Throws non-Error', new ToolParameters({}));
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        throw 'string error value';
    }
}
