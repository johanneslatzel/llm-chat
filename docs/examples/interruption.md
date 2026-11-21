# Interruption

`service.interrupt(true)` aborts the in-flight request and marks it for a retry.
Messages queued before the interrupt are included in the retry.

This example starts a long answer, waits 1.5 seconds, then replaces the request
with a shorter instruction.

```typescript
import { ChunkType, type ChatService } from '@johannes.latzel/llm-chat';
import { FinishReason } from '@johannes.latzel/llm-chat-message';

// Supply a ChatService from a provider package, or subclass ChatService.
declare const service: ChatService;

service.chat()
    .system()
    .child('general')
    .prompt('rules')
    .setContent('Follow the latest instruction.');

service.stream()
    .hook()
    .chunks(ChunkType.Content)
    .do((chunk) => process.stdout.write(chunk.text));

service.stream()
    .hook()
    .chunks(ChunkType.Finish)
    .do((chunk) => {
        if (chunk.finishReason === FinishReason.Aborted) {
            console.error('\n[aborted] request stopped');
        }
    });

let finished = false;

const timer = setTimeout(() => {
    if (finished) return;

    void (async () => {
        await service.queue().user(
            'Stop the essay. Reply with one sentence instead.'
        );
        service.interrupt(true);
    })();
}, 1_500);

try {
    await service.chat().user(
        'Write a 1,000-word essay about the history of the printing press.'
    );
    await service.send();
} finally {
    finished = true;
    clearTimeout(timer);
}

process.stdout.write('\n');
```

## How the retry works

1. `queue().user()` stages a message without touching the active request.
2. `interrupt(true)` aborts the stream and sets the resend flag.
3. `send()` drains the queue at the start of the next iteration and sends the
   original history plus the queued message.
4. The aborted partial response is not added to the chat history. The retry
   response is.

`interrupt()` without the argument aborts the request without a retry. A
`FinishReason.Aborted` chunk is still emitted.

## See also

- [Interrupt](../services/interrupt.md)
- [Message queue](../services/chat-service.md#message-queue)
- [Service hooks](../services/chat-service.md#service-hooks)
