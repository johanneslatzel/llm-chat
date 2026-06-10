# Tool packages

Group related tools into a `ToolPackage` for batch registration:

```ts
import { ToolPackage, Tool } from "@johannes.latzel/llm-chat";

class GreetTool extends Tool { /* ... */ }
class WeatherTool extends Tool { /* ... */ }

class MyPackage implements ToolPackage {
    tools(): Tool[] {
        return [new GreetTool(), new WeatherTool()];
    }
}
```

Register with the same `add()` call used for single tools:

```ts
service.tools().add(new MyPackage());
```

### Dispose

Use the optional `dispose()` method for cleanup (e.g., closing connections, removing files):

```ts
class MyPackage implements ToolPackage {
    private server?: http.Server;

    tools(): Tool[] {
        return [/* ... */];
    }

    dispose(): void {
        this.server?.close();
    }
}
```

Duplicates throw — a tool name must be unique across all registered tools and packages.
