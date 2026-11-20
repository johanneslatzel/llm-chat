# Local Endpoints

`OpenAIChatService` works with LM Studio, Ollama, and other servers that
implement the OpenAI Chat Completions API. The default client reads
`OPENAI_BASE_URL` and `OPENAI_API_KEY` at construction.

```typescript
import { OpenAIChatService } from '@johannes.latzel/llm-chat';

process.env.OPENAI_BASE_URL ??= 'http://localhost:1234/v1';
process.env.OPENAI_API_KEY ??= 'local';
process.env.LLM_CHAT_OPENAI_DEFAULT_MODEL ??= 'local-model';

const service = OpenAIChatService.builder()
    .systemPrompt('You are a concise assistant.')
    .create();

await service.chat().user('Reply with one sentence about local models.');
await service.send();
console.log(service.lastAssistantContent());
```

## Server settings

| Server | `OPENAI_BASE_URL` |
|---|---|
| LM Studio | `http://localhost:1234/v1` |
| Ollama | `http://localhost:11434/v1` |
| vLLM | `http://localhost:8000/v1` |

The base URL includes `/v1`. Most local servers ignore the API key, but the
client requires a non-empty value.

Some servers reject `stream_options`; keep `includeUsage` off for them. For a
preconfigured client, use `builder.withClient(new OpenAI({ baseURL, apiKey }))`.
The `openai` package is a dependency of llm-chat.

## See also

- [OpenAIChatService](../services/openai.md)
- [Environment Variables](../env.md)
- [Custom provider](../services/custom-provider.md)
