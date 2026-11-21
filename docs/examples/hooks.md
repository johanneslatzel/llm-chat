# Hooks

Four hook layers observe one request: stream chunks, completed messages, tool
execution, and the send loop. This example logs all four around a customer
lookup tool that can fail.

```typescript
import { ChunkType, type ChatService } from '@johannes.latzel/llm-chat';
import { ChatRole } from '@johannes.latzel/llm-chat-message';
import {
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult,
} from '@johannes.latzel/llm-chat-tool';
// Supply a ChatService from a provider package, or subclass ChatService.
declare const service: ChatService;

class LookupCustomerTool extends Tool {
    constructor() {
        super(
            'lookup_customer',
            'Look up a customer by ID.',
            new ToolParameters(
                { id: ToolParameterProperty.string('Customer ID') },
                ['id']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return args.id === '42'
            ? { result: 'Ada Lovelace, active, plan: pro', status: ResultStatus.Success }
            : { result: `Customer '${String(args.id)}' not found`, status: ResultStatus.Error };
    }
}

service.chat()
    .system()
    .child('general')
    .prompt('rules')
    .setContent('Use tools to answer questions about customers.');

service.tools().add(new LookupCustomerTool());

service.stream()
    .hook()
    .chunks(ChunkType.Content)
    .do((chunk) => process.stdout.write(chunk.text));

service.stream()
    .hook()
    .chunks(ChunkType.Finish)
    .do((chunk) => console.error(`\n[stream] finish: ${chunk.finishReason}`));

service.chat()
    .hook()
    .message(ChatRole.User, ChatRole.Assistant)
    .do((message) => {
        console.error(`[chat] ${message.role}: ${message.content.length} chars`);
    });

service.tools()
    .hook()
    .before()
    .do((name, args) => console.error(`[tool] before ${name}`, args));

service.tools()
    .hook()
    .after()
    .do((result) => console.error(`[tool] after ${result.tool}: ${result.result}`));

service.tools()
    .hook()
    .error()
    .do((name, error) => console.error(`[tool] error ${name}: ${error.message}`));

let sentAt = 0;

service.hook()
    .beforeSend()
    .do(() => {
        sentAt = performance.now();
        console.error('[service] before send');
    });

service.hook()
    .afterSend()
    .do(() => {
        const elapsed = Math.round(performance.now() - sentAt);
        console.error(`[service] after send (${elapsed} ms)`);
    });

await service.chat().user('Look up customers 42 and 999.');
await service.send();
process.stdout.write('\n');
```

## What to watch

- Stream hooks fire as chunks arrive, before the completed message is appended
  to chat.
- Tool `before` hooks are awaited and receive the mutable argument object.
- `after` hooks fire only for successful results. A failed call fires `error`
  instead.
- Service `beforeSend` and `afterSend` bracket each provider round.

Stream hooks are fire-and-forget. Tool and service hooks are awaited.

## See also

- [Hooks overview](../hooks/index.md)
- [Stream hooks](../services/stream-hooks.md)
- [Chat hooks](../chats/chat-hooks.md)
- [Tool hooks](https://johanneslatzel.github.io/llm-chat-tool/tools/tool-hooks/)
- [Service hooks](../services/chat-service.md#service-hooks)
