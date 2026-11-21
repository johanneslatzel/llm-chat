# Environment variables

Set these in the shell, a `.env` file, or the process environment. A `.env.example` is included.

Provider credentials and model settings live in `@johannes.latzel/llm-chat-openai`;
see the [provider environment variables](https://johanneslatzel.github.io/llm-chat-openai/env/).

## Chat service

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LLM_CHAT_MAX_TOOL_CALL_ROUNDS` | `number` | `10` | Max tool-call recursion depth |
| `LLM_CHAT_PARSE_INLINE_REASONING` | `boolean` | `false` | Parse explicit inline reasoning markers in streamed content; see [Inline reasoning](services/inline-reasoning.md) |
| `LLM_CHAT_PARSE_INLINE_TOOL_CALLS` | `boolean` | `false` | Parse explicit inline tool-call blocks in streamed content; see [Inline tool calls](services/inline-tool-calls.md) |
| `LLM_CHAT_CONTEXT_WINDOW_SIZE_HINT` | `number` | `0` | Context window size hint in tokens (`0` = unlimited). Used by `isContextWindowExceeded()` |

## Prompts

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LLM_CHAT_SYSTEM_PROMPT` | `string` | unset | Inline flat system prompt; wins over the file and directory sources |
| `LLM_CHAT_SYSTEM_PROMPT_DIR` | `string` | `./prompts/` | Directory containing `.md` and `.txt` system prompt files; each file becomes a component under `general`. Read only if it exists; never created |
| `LLM_CHAT_SYSTEM_PROMPT_FILE` | `string` | unset | Path to a single `.md` or `.txt` file used as the flat system prompt; takes precedence over `LLM_CHAT_SYSTEM_PROMPT_DIR` |
| `LLM_CHAT_USER_PROMPTS` | `path list` | `""` | Comma-separated file paths for initial user messages; an empty value produces an empty list |

Setting `systemPromptDir = ''` disables prompt-directory loading; the default is
`./prompts/`.

## JSON hooks

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LLM_CHAT_HOOKS_DIR` | `string` | none | Directory containing `.json` hook definition files (auto-loaded on init/send) |
