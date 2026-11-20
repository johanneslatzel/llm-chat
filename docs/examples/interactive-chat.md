# Interactive Chat

Keep one service and one conversation for a terminal session. The loop streams
each reply and supports two session commands.

```typescript
import { createInterface } from 'node:readline/promises';
import { ChunkType, OpenAIChatService } from '@johannes.latzel/llm-chat';

const service = OpenAIChatService.builder()
    .systemPrompt('You are a concise assistant.')
    .create();

service.stream()
    .hook()
    .chunks(ChunkType.Content)
    .do((chunk) => process.stdout.write(chunk.text));

const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
    while (true) {
        const input = (await rl.question('\nYou: ')).trim();
        if (!input) continue;

        if (input === '/exit' || input === '/quit') break;

        if (input === '/clear') {
            service.chat().clear();
            console.log('Conversation cleared.');
            continue;
        }

        await service.chat().user(input);
        await service.send();
        process.stdout.write('\n');
    }
} finally {
    rl.close();
}
```

## Commands

| Command | Action |
|---|---|
| `/clear` | Remove all messages and prompt components |
| `/exit`, `/quit` | End the session |

The flat system prompt from `builder.systemPrompt()` is a service configuration,
not part of the prompt tree. It survives `/clear`.

## See also

- [Building messages](../chats/building-messages.md)
- [Chat hooks](../chats/chat-hooks.md)
- [ChatService](../services/chat-service.md)
