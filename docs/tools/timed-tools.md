# Timed tools

`TimedTool` wraps any `Tool` and bounds how long the caller waits for one
execution. It is a generic decorator: it only depends on core llm-chat types and
does not add a default timeout.

```typescript
import { OpenAIChatService, TimedTool } from '@johannes.latzel/llm-chat';

const service = OpenAIChatService.builder().create();
const runAbortController = new AbortController();

// MyTool stands for a Tool you have already defined.
const tool = new MyTool();

const registry = service.tools();
registry.add(
    new TimedTool(
        tool,
        30_000,
        (kind, message) => console.warn(kind, message),
        () => runAbortController.signal,
    ),
);
```

`MyTool` stands for a tool you have already defined; the sample does not define it.

## Constructor

```typescript
new TimedTool(
    inner: Tool,
    timeoutMs: number,
    notify?: (kind: TimedToolNotificationKind, message: string) => void,
    signal?: () => AbortSignal | undefined,
);
```

Only `inner` and `timeoutMs` are required.

- `timeoutMs` must be greater than 0. The constructor throws `RangeError` for
  zero, negative, `NaN`, or infinite values.
- `notify` is optional and defaults to a no-op. It receives
  `TimedToolNotificationKind.Timeout` or
  `TimedToolNotificationKind.Cancelled`; the wrapper does not log itself. An
  exception from the callback is ignored so the result still settles.
- `signal` is optional and defaults to a provider that returns `undefined`. It
  is called for each execution and may return `undefined`.

## Behavior

- `toOpenAI()` delegates to the wrapped tool.
- A normal execution returns the inner results in order, flattened into the
  `PartialToolResult` chain.
- A timeout returns an error result:
  `Error: Tool '<name>' timed out after <n> ms`.
- An already-aborted or mid-call abort returns an error result:
  `Error: Tool '<name>' was cancelled`.
- An inner rejection, including a non-Error rejection, becomes an error result.
- A late inner result after a timeout is ignored.
- Abort listeners are removed when the call settles.
- The timeout timer is unreferenced, so it does not keep the process alive on
  its own.

## Cancellation limits

The wrapper only bounds the **wait**. It cannot force the inner tool to stop.
A shell command, file write or network request may continue after a timeout or
abort; the wrapper resolves with an error and lets the send loop continue.
Callers that need hard cancellation must implement it inside the tool.

## See also

- [Timed tools example](../examples/timed-tools.md)
- [Defining tools](defining-tools.md)
- [Tool hooks](tool-hooks.md)
