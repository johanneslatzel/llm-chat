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

### Static factory methods

The raw `new ToolParameterProperty(...)` constructor works with any type, but for common cases you can use the static factories — they are shorter, self-documenting, and require no `PropertyType` import:

```ts
ToolParameterProperty.string("A name")
ToolParameterProperty.number("A numeric value")
ToolParameterProperty.integer("An integer count")
ToolParameterProperty.boolean("A true/false flag")
ToolParameterProperty.array("A list of strings")                             // items default to string
ToolParameterProperty.array("A list of scores", ToolParameterProperty.number("A score"))  // custom item type
ToolParameterProperty.array("A list of addresses", ToolParameterProperty.object("")
    .addProperty("street", ToolParameterProperty.string("Street"))
    .build()
)                                                                           // array of objects
ToolParameterProperty.object("A nested object")                              // returns a builder (see below)
```

### Nested object parameters

For parameters that are objects with their own sub-properties, use `ToolParameterProperty.object(desc)` which returns an `ObjectPropertyBuilder`:

```ts
new ToolParameters({
    name: ToolParameterProperty.string("Full name"),
    address: ToolParameterProperty.object("Mailing address")
        .addProperty("street", ToolParameterProperty.string("Street name"))
        .addProperty("city", ToolParameterProperty.string("City"))
        .addProperty("zip", ToolParameterProperty.integer("ZIP code"))
        .setRequired("street", "city", "zip")
        .build(),
}, ["name", "address"])
```

Objects can nest arbitrarily deep:

```ts
ToolParameterProperty.object("Config")
    .addProperty(
        "database",
        ToolParameterProperty.object("Database settings")
            .addProperty("host", ToolParameterProperty.string("Hostname"))
            .addProperty("port", ToolParameterProperty.integer("Port"))
            .build()
    )
    .build()
```

The builder only exposes methods valid for objects (`addProperty`, `setRequired`, `build`).

### Multiple results

A tool can return several independent results in a single call by chaining them with `ResultBuilder`. The LLM sees each node as a separate tool response, each with its own status. Results are linked via a `next` pointer on `PartialToolResult` — the return type stays `PartialToolResult` regardless of how many results the builder chains.

```ts
import { ResultBuilder } from "@johannes.latzel/llm-chat";

protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
    const builder = new ResultBuilder();
    for (const path of args.paths as string[]) {
        try {
            const content = await readFile(path, "utf-8");
            builder.add({ result: content, status: ResultStatus.Success });
        } catch (err) {
            builder.add({
                result: `Error reading ${path}: ${(err as Error).message}`,
                status: ResultStatus.Error
            });
        }
    }
    return builder.build();
}
```

#### Convenience: `from()` and `resolveAll()`

If you already have an array of results, use `ResultBuilder.from()`:

```ts
const results = await Promise.all(paths.map(p => readFile(p, "utf-8")));
return ResultBuilder.from(results).build();
```

If you have an array of promises, `ResultBuilder.resolveAll()` combines `Promise.all` + `build()` in one step:

```ts
return await ResultBuilder.resolveAll(paths.map(p => readFile(p, "utf-8")));
```

The `onExecute` signature stays `Promise<PartialToolResult>` — only multi-result tools opt in by using `ResultBuilder`. Tools that return a single result need no changes.

