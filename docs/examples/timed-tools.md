# Timed tools

`TimedTool` wraps a tool and bounds how long `send()` waits for one
execution. This example wraps a five-second search with a two-second timeout.

```typescript
import {
    OpenAIChatService,
    ResultStatus,
    TimedTool,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult
} from '@johannes.latzel/llm-chat';

class SlowSearchTool extends Tool {
    constructor() {
        super(
            'slow_search',
            'Search an external index. The request takes five seconds.',
            new ToolParameters(
                { query: ToolParameterProperty.string('Search query') },
                ['query']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return {
            result: `Results for ${String(args.query)}`,
            status: ResultStatus.Success
        };
    }
}

const service = OpenAIChatService.builder()
    .systemPrompt('Search before answering. If a search times out, say so.')
    .create();

service.tools().add(
    new TimedTool(
        new SlowSearchTool(),
        2_000,
        (kind, message) => console.warn(`[${kind}] ${message}`)
    )
);

await service.chat().user('Search for llm-chat.');
await service.send();
console.log(service.lastAssistantContent());
```

## What happens

- The wrapper delegates the tool schema to `SlowSearchTool`.
- After two seconds it resolves with the error result
  `Error: Tool 'slow_search' timed out after 2000 ms`.
- The notify callback receives `TimedToolNotificationKind.Timeout`.
- `send()` continues with the error result, so the model can explain the
  failure.

The example passes the notify callback and omits `signal`, so this run has no
external cancellation. See [Timed tools](../tools/timed-tools.md) for the full
contract.

## See also

- [Timed tools](../tools/timed-tools.md)
- [Defining a tool](../tools/defining-tools.md)
- [Tool hooks](../tools/tool-hooks.md)
