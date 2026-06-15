import OpenAI from 'openai';

/** Valid JSON Schema property types for {@link ToolParameterProperty}. */
export enum PropertyType {
    String = 'string',
    Number = 'number',
    Integer = 'integer',
    Boolean = 'boolean',
    Array = 'array',
    Object = 'object'
}

/** Outcome of a tool execution returned by {@link Tool.onExecute}. */
export enum ResultStatus {
    Success = 'success',
    Error = 'error'
}

/** The value a tool's {@link Tool.onExecute} must return. */
export type PartialToolResult = {
    result: string;
    status: ResultStatus;
    /** Chained result for multi-result tools. Set by {@link ResultBuilder.build}; most tools leave this undefined. */
    next?: PartialToolResult;
};

/**
 * Accumulates multiple {@link PartialToolResult} nodes and chains them
 * via {@link PartialToolResult.next}. Built tools use this to return
 * several independent results in a single tool call.
 *
 * @example
 * const builder = new ResultBuilder();
 * builder.add({ result: "file a", status: ResultStatus.Success });
 * builder.add({ result: "file b", status: ResultStatus.Error });
 * return builder.build();
 */
export class ResultBuilder {
    private results: PartialToolResult[] = [];

    add(result: PartialToolResult): this {
        this.results.push(result);
        return this;
    }

    /** Links all added results via `next` and returns the head. */
    build(): PartialToolResult {
        if (this.results.length === 0) {
            throw new Error('ResultBuilder: no results added');
        }
        for (let i = 0; i < this.results.length - 1; i++) {
            this.results[i]!.next = this.results[i + 1]!;
        }
        return this.results[0]!;
    }

    /** Creates a pre-populated builder from an array of results. */
    static from(results: PartialToolResult[]): ResultBuilder {
        const builder = new ResultBuilder();
        for (const r of results) {
            builder.add(r);
        }
        return builder;
    }

    /** Await all promise results then build the chain in one step. */
    static async resolveAll(promises: Promise<PartialToolResult>[]): Promise<PartialToolResult> {
        return ResultBuilder.from(await Promise.all(promises)).build();
    }
}

/** A tool execution result wrapped with the tool name by {@link Tool.execute}. */
export type ToolResult = PartialToolResult & {
    tool: string;
    /** The original thrown value, if any. Set by the framework's error boundary, never set by tool implementors. */
    error?: unknown;
};

/** Describes the input schema for an OpenAI-compatible tool definition. */
export class ToolParameters {
    /** JSON Schema type — always `'object'`. */
    type: string = 'object';
    /** Map of parameter names to their property definitions. */
    properties: Record<string, ToolParameterProperty>;
    /** Optional list of parameter names that must be provided. */
    required?: string[];
    /**
     * @param properties - Named parameter definitions.
     * @param required  - Parameter names that are required.
     */
    constructor(properties: Record<string, ToolParameterProperty>, required?: string[]) {
        this.properties = properties;
        if (required) {
            this.required = required;
        }
    }

    /** Serializes to a JSON Schema object. Called automatically by `JSON.stringify`. */
    toJSON() {
        const result: { type: string; properties: Record<string, unknown>; required?: string[] } = {
            type: this.type,
            properties: {}
        };
        for (const [key, prop] of Object.entries(this.properties)) {
            const entry: { type: string; description: string; items?: { type: string } } = {
                type: prop.type,
                description: prop.description
            };
            if (prop.type === PropertyType.Array) {
                entry.items = { type: 'string' };
            }
            result.properties[key] = entry;
        }
        if (this.required) {
            result.required = this.required;
        }
        return result;
    }
}

/** A single parameter definition within a tool's input schema. */
export class ToolParameterProperty {
    /** The JSON Schema type for this parameter (e.g. `string`, `integer`). */
    type: PropertyType;
    /** A human-readable description of what this parameter does. */
    description: string;
    /**
     * @param description - Human-readable description.
     * @param type        - JSON Schema type (defaults to `PropertyType.String`).
     */
    constructor(description: string, type: PropertyType = PropertyType.String) {
        this.type = type;
        this.description = description;
    }
}

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
                parameters: this.parameters as unknown as Record<string, unknown>
            }
        };
    }
}
