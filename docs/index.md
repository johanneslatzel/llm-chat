# Overview

`@johannes.latzel/llm-chat` is the abstract, provider-neutral chat engine:
the tool-call loop, streaming, hooks, prompt trees and session persistence.

The engine ships no provider. Use `@johannes.latzel/llm-chat-openai`, or
implement a `ChatService` subclass whose `createStream()` yields normalized
`StreamEvent` values; the engine handles everything around it.


## Related packages

| Package | Description |
|---|---|
| [`@johannes.latzel/llm-chat-message`](https://johanneslatzel.github.io/llm-chat-message/) | Provider-neutral message, role, finish-reason and writer primitives; zero runtime dependencies |
| [`@johannes.latzel/llm-chat-tool`](https://johanneslatzel.github.io/llm-chat-tool/) | Provider-neutral tool, hook and result primitives; zero runtime dependencies |
| [`@johannes.latzel/llm-chat-openai`](https://johanneslatzel.github.io/llm-chat-openai/) | OpenAI / OpenAI-compatible provider implementing `ChatService.createStream()` |

## Navigation

- [Examples](examples/index.md): scripts for chats, tools, hooks, and sessions
- [Chats](chats/index.md): building messages, hooks, serialization
- [Services](services/index.md): tool-call loop and provider contract
- [Tools](tools/index.md): defining tools, registration, hooks (imported from `@johannes.latzel/llm-chat-tool`)
- [Hooks](hooks/index.md): overview of the hook system
- [Environment variables](env.md): configuration reference
- [Architecture](architecture.md): high-level design
- [API reference](api-reference.md): exported classes, types and enums

## License

MIT
