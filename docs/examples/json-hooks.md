# JSON Hooks

JSON hooks add behavior without TypeScript code. This example retries an answer
when the assistant refuses, and logs any tool failure.

## Hook files

Create `hooks/retry-on-refusal.json`:

```json
{
    "label": "retry-on-refusal",
    "target": "chat",
    "roles": ["assistant"],
    "regex": "I don't know|I'm not sure|I can't help|I cannot help",
    "maxTriggers": 2,
    "actions": [
        {
            "type": "queue-message",
            "role": "user",
            "message": "Use the available tools and try again."
        },
        { "type": "queue-resend" }
    ]
}
```

Create `hooks/log-tool-errors.json`:

```json
{
    "label": "log-tool-errors",
    "target": "tool",
    "event": "error",
    "actions": [
        { "type": "warn", "message": "Tool {{name}} failed: {{error}}" }
    ]
}
```

## Script

```typescript
import {
    ChatServiceConfiguration,
    OpenAIChatService,
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult
} from '@johannes.latzel/llm-chat';

class LookupOrderTool extends Tool {
    constructor() {
        super(
            'lookup_order',
            'Look up an order by ID.',
            new ToolParameters(
                { id: ToolParameterProperty.string('Order ID') },
                ['id']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return args.id === '42'
            ? { result: 'Order 42: shipped', status: ResultStatus.Success }
            : { result: `Order '${String(args.id)}' not found`, status: ResultStatus.Error };
    }
}

const config = new ChatServiceConfiguration();
config.hooksDir = './hooks';

const service = OpenAIChatService.builder()
    .withServiceConfig(config)
    .systemPrompt('Use the order tool when a question needs order data.')
    .create();

service.tools().add(new LookupOrderTool());

await service.init();
console.log('Loaded JSON hooks:', service.getJsonHooks());

await service.chat().user('Look up order 999 and explain the result.');
await service.send();
console.log(service.lastAssistantContent());
```

`LLM_CHAT_HOOKS_DIR` sets the same directory from the environment and takes
precedence over `config.hooksDir`.

## How the hooks behave

- The chat hook matches completed assistant messages. On a match it queues a
  user message and sets the resend flag. The next `send()` iteration includes
  the queued message. `maxTriggers` caps retries.
- The tool hook fires on every failed tool result and logs the tool name and
  error message.
- Messages queued by hooks carry `origin: Hook`. Chat hooks ignore them, which
  prevents a hook from retrying itself forever.
- `queue-resend` lets the current response finish. `interrupt` with
  `resend: true` aborts the response first.

Stream hooks filter by chunk type only, not by regex. Use a chat hook for
content matching.

## See also

- [JSON hooks](../hooks/json-hooks.md)
- [HookMessageWriter](../hooks/hook-message-writer.md)
- [Environment Variables](../env.md)
