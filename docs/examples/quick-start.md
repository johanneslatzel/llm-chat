# Quick Start

Send one message and stream the reply.

```typescript
import { ChunkType, OpenAIChatService } from '@johannes.latzel/llm-chat';

const service = OpenAIChatService.builder()
    .systemPrompt('You are a concise assistant.')
    .create();

service.stream()
    .hook()
    .chunks(ChunkType.Content)
    .do((chunk) => process.stdout.write(chunk.text));

await service.chat().user('Explain what llm-chat does in two sentences.');
await service.send();
process.stdout.write('\n');
```

The service reads `LLM_CHAT_OPENAI_DEFAULT_MODEL` and throws when it is unset.
`OPENAI_API_KEY` and `OPENAI_BASE_URL` configure the client.

## See also

- [Environment Variables](../env.md)
- [OpenAIChatService](../services/openai.md)
- [Stream hooks](../services/stream-hooks.md)
