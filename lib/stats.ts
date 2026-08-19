import { realTxCount, type SlotRecord } from "./types";

// Below this many samples z-scores read 0: the window is still calibrating
// and early live/replay slots must not all count as anomalies.
const MIN_SAMPLES = 8;

/** Exponentially-weighted rolling mean/std, so mappings react to relative change. */
export class RollingStats {
  private alpha: number;
  private mean_ = 0;
  private variance_ = 0;
  private count_ = 0;

  constructor(windowSize = 64) {
    this.alpha = 2 / (windowSize + 1);
  }

  push(value: number): void {
    this.count_ += 1;
    if (this.count_ === 1) {
      this.mean_ = value;
      return;
    }
    const diff = value - this.mean_;
    const incr = this.alpha * diff;
    this.mean_ += incr;
    this.variance_ = (1 - this.alpha) * (this.variance_ + diff * incr);
  }

  get count(): number {
    return this.count_;
  }

  get mean(): number {
    return this.mean_;
  }

  get std(): number {
    return Math.sqrt(this.variance_);
  }

  zScore(value: number): number {
    if (this.count_ < MIN_SAMPLES || this.std === 0) return 0;
    return (value - this.mean_) / this.std;
  }

  /** value relative to the rolling mean; 1 while uncalibrated. */
  ratio(value: number): number {
    if (this.count_ === 0 || this.mean_ === 0) return 1;
    return value / this.mean_;
  }
}

export interface ChainStats {
  txCount: RollingStats;
  computeUnits: RollingStats;
  totalFees: RollingStats;
}

export function createChainStats(windowSize = 64): ChainStats {
  return {
    txCount: new RollingStats(windowSize),
    computeUnits: new RollingStats(windowSize),
    totalFees: new RollingStats(windowSize),
  };
}

/** Call after mapping a slot. Skipped slots carry zeros and must not drag the window. */
export function updateChainStats(stats: ChainStats, record: SlotRecord): void {
  if (record.skipped) return;
  // vote traffic is a constant validator drone; the music tracks real activity
  stats.txCount.push(realTxCount(record));
  stats.computeUnits.push(record.computeUnits);
  stats.totalFees.push(record.totalFees);
}
