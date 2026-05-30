# Environment Variables

Set these however you prefer (shell, `.env`, etc.). A `.env.example` is included.

## Connection

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | no | `""` | API key |
| `OPENAI_BASE_URL` | no | `https://api.openai.com/v1` | API endpoint (this is the OpenAI SDK default; when using a local server like LM Studio, set this to `http://localhost:1234/v1`) |
| `LLM_CHAT_OPENAI_DEFAULT_MODEL` | no | `""` | Fallback model name |

## OpenAI overrides (optional)

Read at `OpenAIChatService` construction:

| Variable | Description |
|----------|-------------|
| `LLM_CHAT_OPENAI_TEMPERATURE` | Sampling temperature (0–2) |
| `LLM_CHAT_OPENAI_MAX_TOKENS` | `max_tokens` |
| `LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS` | `max_completion_tokens` (o1/o3, takes precedence) |
| `LLM_CHAT_OPENAI_TOP_P` | Nucleus sampling |

## Chat Service

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_CHAT_MAX_TOOL_CALL_ROUNDS` | `10` | Max tool-call recursion depth |

## Prompts

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_CHAT_SYSTEM_PROMPT` | `""` | File path for system prompt |
| `LLM_CHAT_USER_PROMPTS` | `""` | Comma-separated file paths for initial user messages |
