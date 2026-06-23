# OpenAIChatService

Works with any OpenAI-compatible API (OpenAI, LM Studio, etc.). Reasoning messages are stored locally but filtered out when sent to the API.

```ts
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

## Timestamp prefix

Set `OpenAIChatServiceConfiguration.prefixWithTimestamp` to prepend each message's `createdAt` timestamp (local-timezone ISO 8601) to its content when sent to the API:

```ts
const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.prefixWithTimestamp = true;
// each message is sent as: "2026-06-04T17:04:35.000+01:00: Hello"

const service = new OpenAIChatService(api, openAIConfig);
```

Useful for giving the model temporal context about when each message was created.

## Developer role

For o-series models (o1, o3), OpenAI recommends using the `developer` role instead of `system` for better instruction adherence. Set `useDeveloperRole: true` to automatically map the system prompt to the `developer` role:

```ts
const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.useDeveloperRole = true;
// The system prompt is sent as { role: "developer" } instead of { role: "system" }

const service = new OpenAIChatService(api, openAIConfig);
```

There are no dedicated `developer()` methods on `chat` or `queue`, just as there are no `system()` methods. The system prompt is automatically converted when `useDeveloperRole` is enabled.

## Flat system prompt

Set `ChatServiceConfiguration.systemPrompt` to bypass the prompt tree entirely and send a single flat string:

```ts
const config = new ChatServiceConfiguration();
config.systemPrompt = "You are a helpful assistant.";

const service = new OpenAIChatService(api, openAIConfig, config);
// sends: { role: "system", content: "You are a helpful assistant." }
```

When set, `chat.getSystem()` and all file-based prompts are ignored. This also composes with `useDeveloperRole`:

## Reasoning effort

Control how much reasoning the model performs (o-series models only). Uses the `ReasoningEffort` enum:

```ts
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
(`filterReasoning`) is unaffected — it controls what is **sent** to the API,
not what is received from it.

## Tool choice

Control whether the model should call tools. Uses the `ToolChoice` enum:

```ts
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

```ts
import { Verbosity } from "@johannes.latzel/llm-chat";

const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.verbosity = Verbosity.High;
```

| Value | Description |
|-------|-------------|
| `Verbosity.Low` | Concise responses |
| `Verbosity.Medium` | Balanced responses |
| `Verbosity.High` | Detailed responses |
