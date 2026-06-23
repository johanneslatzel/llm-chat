import { Tool } from './tool.js';

/** A bundle of related tools that can be registered together. */
export abstract class ToolPackage {
    #tools: Tool[] = [];

    constructor(tools: Tool[] = []) {
        this.#tools = [...tools];
    }

    tools(): Tool[] {
        return this.#tools;
    }

    protected add(tool: Tool): void {
        this.#tools.push(tool);
    }

    /** Returns a usage tutorial for this package, or null if none. */
    tutorial(): string | null {
        return null;
    }
}
