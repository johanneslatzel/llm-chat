# Tools

Tools let the LLM call your code. Extend `Tool`, add to the service's `ToolSuite` via `service.tools().add(...)`.

Concrete tool implementations live in separate packages:
- [`llm-chat-filesystem`](https://github.com/johanneslatzel/llm-chat-filesystem) — filesystem, notebooks, web fetch/search, datetime, skills

## Defining a tool

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

## Registration

```ts
const suite = new ToolSuite();
suite.add(new GreetTool());

suite.getTools();                          // OpenAI-compatible ChatCompletionTool[]
await suite.executeTool("greet", JSON.stringify({ name: "Alice" }));
// => { result: "Hello, Alice!", status: "success" }
```

Duplicates throw: `"A tool with the name 'greet' is already registered."`
Unknown names throw: `"No tool registered with name '...'"`

## Hooks

```ts
suite.before({}, (name, args) => {
    console.log(`Running ${name}`);
    args.injected = "context";  // mutations affect the tool
});
suite.after({},  (result) => console.log(`Done: ${result.result}`));
suite.error({},  (name, error) => console.error(`Failed: ${error.message}`));
```

Each returns a `Hook` — call `.dispose()` to unsubscribe. Filter by tool name with the optional `tools` field (e.g. `{ tools: ["greet"] }`).

Before-hooks receive the actual `args` object — mutations in-place propagate to the tool. After- and error-hooks are observers (mutations don't affect the returned result).

## Integration

```ts
const service = new OpenAIChatService();
service.tools().add(new GreetTool());
const chat = service.chat();
await service.send();
```
