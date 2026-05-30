import OpenAI from 'openai';
export declare enum ResultStatus {
    Success = "success",
    Error = "error"
}
export type PartialToolResult = {
    result: string;
    status: ResultStatus;
};
export type ToolResult = PartialToolResult & {
    tool: string;
};
export declare class ToolParameters {
    type: string;
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
    constructor(properties: Record<string, ToolParameterProperty>, required?: string[]);
}
export declare class ToolParameterProperty {
    type: string;
    description: string;
    constructor(description: string);
}
export declare abstract class Tool {
    readonly name: string;
    readonly description: string;
    private readonly parameters;
    constructor(name: string, description: string, parameters: ToolParameters);
    protected abstract onExecute(args: Record<string, unknown>): Promise<PartialToolResult>;
    execute(args: Record<string, unknown>): Promise<ToolResult>;
    toOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool;
}
//# sourceMappingURL=base.d.ts.map