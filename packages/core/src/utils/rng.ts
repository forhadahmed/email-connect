// Small deterministic PRNG used by the generation layer. It is not
// cryptographic; it exists so workload examples and tests replay exactly.
export class SeededRandom {
  // Internal state is a uint32 value consumed by Mulberry32.
  private state: number;

  // Coerce seeds into uint32 space so the same numeric input always produces
  // the same sequence across JS runtimes.
  constructor(seed = 0x1234abcd) {
    this.state = seed >>> 0;
  }

  // Return a floating point value in [0, 1), matching Math.random's basic shape
  // while remaining deterministic.
  next(): number {
    // Mulberry32 keeps the implementation tiny while still being stable enough
    // for deterministic fixture generation.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Inclusive integer ranges are convenient for picking fixture indexes and
  // bounded jitter.
  int(min: number, maxInclusive: number): number {
    const span = Math.max(1, Math.trunc(maxInclusive - min + 1));
    return min + Math.floor(this.next() * span);
  }

  // Probability gates are used for replies, attachments, and burst placement.
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  // Pick keeps callers concise while preserving a clear error for empty pools.
  pick<T>(items: readonly T[]): T {
    if (!items.length) {
      throw new Error('Cannot pick from an empty array');
    }
    return items[this.int(0, items.length - 1)] as T;
  }
}
