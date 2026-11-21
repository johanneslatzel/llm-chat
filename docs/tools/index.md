# Tools

Tools let the LLM call host code. The provider-neutral primitives and their
guides live in `@johannes.latzel/llm-chat-tool`; this engine registers them
through `service.tools().add(...)`.

Package site: [llm-chat-tool](https://johanneslatzel.github.io/llm-chat-tool/).
OpenAI provider: [llm-chat-openai](https://johanneslatzel.github.io/llm-chat-openai/).

## Tool package guides

- [Defining a tool](https://johanneslatzel.github.io/llm-chat-tool/tools/defining-tools/): parameters, aliases, nested schemas, multiple results
- [Registration](https://johanneslatzel.github.io/llm-chat-tool/tools/registration/): build a host-owned tool index
- [Tool hooks](https://johanneslatzel.github.io/llm-chat-tool/tools/tool-hooks/): before, after and error events
- [Timed tools](https://johanneslatzel.github.io/llm-chat-tool/tools/timed-tools/): bound a call with a timeout and abort signal
- [Packages](https://johanneslatzel.github.io/llm-chat-tool/tools/packages/): group tools and contribute tutorial text

The engine runs the tool-call loop: see
[tool calling](../examples/tool-calling.md). The base package also has runnable
examples for
[executing a tool](https://johanneslatzel.github.io/llm-chat-tool/examples/executing-tools/),
[typed tools](https://johanneslatzel.github.io/llm-chat-tool/examples/typed-tools/),
[tool packages](https://johanneslatzel.github.io/llm-chat-tool/examples/tool-packages/),
and [timed tools](https://johanneslatzel.github.io/llm-chat-tool/examples/timed-tools/).

## Concrete tool packages

- [`llm-chat-file`](https://github.com/johanneslatzel/llm-chat-file): filesystem tools
- `llm-chat-workspace`: workspace and path-access management
- [`llm-chat-memory`](https://github.com/johanneslatzel/llm-chat-memory): memory with embeddings, links, and PageRank scoring
- `llm-chat-shell`: shell tool with a permission system
- [`llm-chat-time`](https://github.com/johanneslatzel/llm-chat-time): date/time, stopwatch, and timer tools
- [`llm-chat-web`](https://github.com/johanneslatzel/llm-chat-web): web search and fetch tools
- [`llm-chat-skill`](https://github.com/johanneslatzel/llm-chat-skill): skill loading tools

The [`llm-chat-mcp`](https://github.com/johanneslatzel/llm-chat-mcp) package
exposes these tools over the Model Context Protocol.

## Registration in this package

The engine owns the `ToolSuite` behind `service.tools()`. See
[ChatService](../services/chat-service.md) for the send loop and
[registration](https://johanneslatzel.github.io/llm-chat-tool/tools/registration/)
for the tool-side contract.
