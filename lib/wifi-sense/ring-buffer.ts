/**
 * Fixed-size ring buffer of samples, one Float64Array per channel (timestamp, RSSI,
 * score, ...). Nothing is allocated after construction.
 *
 * Every pushed sample gets a sequence number that only grows. A sequence is readable
 * while `firstSeq <= seq < endSeq`; older ones have been overwritten.
 */
export class RingBuffer {
  readonly capacity: number;
  private readonly channels: Float64Array[];
  private pushed = 0;

  constructor(capacity: number, channelCount: number) {
    this.capacity = capacity;
    this.channels = [];
    for (let c = 0; c < channelCount; c++) this.channels.push(new Float64Array(capacity));
  }

  /** Oldest readable sequence number. */
  get firstSeq(): number {
    return this.pushed > this.capacity ? this.pushed - this.capacity : 0;
  }

  /** One past the newest sequence number. */
  get endSeq(): number {
    return this.pushed;
  }

  get size(): number {
    return this.pushed - this.firstSeq;
  }

  /** Reserves the next slot and returns its sequence number. Fill it with `set`. */
  push(): number {
    const seq = this.pushed;
    this.pushed++;
    const i = seq % this.capacity;
    for (let c = 0; c < this.channels.length; c++) this.channels[c][i] = NaN;
    return seq;
  }

  set(channel: number, seq: number, value: number): void {
    this.channels[channel][seq % this.capacity] = value;
  }

  get(channel: number, seq: number): number {
    return this.channels[channel][seq % this.capacity];
  }

  clear(): void {
    this.pushed = 0;
  }
}
