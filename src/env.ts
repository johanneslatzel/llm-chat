export function envInt(key: string, fallback: number, min = 1): number {
    const raw = process.env[key];
    if (raw === undefined || raw.trim() === '') return Math.max(min, fallback);
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? Math.max(min, parsed) : Math.max(min, fallback);
}

export function envFloat(key: string, fallback: number, min?: number): number {
    const raw = process.env[key];
    if (raw === undefined || raw.trim() === '')
        return min !== undefined ? Math.max(min, fallback) : fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return min !== undefined ? Math.max(min, fallback) : fallback;
    return min !== undefined ? Math.max(min, parsed) : parsed;
}

export function envString(key: string, fallback: string): string {
    return process.env[key] ?? fallback;
}

export function envOptionalString(key: string): string | undefined {
    const val = process.env[key];
    return val?.trim() || undefined;
}

export function envBool(key: string, fallback: boolean): boolean {
    const raw = process.env[key];
    if (raw === undefined || raw === '') return fallback;
    const value = raw.trim().toLowerCase();
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return fallback;
}
