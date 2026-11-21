# HookMessageWriter

Hooks that stage messages need to record where a message came from.
`HookMessageWriter` is the hook-facing half of the message queue: it exposes the
same append methods as `MessageWriter`, but each call takes an explicit
`ChatMessageOrigin`.

```typescript
import { ChatMessageOrigin } from '@johannes.latzel/llm-chat-message';

await writer.user('Please clarify.', ChatMessageOrigin.Hook);
```

A message written this way is queued and drained into the chat on the next
`service.send()`, with its origin preserved. Message hooks skip messages with
origin `Hook`, so a hook cannot re-trigger itself.

Host code stages messages through `service.queue()`, which uses the default
origin for each method. `ChatMessageOrigin` and `HookMessageWriter` are
exported by `@johannes.latzel/llm-chat-message`; the engine re-exports neither.

## See also

- [Building messages](../chats/building-messages.md): message origins
- [Hooks](index.md)
