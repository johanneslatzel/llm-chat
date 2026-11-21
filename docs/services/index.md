# Services

A `ChatService` implementation handles the tool-call loop and communication
with an LLM backend. This package provides the abstract base class; concrete
providers are separate packages or application code.

## Navigation

- [ChatService](chat-service.md): abstract base class with tool-call loop, prompt loading
- [Adding a new provider](custom-provider.md): implement `createStream()` for a new backend
- [`@johannes.latzel/llm-chat-openai`](https://johanneslatzel.github.io/llm-chat-openai/): first-party OpenAI provider, a complete `createStream()` implementation to copy from
- [Inline reasoning](inline-reasoning.md): opt-in parsing of explicit reasoning markers in content
- [Inline tool calls](inline-tool-calls.md): opt-in parsing of explicit `<tool_call>` blocks in content
- [Stream hooks](stream-hooks.md): observe streamed chunks, summaries, and usage
- [Interrupt](interrupt.md): abort in-flight requests and re-send
