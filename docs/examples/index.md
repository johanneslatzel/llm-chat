# Examples

Standalone scripts for common llm-chat use cases. Most pages contain one
TypeScript program; the system prompt page collects independent snippets.

## Setup

The examples use Node.js 22 or newer and ESM. Install the engine and the tool
primitives once:

```bash
npm install @johannes.latzel/llm-chat @johannes.latzel/llm-chat-message @johannes.latzel/llm-chat-tool
```

This package ships no provider. Install the OpenAI provider package
[`@johannes.latzel/llm-chat-openai`](https://johanneslatzel.github.io/llm-chat-openai/),
or subclass `ChatService` yourself. Most examples stay provider-neutral and
declare a `service: ChatService` value instead of constructing a concrete
service; [Quick start](quick-start.md) constructs `OpenAIChatService`. See
[Adding a new provider](../services/custom-provider.md) for a skeleton
implementation.

Each example imports from the package that owns the symbol: engine types from
`@johannes.latzel/llm-chat`, messages and roles from
`@johannes.latzel/llm-chat-message`, and tools, results and tool hooks from
`@johannes.latzel/llm-chat-tool`. Nothing is re-exported by the engine.

Set the generic `LLM_CHAT_*` variables listed in
[Environment variables](../env.md). Model names, credentials and transport are
provider configuration.

The examples are ESM modules and use top-level await. Run a script with a
TypeScript runner such as `tsx`:

```bash
npx tsx example.ts
```

## Basics

- [Quick start](quick-start.md): send one message and stream the reply.
- [Interactive chat](interactive-chat.md): a readline loop with session commands.
- [System prompts](system-prompts.md): flat strings, files, directories, and prompt trees.

## Tools

- [Tool calling](tool-calling.md): let the model call a registered tool and feed the result back.

## Agents and runtime control

- [Agent loop](agent-loop.md): continue until a tool confirms the answer, with a round cap.
- [Hooks](hooks.md): observe streams, messages, tools, and the send loop.
- [Service hooks](service-hooks.md): inject messages and retry from the send loop.
- [JSON hooks](json-hooks.md): declarative retries and logging from `.json` files.
- [Interruption](interruption.md): abort a request and resend with a correction.
- [Context management](context-management.md): estimate context size and compact history.

## Sessions and operations

- [Persistence](persistence.md): save a transcript and resume it in a new process.
- [Testing](testing.md): run a deterministic tool-call flow without a network.

## Moved to another package

Tool-focused examples and guides now live in `@johannes.latzel/llm-chat-tool`:

- [Executing a tool](https://johanneslatzel.github.io/llm-chat-tool/examples/executing-tools/)
- [Typed tools](https://johanneslatzel.github.io/llm-chat-tool/examples/typed-tools/)
- [Tool packages](https://johanneslatzel.github.io/llm-chat-tool/examples/tool-packages/)
- [Timed tools](https://johanneslatzel.github.io/llm-chat-tool/examples/timed-tools/)

## See also

- [Chats](../chats/index.md)
- [Services](../services/index.md)
- [Tools](../tools/index.md)
- [Hooks](../hooks/index.md)
