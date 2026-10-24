# Inline reasoning

Some OpenAI-compatible servers return reasoning in structured fields such as
`reasoning_content`. Others leave the reasoning inside ordinary content,
wrapped in explicit markers such as `<think>...</think>`. `llm-chat` supports
both shapes.

Structured fields are recognised automatically by [`OpenAIChatService`](openai.md).
Inline markers are **opt-in** because the same text can be ordinary content for
one model and reasoning for another.

## Configuration

Inline parsing lives on `ChatServiceConfiguration`, so it works for every
provider, not only the OpenAI implementation.

```typescript
import { ChatServiceConfiguration } from "@johannes.latzel/llm-chat";

const config = new ChatServiceConfiguration();
config.parseInlineReasoning = true;

// Optional. These are the defaults.
config.inlineReasoningMarkers = {
    open: "<think>",
    close: "</think>"
};
```

| Property | Env var | Default | Description |
|----------|---------|---------|-------------|
| `parseInlineReasoning` | `LLM_CHAT_PARSE_INLINE_REASONING` | `false` | Parse explicit inline markers in streamed content |
| `inlineReasoningMarkers` | — | `<think>` / `</think>` | Marker pair used when parsing is enabled |

Markers are configured programmatically because they are a pair. Only explicit,
matched pairs are recognised. A closing marker without a preceding opening
marker is treated as ordinary content. A model or template that opens the
reasoning block in the prompt and emits only `</think>` is therefore **not**
auto-detected; its reasoning remains content.

The `filterReasoning` option on `OpenAIChatServiceConfiguration` is separate: it
controls which stored reasoning messages are sent back to the API. It does not
control inbound parsing.

## Stream, summary and history

When parsing is enabled:

- matching reasoning text becomes `ChunkType.Reasoning` chunks and
  `StreamSummary.reasoning`;
- ordinary text remains `ChunkType.Content` chunks and
  `StreamSummary.content`;
- structured reasoning fields continue to work exactly as before;
- multiple reasoning blocks are emitted in stream order;
- the final `ChatRole.Reasoning` message contains the reasoning for that
  provider round, and the assistant message contains only ordinary content.

Live chunks preserve the boundaries between reasoning blocks. The summary and
chat history concatenate reasoning for a provider round into one string, so
block boundaries are not represented there.

A response containing only reasoning produces a reasoning message and no empty
assistant message. A response containing only content is unchanged.

### Structured and inline channels together

Structured reasoning and inline reasoning are independent channels. If a
provider populates both, both are preserved in arrival order. The library does
**not** attempt heuristic deduplication: streaming cannot reliably decide
whether two strings are semantically the same reasoning. If a provider sends the
same text through both channels, that duplication is preserved.

For a given provider, prefer the channel it actually uses. Enable inline parsing
for servers that put markers in content; leave it disabled for servers that
already populate structured reasoning fields.

## Marker semantics

| Input | Result |
|-------|--------|
| `<think>a</think>` | reasoning `a` |
| `a<think>b</think>c` | content `a`, reasoning `b`, content `c` |
| `<think></think>` | no reasoning segment |
| `<think>a</think><think>b</think>` | reasoning `a`, reasoning `b` |
| `<thi` at end of stream | content `<thi` |
| `<think>abc` at end of stream | reasoning `abc` |
| `a</think>b` | content `a</think>b` |
| `<think>a<think>b</think>c` | reasoning `a<think>b`, content `c` |

Markers split across chunks are handled, including one-character chunks. The
parser holds back only a suffix that could still become the active marker, so
ordinary content is not delayed unnecessarily.

Parsing is delimiter-based, not Markdown-aware. When enabled, marker text inside
code blocks or quoted examples is parsed just like any other content.

## Completion, cancellation and errors

The parser is flushed deterministically:

- before a provider's `Finish` event is processed;
- when the stream ends without an explicit finish;
- when the request is cancelled;
- before a stream error is rethrown.

On cancellation, the flushed partial text is included in the aborted
`StreamSummary`, but no chat messages are committed, matching the existing
interrupt behavior. On a non-abort error, already-flushed chunks remain visible
and the error propagates; no summary or chat messages are committed.

Each provider round gets a fresh parser, so buffered state cannot leak into the
next provider round or the next `send()` call.

## Related

- [Inline tool calls](inline-tool-calls.md): opt-in parsing of explicit `<tool_call>` blocks in content.

## Trust warning

Reasoning text is model-generated output. Treat it as untrusted model content,
not as a verified explanation, a source of truth, or instructions to follow.
