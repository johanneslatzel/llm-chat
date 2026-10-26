# Inline tool calls

Some models put tool calls in ordinary content as explicit text, commonly
wrapped in `<tool_call>...</tool_call>`. `llm-chat` can parse those blocks and
feed them through the normal tool-call loop.

Inline tool-call parsing is **opt-in** and disabled by default. Tool calls can
have side effects, and the same marker text can be ordinary content for a
different model. Enable it only for models and prompts trusted to emit tool
calls in this format.

## Configuration

```typescript
import { ChatServiceConfiguration, OpenAIChatService } from "@johannes.latzel/llm-chat";

const config = new ChatServiceConfiguration();
config.parseInlineToolCalls = true;

// Optional. These are the defaults.
config.inlineToolCallMarkers = {
    open: "<tool_call>",
    close: "</tool_call>"
};

const service = OpenAIChatService.builder()
    .model("your-model")
    .withServiceConfig(config)
    .create();
```

| Property | Env var | Default | Description |
|----------|---------|---------|-------------|
| `parseInlineToolCalls` | `LLM_CHAT_PARSE_INLINE_TOOL_CALLS` | `false` | Parse explicit inline tool-call blocks in streamed content |
| `inlineToolCallMarkers` | — | `<tool_call>` / `</tool_call>` | Marker pair used when parsing is enabled |

This is independent of [`parseInlineReasoning`](inline-reasoning.md). Both can
be enabled together. Their opening markers must differ; an ambiguous
configuration throws when the request is sent.

## Accepted payloads

A block must contain JSON. The following shapes are supported:

| Shape | Example |
|-------|---------|
| Name + arguments | `{"name":"get_weather","arguments":{"city":"Berlin"}}` |
| Tool + parameters | `{"tool":"get_weather","parameters":{"city":"Berlin"}}` |
| Function wrapper | `{"function":{"name":"get_weather","arguments":{"city":"Berlin"}}}` |
| Array of calls | `[{"name":"first"},{"name":"second","arguments":{}}]` |

`arguments` / `parameters` may be an object or a JSON string representing an
object. When omitted, empty, or `null`, the arguments are `{}`. Other argument
types are rejected and the block remains content.

Each call is assigned a generated id. Any `id` supplied by the model is ignored,
so duplicate or malformed model ids cannot collide in the conversation history.

## Streaming and completion

A tool-call block is buffered until its closing marker is seen. Splitting the
opening marker, closing marker, or JSON payload across arbitrary chunks is
supported. Partial blocks are never executed.

Once at least one complete inline call has been parsed, a provider finish of
`stop` (or another non-aborted finish) is treated as `tool_calls` so the
existing tool loop runs and executes the call. An explicit provider
`tool_calls` finish is unchanged. `FinishReason.Aborted` is never overridden.

If a block is malformed, has an unsupported shape, is empty, or is still open at
end of stream, the original text remains ordinary content and no tool runs.

## Structured and inline calls together

Structured `delta.tool_calls` from the provider remain fully supported. If a
response contains both structured deltas and inline blocks, both sets are
executed in arrival order.

There is **no deduplication** between the two forms. If a provider emits the
same call both as `delta.tool_calls` and as `<tool_call>`, it will run twice.
Configure a provider to use one form.

Inline calls detected inside a reasoning block are reasoning text, not tool
calls. Text-based tool-call forms other than the configured marker pair are not
parsed.

## Trust warning

Inline tool calls are model-generated output. Enabling them lets model content
invoke registered tools. Treat the model and its prompt as trusted input for any
tool with side effects.
