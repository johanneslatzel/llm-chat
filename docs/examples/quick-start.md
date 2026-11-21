# Quick start

Send one message and stream the reply. The engine ships no provider, so a
service comes either from a provider package or from a `ChatService` subclass.

## Engine only (external provider)

`ChatService` is abstract. A provider package supplies a concrete subclass, and
the engine calls are the same for every provider. See
[Adding a new provider](../services/custom-provider.md) for a skeleton
implementation.

## With the OpenAI provider

Install the engine and the provider:

```bash
npm install @johannes.latzel/llm-chat @johannes.latzel/llm-chat-openai
```

Set the API key:

```bash
export OPENAI_API_KEY=sk-...
```

Then build the service, stream the reply, and send the message:

```typescript
import { ChunkType } from '@johannes.latzel/llm-chat';
import { OpenAIChatService } from '@johannes.latzel/llm-chat-openai';

const service = OpenAIChatService.builder()
    .model('gpt-4.1')
    .systemPrompt('You are a helpful assistant.')
    .create();

// Hooks fire while send() consumes the provider stream.
service
    .stream()
    .hook()
    .chunks(ChunkType.Content)
    .do((chunk) => process.stdout.write(chunk.text));

await service.chat().user('Hello');
await service.send();
```

Save the program as `quick-start.ts` and run it with
`npx tsx quick-start.ts`. Builder methods are listed in the
[OpenAI provider API reference](https://johanneslatzel.github.io/llm-chat-openai/api-reference/).

`gpt-4.1` is an example model, not a default. `LLM_CHAT_OPENAI_DEFAULT_MODEL`
can supply the model instead of `model(...)`. Model names, credentials and
transport are provider configuration.

## See also

- [Environment variables](../env.md)
- [Adding a new provider](../services/custom-provider.md)
- [Stream hooks](../services/stream-hooks.md)

## Full API

See [API reference](../api-reference.md).
