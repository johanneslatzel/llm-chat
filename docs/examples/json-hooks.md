# JSON hooks

JSON hooks add behavior without TypeScript code. This example retries an answer
when the assistant refuses, and logs any tool failure.

## Hook files

Define the two hooks described in [JSON hooks](../hooks/json-hooks.md), then
place them in `./hooks`.

## Script

```typescript
import { ChatServiceConfiguration, type ChatService } from '@johannes.latzel/llm-chat';
import {
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult,
} from '@johannes.latzel/llm-chat-tool';
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
config.systemPrompt = 'Use the order tool when a question needs order data.';

// Supply a ChatService built with `config`.
declare const service: ChatService;

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
- [Environment variables](../env.md)
