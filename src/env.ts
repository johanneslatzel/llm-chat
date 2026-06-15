export function envInt(key: string, fallback: number, min = 1): number {
    const raw = process.env[key];
    if (raw === undefined || raw === '') return Math.max(min, fallback);
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? Math.max(min, fallback) : Math.max(min, parsed);
}

export function envFloat(key: string, fallback: number, min?: number): number {
    const raw = process.env[key];
    if (raw === undefined || raw === '')
        return min !== undefined ? Math.max(min, fallback) : fallback;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return min !== undefined ? Math.max(min, fallback) : fallback;
    return min !== undefined ? Math.max(min, parsed) : parsed;
}

export function envString(key: string, fallback: string): string {
    return process.env[key] ?? fallback;
}

export function envOptionalString(key: string): string | undefined {
    const val = process.env[key];
    return val?.trim() || undefined;
}
