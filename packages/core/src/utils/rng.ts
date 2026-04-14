export class SeededRandom {
  private state: number;

  constructor(seed = 0x1234abcd) {
    this.state = seed >>> 0;
  }

  next(): number {
    // Mulberry32 keeps the implementation tiny while still being stable enough
    // for deterministic fixture generation.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, maxInclusive: number): number {
    const span = Math.max(1, Math.trunc(maxInclusive - min + 1));
    return min + Math.floor(this.next() * span);
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) {
      throw new Error('Cannot pick from an empty array');
    }
    return items[this.int(0, items.length - 1)] as T;
  }
}
