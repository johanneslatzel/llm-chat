# Defining a tool

```ts
import { Tool, ToolParameters, ToolParameterProperty, PartialToolResult, ResultStatus } from "@johannes.latzel/llm-chat";

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

### Safety net

`Tool.execute()` wraps `onExecute()` in a try-catch. If your tool throws, the error is caught and returned as the result with `status: 'error'`. The original thrown value is also preserved on `ToolResult.error` for error hooks to inspect. This means you can safely throw from any tool without crashing the tool-call loop, and the `service.tools().hook().error().do(...)` hook receives the original `Error` object (stack trace, custom properties, etc.).

### Parameter validation

Use `this.validateRequiredParams(args, [...])` in `onExecute` to check required parameters. It throws if a param is missing, and the error boundary handles the rest:

```ts
protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
    this.validateRequiredParams(args, ["name"]);
    return { result: `Hello, ${args.name}!`, status: ResultStatus.Success };
}
```

### Typed parameters

By default all parameters are `string`. To tell the model the correct type, pass a `PropertyType` as the second argument:

```ts
import { PropertyType } from "@johannes.latzel/llm-chat";

new ToolParameterProperty("Item count", PropertyType.Integer)
new ToolParameterProperty("Tags", PropertyType.Array)
new ToolParameterProperty("Is enabled", PropertyType.Boolean)
```
