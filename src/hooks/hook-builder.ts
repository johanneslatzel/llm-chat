import { Hook } from './hook.js';

/** Base class for hook builders. Subclasses implement {@link do} to register the callback. */
export abstract class HookBuilderBase<TCallback extends (...args: any[]) => void> {
    /** Register the callback and return the {@link Hook} (call {@link Hook.dispose} to unsubscribe). */
    abstract do(callback: TCallback): Hook;
}

/** Something that provides a hook builder via {@link hook}. */
export interface HasHooks<THookBuilder> {
    /** Access the hook builder for this object. */
    hook(): THookBuilder;
}
