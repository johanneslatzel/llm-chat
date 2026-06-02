# Interrupt

Tools that need to push events into the conversation flow (e.g. timer expiry) use `service.interrupt()`. It acquires the send mutex, runs a callback that can modify the chat, and optionally re-triggers (the internal) `_send()` — all under the same lock:

```ts
// automatically re-sends
service.interrupt(() => {
    service.chat().user('Timer "build" (30s) has expired.');
});

// Skip re-send:
service.interrupt(() => {
    service.chat().user('Timer "build" (30s) has expired.');
}, false);
```

If a `send()` is already in progress, the interrupt queues behind it via `async-mutex` and processes atomically once the current round finishes.
