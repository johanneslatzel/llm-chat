# Tool hooks

The first argument is a filter object with a single optional field:

| Field | Type | Description |
|-------|------|-------------|
| `tools` | `string[]` | If set, only fires for the listed tool names |

Pass `{}` to match every tool, or `{ tools: ["greet"] }` to match only specific tools:

```ts
const service = new OpenAIChatService();

// fires for ALL tools
service.tools().before({}, (name, args) => {
    console.log(`Running ${name}`);
    args.injected = "context";  // mutations affect the tool
});

// fires only for "greet"
service.tools().after({ tools: ["greet"] }, (result) => {
    console.log(`Done: ${result.result}`);
});

service.tools().error({}, (name, error) => console.error(`Failed: ${error.message}`));
```

Each returns a `Hook` — call `.dispose()` to unsubscribe.

Before-hooks receive the actual `args` object — mutations in-place propagate to the tool. After- and error-hooks are observers (mutations don't affect the returned result).
