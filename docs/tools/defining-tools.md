# Defining a tool

```ts
import { Tool, ToolParameters, ToolParameterProperty, PartialToolResult, ResultStatus } from "llm-chat";

class GreetTool extends Tool {
    constructor() {
        super(
            "greet",
            "Greets a person by name.",
            new ToolParameters(
                { name: new ToolParameterProperty("The name of the person to greet") },
                ["name"]
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        const name = args.name;
        if (typeof name !== "string") {
            return { result: "name must be a string", status: ResultStatus.Error };
        }
        return { result: `Hello, ${name}!`, status: ResultStatus.Success };
    }
}
```
