import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ResultStatus,
    TimedTool,
    TimedToolNotificationKind,
    Tool,
    ToolParameters,
    type PartialToolResult
} from '../../../src/index.js';

class SlowTool extends Tool {
    private readonly _gate: Promise<void>;

    constructor(name: string, gate: Promise<void>) {
        super(name, 'slow tool', new ToolParameters({}, []));
        this._gate = gate;
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        await this._gate;
        return { result: 'slow done', status: ResultStatus.Success };
    }
}

class FailingTool extends Tool {
    constructor() {
        super('failing', 'failing tool', new ToolParameters({}, []));
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        throw new Error('inner boom');
    }
}

class FastTool extends Tool {
    constructor() {
        super('fast', 'fast tool', new ToolParameters({}, []));
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return { result: 'fast ' + String(args.value), status: ResultStatus.Success };
    }
}

afterEach(() => {
    vi.useRealTimers();
});

describe('TimedTool', () => {
    it('delegates the provider definition to the wrapped tool', () => {
        const inner = new FastTool();
        const tool = new TimedTool(inner, 50);
        expect(tool.name).toBe('fast');
        expect(tool.description).toBe('fast tool');
        expect(tool.toOpenAI()).toEqual(inner.toOpenAI());
    });

    it('returns the inner result when the tool finishes in time', async () => {
        const tool = new TimedTool(new FastTool(), 50);
        const results = await tool.execute({ value: 'x' });
        expect(results).toEqual([{ tool: 'fast', result: 'fast x', status: ResultStatus.Success }]);
    });

    it('uses default signal and notify when omitted', async () => {
        vi.useFakeTimers();
        const tool = new TimedTool(
            new SlowTool('slow', new Promise<void>(() => undefined)),
            10
        );
        const pending = tool.execute({});
        await vi.advanceTimersByTimeAsync(11);
        const results = await pending;
        expect(results[0]?.result).toContain("Tool 'slow' timed out after 10 ms");
    });

    it('returns an error result when the tool times out', async () => {
        vi.useFakeTimers();
        const notify = vi.fn();
        const tool = new TimedTool(
            new SlowTool('slow', new Promise<void>(() => undefined)),
            10,
            notify
        );
        const pending = tool.execute({});
        await vi.advanceTimersByTimeAsync(11);
        const results = await pending;
        expect(results[0]?.status).toBe(ResultStatus.Error);
        expect(results[0]?.result).toContain("Tool 'slow' timed out after 10 ms");
        expect(notify).toHaveBeenCalledWith(
            TimedToolNotificationKind.Timeout,
            "Tool 'slow' timed out after 10 ms"
        );
    });

    it('still settles when the notify callback throws', async () => {
        vi.useFakeTimers();
        const notify = (): void => {
            throw new Error('notify boom');
        };
        const tool = new TimedTool(
            new SlowTool('slow', new Promise<void>(() => undefined)),
            10,
            notify
        );
        const pending = tool.execute({});
        await vi.advanceTimersByTimeAsync(11);
        const results = await pending;
        expect(results[0]?.status).toBe(ResultStatus.Error);
        expect(results[0]?.result).toContain("Tool 'slow' timed out after 10 ms");
    });

    it('returns an error result when the run is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const notify = vi.fn();
        const tool = new TimedTool(
            new SlowTool('slow', new Promise<void>(() => undefined)),
            50,
            notify,
            () => controller.signal
        );
        const results = await tool.execute({});
        expect(results[0]?.result).toContain("Tool 'slow' was cancelled");
        expect(notify).toHaveBeenCalledWith(
            TimedToolNotificationKind.Cancelled,
            "Tool 'slow' was cancelled"
        );
    });

    it('removes the abort listener after a successful call', async () => {
        const controller = new AbortController();
        const tool = new TimedTool(new FastTool(), 50, undefined, () => controller.signal);
        const results = await tool.execute({ value: 'z' });
        expect(results[0]?.result).toBe('fast z');
        controller.abort();
    });

    it('returns an error result when the run is aborted mid-call', async () => {
        const controller = new AbortController();
        const tool = new TimedTool(
            new SlowTool('slow', new Promise<void>(() => undefined)),
            50,
            undefined,
            () => controller.signal
        );
        const pending = tool.execute({});
        controller.abort();
        const results = await pending;
        expect(results[0]?.status).toBe(ResultStatus.Error);
    });

    it('throws when timeoutMs is zero or negative', () => {
        expect(() => new TimedTool(new FastTool(), 0)).toThrow(
            "TimedTool 'fast' requires timeoutMs > 0, received 0"
        );
        expect(() => new TimedTool(new FastTool(), -1)).toThrow(RangeError);
    });

    it('throws when timeoutMs is not finite', () => {
        expect(
            () => new TimedTool(new FastTool(), Number.NaN)
        ).toThrow(RangeError);
        expect(
            () => new TimedTool(new FastTool(), Number.POSITIVE_INFINITY)
        ).toThrow(RangeError);
    });

    it('converts an inner rejection into an error result', async () => {
        const tool = new TimedTool(new FailingTool(), 50);
        const results = await tool.execute({});
        expect(results[0]?.status).toBe(ResultStatus.Error);
        expect(results[0]?.result).toContain('inner boom');
    });

    it('keeps multiple inner results in order', async () => {
        const inner = {
            name: 'multi',
            description: 'multi tool',
            toOpenAI: () => new FastTool().toOpenAI(),
            execute: async () => [
                { tool: 'multi', result: 'one', status: ResultStatus.Success },
                { tool: 'multi', result: 'two', status: ResultStatus.Error }
            ]
        } as unknown as Tool;
        const tool = new TimedTool(inner, 50);
        const results = await tool.execute({});
        expect(results.map((entry) => entry.result)).toEqual(['one', 'two']);
        expect(results[1]?.status).toBe(ResultStatus.Error);
    });

    it('returns a success placeholder when the inner tool yields no results', async () => {
        const inner = {
            name: 'empty',
            description: 'empty tool',
            toOpenAI: () => new FastTool().toOpenAI(),
            execute: async () => []
        } as unknown as Tool;
        const tool = new TimedTool(inner, 50);
        const results = await tool.execute({});
        expect(results).toEqual([{ tool: 'empty', result: '', status: ResultStatus.Success }]);
    });

    it('converts an Error rejection into an error result', async () => {
        const inner = {
            name: 'broken',
            description: 'broken tool',
            toOpenAI: () => new FastTool().toOpenAI(),
            execute: async () => {
                throw new Error('rejected boom');
            }
        } as unknown as Tool;
        const tool = new TimedTool(inner, 50);
        const results = await tool.execute({});
        expect(results[0]?.status).toBe(ResultStatus.Error);
        expect(results[0]?.result).toContain('rejected boom');
    });

    it('converts a non-Error rejection into an error result', async () => {
        const inner = {
            name: 'broken',
            description: 'broken tool',
            toOpenAI: () => new FastTool().toOpenAI(),
            execute: async () => {
                throw 'plain failure';
            }
        } as unknown as Tool;
        const tool = new TimedTool(inner, 50);
        const results = await tool.execute({});
        expect(results[0]?.status).toBe(ResultStatus.Error);
        expect(results[0]?.result).toContain('plain failure');
    });

    it('ignores a late inner result after a timeout', async () => {
        vi.useFakeTimers();
        let release = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const tool = new TimedTool(new SlowTool('slow', gate), 10);
        const pending = tool.execute({});
        await vi.advanceTimersByTimeAsync(11);
        release();
        await vi.advanceTimersByTimeAsync(0);
        const results = await pending;
        expect(results[0]?.result).toContain('timed out');
    });
});
