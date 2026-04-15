/**
 * A deterministic clock keeps generated ids, token expiry, delta cursors, and
 * scenario timelines reproducible across white-box and black-box test runs.
 */
export class DeterministicClock {
  // Store milliseconds instead of Date instances so snapshots are immutable and
  // arithmetic stays explicit.
  private currentMs: number;

  // Defaulting to wall-clock time keeps ad hoc use ergonomic, while explicit
  // base times make scenarios repeatable.
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

  // Return a fresh Date so callers cannot mutate the stored clock value.
  now(): Date {
    return new Date(this.currentMs);
  }

  // ISO strings are the common timestamp representation across provider APIs.
  nowIso(): string {
    return this.now().toISOString();
  }

  // Advancing clamps negative input to zero; tests should not accidentally move
  // tokens or delta cursors backwards through a typo.
  advanceMs(ms: number): string {
    this.currentMs += Math.max(0, Math.trunc(ms));
    return this.nowIso();
  }

  // Explicit clock jumps are stricter than constructor defaults because scenario
  // mutations should fail loudly on invalid dates.
  setTime(value: string | Date): string {
    const next = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(next.getTime())) {
      throw new Error(`Invalid clock value: ${String(value)}`);
    }
    this.currentMs = next.getTime();
    return this.nowIso();
  }
}
