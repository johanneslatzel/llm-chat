import { Hook } from './hook.js';

export abstract class HookBuilderBase<TCallback extends (...args: any[]) => void> {
    abstract do(callback: TCallback): Hook;
}

export interface HasHooks<THookBuilder> {
    hook(): THookBuilder;
}
