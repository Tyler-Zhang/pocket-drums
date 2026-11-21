'use strict';

// MIDI timing clock sends 24 pulses per quarter note, or six per sixteenth.
class MidiClock {
  constructor() {
    this.reset();
  }

  reset() {
    this.intervals = [];
    this.lastTimestamp = null;
    this.period = null;
    this.nextPulse = 0;
    this.pulses = [];
    this.running = false;
  }

  start() {
    this.nextPulse = 0;
    this.pulses = [];
    this.running = true;
  }

  resume() {
    this.pulses = [];
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  seek(sixteenths) {
    this.nextPulse = sixteenths * 6;
    this.pulses = [];
  }

  tick(timestamp) {
    if (!Number.isFinite(timestamp)) return null;
    if (this.lastTimestamp !== null) {
      const interval = timestamp - this.lastTimestamp;
      // Include batched pulses and reset the estimate after a clock gap.
      if (interval > 500 || interval < 0) {
        this.intervals = [];
        this.period = null;
      } else {
        this.intervals.push(interval);
        this.intervals = this.intervals.slice(-24);
        this.period = this.intervals.reduce((sum, value) => sum + value, 0) / this.intervals.length || null;
      }
    }
    this.lastTimestamp = timestamp;
    if (!this.running) return null;
    const pulse = { number: this.nextPulse++, timestamp };
    this.pulses.push(pulse);
    this.pulses = this.pulses.slice(-768);
    return pulse;
  }

  get bpm() {
    return this.period ? 60000 / (24 * this.period) : null;
  }

  isFresh(now) {
    return this.lastTimestamp !== null && now - this.lastTimestamp < 500;
  }

  positionAt(timestamp) {
    if (!this.period || !this.pulses.length) return null;
    // Use the adjacent observed pulses to preserve phase through tempo changes.
    const next = this.pulses.findIndex(pulse => pulse.timestamp > timestamp);
    if (next > 0) {
      const before = this.pulses[next - 1];
      const after = this.pulses[next];
      return (before.number + (timestamp - before.timestamp) /
        (after.timestamp - before.timestamp)) / 6;
    }
    const anchor = next === 0 ? this.pulses[0] : this.pulses.at(-1);
    return (anchor.number + (timestamp - anchor.timestamp) / this.period) / 6;
  }

  timingAt(timestamp) {
    const position = this.positionAt(timestamp);
    if (position === null || position < 0) return null;
    const step = Math.round(position);
    const targetPulse = step * 6;
    const boundary = this.pulses.find(pulse => pulse.number === targetPulse);
    const last = this.pulses.at(-1);
    const targetTime = boundary?.timestamp ??
      last.timestamp + (targetPulse - last.number) * this.period;
    return { step, error: timestamp - targetTime };
  }
}

if (typeof module !== 'undefined') module.exports = { MidiClock };
