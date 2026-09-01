import { ChatService, ChatServiceConfiguration, Tool, ToolParameters, ResultStatus, type PartialToolResult } from '../../src/index.js';
import { StreamEvent, StreamEventType } from '../../src/service/service.js';

/** ChatService whose createStream replays a fixed list of stream events. */
export class TestChatService extends ChatService {
    private events: StreamEvent[];
    private index = 0;

    constructor(
        events: StreamEvent[],
        config?: ChatServiceConfiguration
    ) {
        if (!config) {
            config = new ChatServiceConfiguration();
            config.systemPromptDir = '';
        }
        super(config);
        this.events = events;
    }

    protected async *createStream(_signal?: AbortSignal): AsyncIterable<StreamEvent> {
        while (this.index < this.events.length) {
            yield this.events[this.index++]!;
        }
    }
}

/** Tool returning a fixed string result. */
export class SimpleTestTool extends Tool {
    private result: string;

    constructor(name: string, result: string) {
        super(name, 'Test tool', new ToolParameters({}));
        this.result = result;
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return { result: this.result, status: ResultStatus.Success };
    }
}

/** Tool that throws an Error on execution. */
export class FailingTestTool extends Tool {
    constructor() {
        super('failing_tool', 'A tool that fails', new ToolParameters({}));
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        throw new Error('Tool execution failed');
    }
}

/** Tool that throws a non-Error value on execution. */
export class ThrowsStringTestTool extends Tool {
    constructor() {
        super('throws_string_tool', 'A tool that throws a string', new ToolParameters({}));
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        throw 'Non-error throw value';
    }
}

export { StreamEventType };
export type { StreamEvent };
