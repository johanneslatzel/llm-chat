import OpenAI from 'openai';
import { ToolParameters } from './parameter.js';
import { PartialToolResult, ResultStatus, ToolResult } from './result.js';

/** Base class for defining tools that the LLM can call. Extend and implement {@link onExecute}. */
export abstract class Tool {
    /** Unique name used by the model to invoke this tool. */
    public readonly name: string;
    /** Description of what this tool does (shown to the model). */
    public readonly description: string;
    private readonly parameters: ToolParameters;

    /**
     * @param name        - Unique tool name (used by the model to invoke it).
     * @param description - Description shown to the model.
     * @param parameters  - Input schema describing the tool's arguments.
     */
    constructor(name: string, description: string, parameters: ToolParameters) {
        this.name = name;
        this.description = description;
        this.parameters = parameters;
    }

    /** Override to implement the tool's logic. Called by {@link execute}. */
    protected abstract onExecute(args: Record<string, unknown>): Promise<PartialToolResult>;

    /**
     * Validates that required parameters are present and non-null.
     * Throws if a required parameter is missing, which is caught by the error
     * boundary in {@link execute} and returned as an error result.
     */
    protected validateRequiredParams(args: Record<string, unknown>, required: string[]): void {
        for (const key of required) {
            if (args[key] === undefined || args[key] === null) {
                throw new Error(`Missing required parameter: '${key}'`);
            }
        }
    }

    /**
     * Executes the tool with the given arguments. Walks the {@link PartialToolResult.next}
     * chain (if any) and returns one {@link ToolResult} per node.
     */
    public async execute(args: Record<string, unknown>): Promise<ToolResult[]> {
        try {
            const partialHead = await this.onExecute(args);
            const toolResults: ToolResult[] = [];
            let current: PartialToolResult | undefined = partialHead;
            while (current) {
                toolResults.push({ tool: this.name, ...current });
                current = current.next;
            }
            return toolResults;
        } catch (err) {
            return [
                {
                    tool: this.name,
                    result: `Error: ${err instanceof Error ? err.message : String(err)}`,
                    status: ResultStatus.Error,
                    error: err
                }
            ];
        }
    }

    /** Converts this tool to an OpenAI ChatCompletionTool definition. */
    public toOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: this.parameters.toJSON()
            }
        };
    }
}
