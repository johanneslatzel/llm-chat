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
