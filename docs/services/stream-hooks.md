# Stream hooks

Stream hooks let you observe raw streaming output (content, reasoning, tool-call deltas, finish). They are accessed through `service.stream().hook()`.

```ts
// content chunks
service.stream().hook().chunks(ChunkType.Content).do((chunk) => {
    process.stdout.write(chunk.text);
});

// reasoning chunks
service.stream().hook().chunks(ChunkType.Reasoning).do((chunk) => {
    process.stdout.write(chunk.text);
});

// tool call delta chunks
service.stream().hook().chunks(ChunkType.ToolCallDelta).do((chunk) => {
    console.log(`Tool ${chunk.toolCallId}: ${chunk.text}`);
});

// finish event
service.stream().hook().chunks(ChunkType.Finish).do((chunk) => {
    console.log(`\nFinished: ${chunk.finishReason}`);
});

// all chunk types
service.stream().hook().chunks().do((chunk) => {
    console.log(chunk.type, chunk.seq, chunk.batch);
});
```

`.chunks()` is always required in the chain. Pass one or more `ChunkType` values to filter, or no arguments to receive every chunk.

Each returns a `Hook` — call `.dispose()` to unsubscribe.

## Chunk identity

Every chunk has two numeric fields:

- **`seq`** — position within the current batch (`0`, `1`, `2`…). Resets to `0` on each `send()`.
- **`batch`** — which `send()` cycle the chunk belongs to (`0` for the first `send()`, `1` for the second, etc.). Incremented automatically when the stream is cleared.

Use `batch` to distinguish chunks from separate `send()` calls when you accumulate them manually.

## Stream state

Access accumulated chunks and finish reason after `send()`:

```ts
await service.send();
const allChunks = service.stream().chunks();
const reason = service.stream().finishReason();
```

The stream state (chunks, seq, batch) is automatically cleared at the start
of each `send()` call. Chunk listeners are preserved across sends — hooks
registered on the stream survive multiple `send()` rounds within the same
conversation. To fully remove stream hooks, call `service.stream().clear()` or
`service.clear()`.

## Ordering guarantee

When the stream finishes, the `FinishChunk` is pushed to the stream (and stream hooks fire) **before** the completed message is appended to chat (and chat hooks fire). This means stream hooks see the finish before chat hooks see the resulting message.
