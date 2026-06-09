# Services

ChatService implementations handle the tool-call loop and communication with LLM providers.

- **[ChatService](chat-service.md)** — abstract base class with tool-call loop, prompt loading
- **[OpenAI](openai.md)** — OpenAI-compatible streaming implementation
- **[Interrupt](interrupt.md)** — abort in-flight requests and re-send
- **[Custom provider](custom-provider.md)** — adding a new provider
