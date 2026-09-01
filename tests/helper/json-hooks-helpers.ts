import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Tool } from '../../src/tools/tool.js';
import { ToolParameters } from '../../src/tools/parameter.js';
import { ResultStatus } from '../../src/tools/result.js';
import type { PartialToolResult } from '../../src/tools/result.js';

export function createTempDir(): string {
    return mkdtempSync(join(tmpdir(), 'json-hooks-test-'));
}

export function removeTempDir(dir: string): void {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

export function writeJson(dir: string, name: string, data: unknown): void {
    writeFileSync(join(dir, name), JSON.stringify(data), 'utf-8');
}

export class TestTool extends Tool {
    constructor(name: string) {
        super(name, `Tool ${name}`, new ToolParameters({}));
    }
    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return { result: `${this.name} executed`, status: ResultStatus.Success };
    }
}

export class FailingTestTool extends Tool {
    constructor(name: string) {
        super(name, `Failing ${name}`, new ToolParameters({}));
    }
    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        throw new Error(`${this.name} failed`);
    }
}