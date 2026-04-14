export class DeterministicClock {
  private currentMs: number;

  constructor(baseTime?: string | Date) {
    if (baseTime instanceof Date) {
      this.currentMs = baseTime.getTime();
      return;
    }
    if (typeof baseTime === 'string') {
      const parsed = new Date(baseTime);
      this.currentMs = Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
      return;
    }
    this.currentMs = Date.now();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  advanceMs(ms: number): string {
    this.currentMs += Math.max(0, Math.trunc(ms));
    return this.nowIso();
  }

  setTime(value: string | Date): string {
    const next = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(next.getTime())) {
      throw new Error(`Invalid clock value: ${String(value)}`);
    }
    this.currentMs = next.getTime();
    return this.nowIso();
  }
}
