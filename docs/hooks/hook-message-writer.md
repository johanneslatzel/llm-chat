# HookMessageWriter

## Background

`Chat` hardcodes message origin per method (`user()` → `User`, `assistant()` → `Model`, etc.).
Hooks that queue messages via the `queue-message` action need to set `origin: Hook`.

## Interfaces

Two separate interfaces keep the concerns apart:

- **`MessageWriter`** — clean interface without origin params. Used by `Chat` and the public `service.queue()` API.
- **`HookMessageWriter`** — same methods but with a required `origin` param. Used internally by hooks.

`MessageQueue` implements both. Each method accepts an optional `origin`: when called via `MessageWriter` the caller omits it (default `User`/`Tool`), when called via `HookMessageWriter` the caller passes it explicitly (e.g. `ChatMessageOrigin.Hook`).

## Wiring

`JsonHookRegistry` receives a `HookMessageWriter` and a `JsonHookControls` object via constructor injection:

```typescript
constructor(
    private _hookWriter?: HookMessageWriter,
    private _controls?: JsonHookControls
)
```

`ChatService` passes `this._messageQueue` (as `HookMessageWriter`) and `this` (as `JsonHookControls`).

`JsonHookControls` is a minimal interface replacing the old `JsonHookService`:

```typescript
export interface JsonHookControls {
    setNeedsResend(): void;
    interrupt(needsResend?: boolean): void;
}
```

## ChatMessageOrigin

Every `ChatMessage` carries a required `origin` field:

| Value | Source |
|-------|--------|
| `User` | `chat.user()`, `queue().user()` |
| `Model` | `chat.assistant()`, `chat.reasoning()` |
| `Tool` | `chat.tool()`, `queue().tool()` |
| `Hook` | Hook `queue-message` action |
| `System` | System prompt via `chat.getSystem()` |

## Files

| File | Role |
|------|------|
| `src/chats/chat.ts` | `MessageWriter`, `HookMessageWriter`, `ChatMessageOrigin`, `ChatMessage.origin` |
| `src/chats/queue.ts` | `MessageQueue` implements both writer interfaces |
| `src/hooks/json-hooks.ts` | `JsonHookControls`, `JsonHookRegistry` accepts hook writer + controls |
| `src/chats/service.ts` | `ChatService` implements `JsonHookControls`, wires `MessageQueue` to registry |
| `src/index.ts` | Public API exports (does NOT re-export hook-internal types) |
