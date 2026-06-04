# Chat hooks

All observation is done through hooks returned by `chat.hook()`.

## Message hooks

Subscribe to messages matching a role and/or regex:

```ts
chat.hook()
    .message(ChatRole.User)              // optional: filter by role(s)
    .regex(/hello/i)                     // optional: filter by regex
    .maxTriggers(3)                      // default: Infinity
    .do((message, matches) => {
        console.log(message.content);
        console.log(matches[0]);    // full match
    });
```

| roles | regex | Behavior |
|-------|-------|----------|
| unset | unset | Nothing matches |
| set | unset | Matches any message with that role |
| unset | set | Matches any message matching the regex |
| set | set | Matches only if role AND regex match |

`message()` accepts multiple roles: `.message(ChatRole.User, ChatRole.Assistant)`.

## Disposal

```ts
const hook = chat.hook().message(ChatRole.User).do(cb);
hook.dispose();  // safe to call multiple times
```

## Notes

- Hooks are **not serialized** — re-register after `chatFromJSON()`
- Async handlers are fire-and-forget (not awaited)
- `MessageHook` defaults `maxTriggers` to `Infinity`
