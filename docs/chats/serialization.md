# Serialization

```ts
const json = chat.toJSON();           // { systemMessage, messages }
const restored = chatFromJSON(json);  // restore (re-register hooks afterwards)
```

Hooks are not serialized — re-register after `chatFromJSON()`.
