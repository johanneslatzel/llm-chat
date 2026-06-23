# Registration

Register tools with the service via `service.tools().add(...)`:

```ts
import { OpenAIChatService, Tool, ToolParameters, ToolParameterProperty, ResultStatus } from "@johannes.latzel/llm-chat";

// tool definition (see "Defining a tool")
class GreetTool extends Tool {
    constructor() {
        super("greet", "Greets a person by name.", new ToolParameters(
            { name: new ToolParameterProperty("The name to greet") }, ["name"]
        ));
    }
    protected async onExecute(args: Record<string, unknown>) {
        const name = args.name;
        return typeof name === "string"
            ? { result: `Hello, ${name}!`, status: ResultStatus.Success }
            : { result: "name must be a string", status: ResultStatus.Error };
    }
}

const service = new OpenAIChatService();
service.tools().add(new GreetTool());
```

Duplicates throw: `"A tool with the name 'greet' is already registered."`

Look up a registered tool by name with `service.tools().get(name)`:

```ts
const tool = service.tools().get("greet");
if (tool) {
    // tool is the Tool instance
}
```

Returns `undefined` if no tool with that name is registered.
