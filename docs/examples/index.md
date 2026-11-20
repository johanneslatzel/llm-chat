# Examples

Standalone scripts for common llm-chat use cases. Most pages contain one
complete TypeScript program; the system prompt page collects independent
snippets, and structured output has separate schema and JSON-mode programs.

## Setup

The examples use Node.js 22 or newer and ESM. Run `npm install` once and set
the connection variables listed in [Environment Variables](../env.md).
`OPENAI_BASE_URL` accepts any OpenAI-compatible endpoint, and
`OpenAIChatService` throws when `LLM_CHAT_OPENAI_DEFAULT_MODEL` is unset.

Run each script with a TypeScript runner that supports ESM and top-level await.

## Basics

- [Quick start](quick-start.md): send one message and stream the reply.
- [Interactive chat](interactive-chat.md): a readline loop with session commands.
- [System prompts](system-prompts.md): flat strings, files, directories, and prompt trees.

## Tools and agents

- [Tool calling](tool-calling.md): an HTTP tool with validation and an error result.
- [Typed tools](typed-tools.md): nested objects, arrays, hidden aliases, and multiple results.
- [Tool packages](tool-packages.md): group related tools and publish a tutorial in the system prompt.
- [Timed tools](timed-tools.md): bound a tool call with a timeout and cancellation signal.
- [Agent loop](agent-loop.md): continue until a tool confirms the answer, with a round cap.
- [Structured output](structured-output.md): request JSON or a JSON Schema with `response_format`.

## Runtime control

- [Hooks](hooks.md): observe streams, messages, tools, and the send loop.
- [Service hooks](service-hooks.md): inject messages and retry from the send loop.
- [JSON hooks](json-hooks.md): declarative retries and logging from `.json` files.
- [Reasoning streams](reasoning.md): separate reasoning from the final answer.
- [Interruption](interruption.md): abort a request and resend with a correction.
- [Usage and cost](usage-and-cost.md): collect token usage and estimate request cost.
- [Context management](context-management.md): estimate context size and compact history.

## Sessions and operations

- [Persistence](persistence.md): save a transcript and resume it in a new process.
- [Local endpoints](local-endpoints.md): LM Studio, Ollama, and other compatible servers.
- [Testing](testing.md): run a deterministic tool-call flow without a network.

## See also

- [Chats](../chats/index.md)
- [Services](../services/index.md)
- [Tools](../tools/index.md)
- [Hooks](../hooks/index.md)
