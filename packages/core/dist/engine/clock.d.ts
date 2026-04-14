export declare class DeterministicClock {
    private currentMs;
    constructor(baseTime?: string | Date);
    now(): Date;
    nowIso(): string;
    advanceMs(ms: number): string;
    setTime(value: string | Date): string;
}
//# sourceMappingURL=clock.d.ts.map