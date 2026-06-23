import { Hook } from '../hooks/hook.js';
import { HookBuilderBase } from '../hooks/hook-builder.js';

export enum ServiceEvent {
    BeforeSendLoop = 'beforeSendLoop',
    AfterSendLoop = 'afterSendLoop',
    BeforeSend = 'beforeSend',
    AfterSend = 'afterSend'
}

export interface ServiceEventTarget {
    on(event: string, handler: Function): void;
    off(event: string, handler: Function): void;
}

/** Entry point for building service lifecycle hooks. */
export class ServiceHookBuilder {
    constructor(private _svc: ServiceEventTarget) {}

    /** Hook that fires once before the send retry loop begins. */
    beforeSendLoop(): ServiceHookFilterBuilder {
        return new ServiceHookFilterBuilder(this._svc, ServiceEvent.BeforeSendLoop);
    }

    /** Hook that fires once after the send retry loop ends. */
    afterSendLoop(): ServiceHookFilterBuilder {
        return new ServiceHookFilterBuilder(this._svc, ServiceEvent.AfterSendLoop);
    }

    /** Hook that fires before each individual send (one per retry iteration). */
    beforeSend(): ServiceHookFilterBuilder {
        return new ServiceHookFilterBuilder(this._svc, ServiceEvent.BeforeSend);
    }

    /** Hook that fires after each individual send (one per retry iteration). */
    afterSend(): ServiceHookFilterBuilder {
        return new ServiceHookFilterBuilder(this._svc, ServiceEvent.AfterSend);
    }
}

/** Filter builder returned by {@link ServiceHookBuilder} methods. */
export class ServiceHookFilterBuilder extends HookBuilderBase<() => void> {
    constructor(
        private _svc: ServiceEventTarget,
        private _event: ServiceEvent
    ) {
        super();
    }

    /** Register a callback. Returns a {@link Hook} for disposal. */
    do(callback: () => void): Hook {
        return new ServiceHook(this._svc, this._event, callback);
    }
}

class ServiceHook extends Hook {
    private _handler: () => void;
    private _onEvent = async () => {
        if (this.isDisposed()) return;
        await this.asyncSafeInvoke(this._handler);
    };

    constructor(
        private _svc: ServiceEventTarget,
        private _event: ServiceEvent,
        handler: () => void
    ) {
        super();
        this._handler = handler;
        _svc.on(this._event, this._onEvent);
    }

    protected onDispose(): void {
        this._svc.off(this._event, this._onEvent);
    }
}
