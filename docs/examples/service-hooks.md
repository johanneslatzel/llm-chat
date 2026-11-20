# Service Hooks

Service hooks run around the send loop and its individual provider rounds. This
example retries a yes/no answer until it contains one of the accepted words, or
until three attempts have run.

```typescript
import { OpenAIChatService } from '@johannes.latzel/llm-chat';

const service = OpenAIChatService.builder()
    .systemPrompt('Answer yes/no questions with exactly one word: yes or no.')
    .create();

let attempts = 0;

service.hook()
    .beforeSendLoop()
    .do(() => console.error('[service] loop start'));

service.hook()
    .beforeSend()
    .do(() => {
        attempts += 1;
        console.error(`[service] attempt ${attempts}`);
    });

service.hook()
    .afterSend()
    .do(async () => {
        const answer = service.lastAssistantContent()?.trim().toLowerCase();
        if (answer === 'yes' || answer === 'no') return;
        if (attempts >= 3) return;

        await service.queue().user('Reply with exactly one word: yes or no.');
        service.setNeedsResend();
    });

service.hook()
    .afterSendLoop()
    .do(() => console.error(`[service] loop end after ${attempts} attempts`));

await service.chat().user('Is the sky blue?');
await service.send();
console.log(service.lastAssistantContent());
```

## What happens

- `beforeSendLoop` fires once per `send()`, before the retry loop.
- `beforeSend` fires once per provider round.
- `afterSend` validates the answer. A rejected answer queues a correction and
  calls `setNeedsResend()`, so the next loop iteration drains the queue and
  sends again.
- `afterSendLoop` fires once after the retry loop exits.
- The attempt cap stops the loop when the model never produces the target
  format.

## See also

- [Service hooks](../services/chat-service.md#service-hooks)
- [Interruption](interruption.md)
- [JSON hooks](json-hooks.md)
- [Hooks](hooks.md)
