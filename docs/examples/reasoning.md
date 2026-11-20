# Reasoning Streams

Some models return reasoning in a structured field. Others put it inside
marker pairs in ordinary content. This example enables inline parsing and sends
reasoning to stderr while the answer goes to stdout.

```typescript
import {
    ChatServiceConfiguration,
    ChunkType,
    OpenAIChatService
} from '@johannes.latzel/llm-chat';

const config = new ChatServiceConfiguration();
config.parseInlineReasoning = true;
config.inlineReasoningMarkers = {
    open: '<think>',
    close: '</think>'
};

const service = OpenAIChatService.builder()
    .withServiceConfig(config)
    .systemPrompt(
        'Put private reasoning inside <think>...</think>, then give the final answer.'
    )
    .create();

service.stream()
    .hook()
    .chunks(ChunkType.Reasoning)
    .do((chunk) => process.stderr.write(chunk.text));

service.stream()
    .hook()
    .chunks(ChunkType.Content)
    .do((chunk) => process.stdout.write(chunk.text));

await service.chat().user('What is 17 * 23? Show your reasoning.');
await service.send();
process.stdout.write('\n');
```

## Structured reasoning

`OpenAIChatService` reads reasoning from `reasoning_details`, `reasoning`, and
`reasoning_content` automatically. Inline parsing is separate and opt-in
because marker text can be ordinary content for some models.

The final `ChatRole.Reasoning` message is stored in the chat. By default,
`filterReasoning` keeps reasoning messages out of later API requests.

## See also

- [Inline reasoning](../services/inline-reasoning.md)
- [Reasoning extraction](../services/openai.md#reasoning-extraction)
- [Stream hooks](../services/stream-hooks.md)
