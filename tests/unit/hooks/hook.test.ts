import { describe, it, expect, vi } from 'vitest';
import { Hook } from '../../../src/index.js';

describe('Hook', () => {
    it('can be extended by a concrete subclass', () => {
        let disposed = false;
        class TestHook extends Hook {
            protected onDispose(): void {
                disposed = true;
            }
        }
        const hook = new TestHook();
        expect(hook).toBeInstanceOf(Hook);
        hook.dispose();
        expect(disposed).toBe(true);
    });

    it('is exported from the barrel', () => {
        expect(Hook).toBeDefined();
    });

    it('safeInvoke catches and logs callback errors', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        class TestHook extends Hook {
            protected onDispose(): void {
                // no-op
            }
            public safeInvoke(fn: () => void): void {
                super.safeInvoke(fn);
            }
        }
        const hook = new TestHook();
        const err = new Error('callback failed');
        hook.safeInvoke(() => { throw err; });
        expect(consoleSpy).toHaveBeenCalledWith('Hook callback error:', err);
        consoleSpy.mockRestore();
    });
});
