# Serialization

```ts
const json = chat.toJSON();           // { systemMessage, messages }
const restored = chatFromJSON(json);  // restore (re-register hooks afterwards)
```

The `systemMessage` field stores the single system prompt. The `messages` array contains only non-system messages — the system prompt is **not** duplicated in both places. `chat.messages()` synthesizes the full list by prepending `systemMessage` if set.

## Timestamps

Every message has a `createdAt: Date` set automatically at creation time. When serialized:

- **`toJSON()`** — `createdAt` is an ISO 8601 string (e.g. `"2026-06-04T15:30:00.000Z"`)
- **`fromJSON()`** — the ISO string is restored back to a `Date` object

The system prompt (when present) also carries a `createdAt`.

## Clearing

`chat.clear()` resets both the message list **and** the system prompt. After calling it, the chat is empty — `systemMessage` is `null` and `messages` is `[]`.

Hooks are not serialized — re-register after `chatFromJSON()`.
