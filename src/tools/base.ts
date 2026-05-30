import OpenAI from 'openai';

export enum ResultStatus {
    Success = 'success',
    Error = 'error'
}

export type PartialToolResult = {
    result: string;
    status: ResultStatus;
};

export type ToolResult = PartialToolResult & {
    tool: string;
};

export class ToolParameters {
    type: string = 'object';
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
    constructor(properties: Record<string, ToolParameterProperty>, required?: string[]) {
        this.properties = properties;
        if (required) {
            this.required = required;
        }
    }
}

export class ToolParameterProperty {
    type: string = 'string';
    description: string;
    constructor(description: string) {
        this.description = description;
    }
}

export abstract class Tool {
    public readonly name: string;
    public readonly description: string;
    private readonly parameters: ToolParameters;

    constructor(name: string, description: string, parameters: ToolParameters) {
        this.name = name;
        this.description = description;
        this.parameters = parameters;
    }

    protected abstract onExecute(args: Record<string, unknown>): Promise<PartialToolResult>;

    public async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const partialResult = await this.onExecute(args);
        return {
            tool: this.name,
            ...partialResult
        };
    }

    public toOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: this.parameters as unknown as Record<string, unknown>
            }
        };
    }
}
