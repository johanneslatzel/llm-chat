# Serialization

```typescript
const json = chat.toJSON();           // { sessionId, systemPrompt, messages }
const restored = chatFromJSON(json);  // restore (re-register hooks afterwards)
```

The `sessionId` is required in `ChatJSON` and is preserved across serialization round-trips. When deserializing legacy data that lacks a `sessionId`, a new UUID is generated.

The `systemPrompt` field stores the single system prompt. The `messages` array contains only non-system messages. The system prompt is **not** duplicated in both places.

## Timestamps

Every message has a `createdAt: Date` set automatically at creation time. When serialized:

- **`toJSON()`** — `createdAt` is an ISO 8601 string (e.g. `"2026-06-04T15:30:00.000Z"`)
- **`fromJSON()`** — the ISO string is restored back to a `Date` object

The system prompt (when present) also carries a `createdAt`.

Hooks are not serialized; re-register after `chatFromJSON()`.
