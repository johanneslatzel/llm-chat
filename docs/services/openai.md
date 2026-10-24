# OpenAIChatService

Works with any OpenAI-compatible API (OpenAI, LM Studio, etc.). Reasoning messages are stored locally but filtered out when sent to the API. Structured reasoning fields are recognised automatically; inline markers in content are parsed only when `ChatServiceConfiguration.parseInlineReasoning` is enabled.

```typescript
const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.model = "some-model";
openAIConfig.temperature = 0.3;
openAIConfig.maxTokens = 2048;
openAIConfig.stop = ["\n\n"];
openAIConfig.topP = 0.9;

const service = new OpenAIChatService(api, openAIConfig, config);
const chat = service.chat();
await service.send();
```

## Configuration reference

| Property | Type | Env var | Description |
|----------|------|---------|-------------|
| `model` | `string` | `LLM_CHAT_OPENAI_DEFAULT_MODEL` | Model name |
| `temperature` | `number` | `LLM_CHAT_OPENAI_TEMPERATURE` | Sampling temperature (0–2) |
| `maxTokens` | `number` | `LLM_CHAT_OPENAI_MAX_TOKENS` | Max output tokens (`max_tokens`) |
| `maxCompletionTokens` | `number` | `LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS` | Max completion tokens (`max_completion_tokens`, takes precedence over `maxTokens`) |
| `stop` | `string \| string[]` | — | Stop sequences |
| `topP` | `number` | `LLM_CHAT_OPENAI_TOP_P` | Nucleus sampling |
| `filterReasoning` | `boolean` | — | Filter reasoning messages before sending (default: `true`) |
| `prefixWithTimestamp` | `boolean` | — | Prepend each message with a local ISO timestamp (default: `false`) |
| `useDeveloperRole` | `boolean` | — | Send system prompt with `developer` role instead of `system` (default: `false`) |
| `reasoningEffort` | `ReasoningEffort` | `LLM_CHAT_OPENAI_REASONING_EFFORT` | Reasoning effort for o-series models |
| `toolChoice` | `ToolChoice` | `LLM_CHAT_OPENAI_TOOL_CHOICE` | Control whether the model calls tools |
| `verbosity` | `Verbosity` | `LLM_CHAT_OPENAI_VERBOSITY` | Verbosity level (passed through to providers that support it) |
| `includeUsage` | `boolean` | `LLM_CHAT_OPENAI_INCLUDE_USAGE` | Request streamed token usage via `stream_options.include_usage` (default: `false`) |

## Timestamp prefix

Set `OpenAIChatServiceConfiguration.prefixWithTimestamp` to prepend each message's `createdAt` timestamp (local-timezone ISO 8601) to its content when sent to the API:

```typescript
const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.prefixWithTimestamp = true;
// each message is sent as: "2026-06-04T17:04:35.000+01:00: Hello"

const service = new OpenAIChatService(api, openAIConfig);
```

Useful for giving the model temporal context about when each message was created.

## Developer role

For o-series models (o1, o3), OpenAI recommends using the `developer` role instead of `system` for better instruction adherence. Set `useDeveloperRole: true` to automatically map the system prompt to the `developer` role:

```typescript
const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.useDeveloperRole = true;
// The system prompt is sent as { role: "developer" } instead of { role: "system" }

const service = new OpenAIChatService(api, openAIConfig);
```

There are no dedicated `developer()` or `system()` message methods on `chat` or `queue`; the system prompt tree is accessed via `chat.system()`, and it is automatically converted to the `developer` role when `useDeveloperRole` is enabled.

## Flat system prompt

Set `ChatServiceConfiguration.systemPrompt` to bypass the prompt tree entirely and send a single flat string:

```typescript
const config = new ChatServiceConfiguration();
config.systemPrompt = "You are a helpful assistant.";

const service = new OpenAIChatService(api, openAIConfig, config);
// sends: { role: "system", content: "You are a helpful assistant." }
```

While set, file-based system prompts are not loaded, `chat.getSystem()` returns the flat string, and it is sent instead of the prompt tree. When `useDeveloperRole` is enabled, the flat system prompt is sent with the `developer` role.

## Token usage

Streamed token usage is opt-in because some OpenAI-compatible servers reject the
`stream_options` parameter. Enable it to send
`stream_options: { include_usage: true }` and receive the final usage-only chunk:

```typescript
const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.includeUsage = true;
openAIConfig.model = "some-model";

const service = new OpenAIChatService(api, openAIConfig, config);

// One StreamSummary is recorded per provider round, and summaries accumulate
// across send() calls. Clear them to isolate the next request.
service.stream().clearSummaries();

await service.send();

const summaries = service.stream().summary();
// Most recent round:
const lastUsage = summaries.at(-1)?.usage;
// Total across all rounds of this request:
const totalTokens = summaries.reduce((sum, s) => sum + (s.usage?.total_tokens ?? 0), 0);
// lastUsage?.prompt_tokens
// lastUsage?.completion_tokens
// lastUsage?.prompt_tokens_details?.cached_tokens
// lastUsage?.completion_tokens_details?.reasoning_tokens
```

`OpenAIChatService` emits a `StreamEventType.Usage` event before the final
`StreamEventType.Finish` event of each provider round, and records that round's
usage on its `StreamSummary`. The same value also arrives as a `ChunkType.Usage`
chunk before the `ChunkType.Finish` chunk. A summary's `usage` is `undefined`
when the server did not send usage.

## Reasoning effort

Control how much reasoning the model performs (o-series models only). Uses the `ReasoningEffort` enum:

```typescript
import { ReasoningEffort } from "@johannes.latzel/llm-chat";

const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.reasoningEffort = ReasoningEffort.High;
```

| Value | Description |
|-------|-------------|
| `ReasoningEffort.None` | No reasoning |
| `ReasoningEffort.Minimal` | Minimal reasoning |
| `ReasoningEffort.Low` | Low reasoning |
| `ReasoningEffort.Medium` | Medium reasoning |
| `ReasoningEffort.High` | High reasoning |
| `ReasoningEffort.XHigh` | Maximum reasoning |

## Reasoning extraction

When streaming responses, `OpenAIChatService` extracts reasoning from the delta
chunks using whichever field the provider populates. Three field shapes are
supported, checked in priority order:

| Priority | Field | Shape | Providers |
|----------|-------|-------|-----------|
| 1 | `reasoning_details` | `[{type, text, ...}]` array | OpenRouter / Anthropic (Claude thinking blocks) |
| 2 | `reasoning` | string | Ollama and other non-OpenAI providers |
| 3 | `reasoning_content` | string | Native OpenAI extension, DeepSeek, vLLM, and most OpenAI-compatible providers |

When both `reasoning_details` and a flat string field appear in the same chunk
(some OpenRouter routes), the structured array takes priority to avoid
duplicate emission.

Extracted reasoning is yielded as `StreamEventType.Reasoning` events, which
feed into `ReasoningChunk` objects in the stream and are accumulated into
`StreamSummary.reasoning`. The original `ChatRole.Reasoning` message filtering
(`filterReasoning`) is unaffected; it controls what is **sent** to the API,
not what is received from it.

Reasoning that arrives inline in `delta.content` is not extracted by
`OpenAIChatService` itself. Enable `ChatServiceConfiguration.parseInlineReasoning`
to normalise explicit markers such as `<think>...</think>` through the shared
`ChatService` layer. See [Inline reasoning](inline-reasoning.md). Structured
fields continue to work whether or not that option is enabled. If a provider
populates both structured fields and inline markers, both channels are preserved
in arrival order; the library does not attempt heuristic deduplication.

Tool calls normally arrive as structured `delta.tool_calls` and are executed
unchanged. To parse explicit `<tool_call>` blocks embedded in content, enable
`ChatServiceConfiguration.parseInlineToolCalls`; see
[Inline tool calls](inline-tool-calls.md). Structured and inline calls can
coexist, but they are not deduplicated.

## Tool choice

Control whether the model should call tools. Uses the `ToolChoice` enum:

```typescript
import { ToolChoice } from "@johannes.latzel/llm-chat";

const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.toolChoice = ToolChoice.Required;
// Forces the model to call one or more tools
```

| Value | Description |
|-------|-------------|
| `ToolChoice.None` | The model must not call tools |
| `ToolChoice.Auto` | The model decides whether to call tools (default) |
| `ToolChoice.Required` | The model must call one or more tools |

## Verbosity

Some providers support a verbosity parameter to control response detail:

```typescript
import { Verbosity } from "@johannes.latzel/llm-chat";

const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.verbosity = Verbosity.High;
```

| Value | Description |
|-------|-------------|
| `Verbosity.Low` | Concise responses |
| `Verbosity.Medium` | Balanced responses |
| `Verbosity.High` | Detailed responses |
