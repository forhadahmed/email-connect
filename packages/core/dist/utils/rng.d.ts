export declare class SeededRandom {
    private state;
    constructor(seed?: number);
    next(): number;
    int(min: number, maxInclusive: number): number;
    bool(probability?: number): boolean;
    pick<T>(items: readonly T[]): T;
}
//# sourceMappingURL=rng.d.ts.map