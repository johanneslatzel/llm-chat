# Tool packages

Group related tools into a `ToolPackage` for batch registration:

```ts
import { ToolPackage, Tool } from "@johannes.latzel/llm-chat";

class GreetTool extends Tool { /* ... */ }
class WeatherTool extends Tool { /* ... */ }

class WeatherPackage extends ToolPackage {
    constructor() {
        super([new GreetTool(), new WeatherTool()]);
    }
}
```

Register with the same `add()` call used for single tools:

```ts
service.tools().add(new WeatherPackage());
```

### Tutorial

Override `tutorial()` to return a usage string, or leave it as `null` (default):

```ts
class WeatherPackage extends ToolPackage {
    constructor() {
        super([new GreetTool(), new WeatherTool()]);
    }

    tutorial(): string | null {
        return "Use greet to say hello and weather to check conditions.";
    }
}
```

When the `ToolSuite` is wired to a `ChatService`, it automatically populates the
`tutorials` container in the system prompt tree for every registered package
that has tutorial content. Each package becomes a sub-container titled
`Tool Package <ClassName>` with two children:

- **Applicability** — comma-separated list of tool names
- **Tutorial** — the value returned by `tutorial()`

The resulting system prompt looks like:

```
tutorials
    Tool Package WeatherPackage
        Applicability
            greet, weather
        Tutorial
            Use greet to say hello and weather to check conditions.
```

If `tutorial()` returns `null`, no entry is created.

### Adding tools after construction

Use the protected `add(tool)` method:

```ts
class WeatherPackage extends ToolPackage {
    constructor() {
        super();
        this.add(new GreetTool());
        this.add(new WeatherTool());
    }
}
```

Duplicates throw — a tool name must be unique across all registered tools and packages.

### Managing tutorials

The `ToolSuite` interface exposes `clear()` and `rebuildTutorials()`.

`clear()` removes all registered tools, packages, and tool event listeners
from the suite. It does not affect the tutorial container reference. Pass
`retainHooks: true` to preserve tool event listeners across the reset.

`rebuildTutorials()` re-creates tutorial entries from the currently registered
packages into the tutorial container. Call it after `service.resetTutorials()`
has re-wired the container to a fresh system prompt tree (see
[ChatService](../services/chat-service.md)).
