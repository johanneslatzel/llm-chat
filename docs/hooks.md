# Hooks

React to chat messages and tool lifecycle events. All chat observation goes through hooks — there are no raw event listeners in the public API.

## Chat hooks

Accessed via `chat.hook()` which returns a `HookBuilder`.

### Message hooks

Subscribe to messages that match a role and/or regex:

```ts
import { ChatRole } from "llm-chat";

const hook = chat.hook()
    .message(ChatRole.User)          // optional: filter by role(s)
    .regex(/hello/i)                 // optional: filter by regex
    .maxTriggers(1)                  // default: Infinity
    .do((message, matches) => {
        console.log("Matched:", message.content);
        // matches — RegExpExecArray with capture groups
    });
```

| `roles` | `regex` | Behavior |
|---------|---------|----------|
| unset | unset | Nothing matches |
| set | unset | Matches any message with that role |
| unset | set | Matches any message matching the regex |
| set | set | Matches only if role AND regex match |

Pass multiple roles: `.message(ChatRole.User, ChatRole.Assistant)`.

### Stream hooks

Observe streaming output without role/regex matching:

```ts
chat.hook().chunk((_, text) => process.stdout.write(text));
chat.hook().reasoning((_, text) => process.stdout.write(text));
chat.hook().finish((_, reason) => console.log("Finished:", reason));
```

Stream hooks fire on every event with no filtering or limit.

## Tool hooks

Tool hooks retain the config-object style:

```ts
const suite = new ToolSuite();

suite.before({}, (name, args) => console.log(`${name} →`, args));
suite.after(  {}, (result) => console.log(`${result.tool}: ${result.result}`));
suite.error(  {}, (name, error) => console.error(`${name} failed:`, error));
```

Each returns a `Hook` — call `.dispose()` to unsubscribe. Filter by tool name with the optional `tools` field (e.g. `{ tools: ["greet", "weather"] }`).

## Disposal

```ts
hook.dispose();  // unsubscribes — safe to call multiple times
```

## Interrupt

Tools that need to push events into the conversation flow (e.g. timer expiry) use `service.interrupt()`. It acquires the send mutex, runs a callback that can modify the chat, and optionally re-triggers `_send()` — all under the same lock:

```ts
service.interrupt(() => {
    service.chat().user('Timer "build" (30s) has expired.');
});
// sendAfter defaults to true → auto-sends

// Skip re-send:
service.interrupt(() => {
    service.chat().system('Timer module is active.');
}, false);
```

If a `send()` is already in progress, the interrupt queues behind it via `async-mutex` and processes atomically once the current round finishes.

## Notes

- Hooks are **not serialized** — re-register after `chatFromJSON()`
- Async handlers are fire-and-forget (not awaited)
- `MessageHook` defaults `maxTriggers` to `Infinity` — use `.maxTriggers(n)` to limit
