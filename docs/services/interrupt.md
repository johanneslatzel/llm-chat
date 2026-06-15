# Interrupt

Abort any in-flight LLM request. Optionally signal that a re-send is needed.

```ts
// Fire-and-forget: abort without re-sending
service.interrupt();

// Abort and flag that a re-send is needed
service.interrupt(true);
```

## Re-sending

`interrupt(true)` sets a flag that causes the next `send()` call to automatically retry the request. The flag is reset once `send()` runs.

```ts
await service.queue().user('Timer "build" (30s) has expired.');
service.interrupt(true);
// later when ready:
await service.send(); // retries automatically
```

## How it works

`this._abortController?.abort()` fires immediately — the in-flight stream catches the `AbortError` and stops. No mutex is acquired during `interrupt()`.

When an abort occurs, a FinishChunk with `FinishReason.Aborted` is pushed to the stream so consumers can detect the interruption:

```ts
service.stream().hook().chunks(ChunkType.Finish).do((chunk) => {
    if (chunk.finishReason === FinishReason.Aborted) {
        // handle interrupt
    }
});
```

