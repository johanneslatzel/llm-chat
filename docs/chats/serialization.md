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

`chat.clear()` removes all conversation messages, clears the system prompt
tree, and unregisters message hook listeners. After calling it, `getSystem()`
returns `null` and `messages()` is empty. The system prompt container is
cleared in-place (children removed, title reset). Pass `retainHooks: true`
to preserve hooks. If tool tutorials were registered, call
`service.resetTutorials()` afterwards to re-populate them.

Hooks are not serialized — re-register after `chatFromJSON()`.
