# Services

ChatService implementations handle the tool-call loop and communication with LLM providers.

## Navigation

- **[ChatService](chat-service.md)**: abstract base class with tool-call loop, prompt loading
- **[OpenAI](openai.md)**: OpenAI-compatible streaming implementation
- **[Inline reasoning](inline-reasoning.md)**: opt-in parsing of explicit reasoning markers in content
- **[Inline tool calls](inline-tool-calls.md)**: opt-in parsing of explicit `<tool_call>` blocks in content
- **[Interrupt](interrupt.md)**: abort in-flight requests and re-send
- **[Custom provider](custom-provider.md)**: adding a new provider
