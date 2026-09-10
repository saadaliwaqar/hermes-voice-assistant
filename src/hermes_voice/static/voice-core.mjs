export class SpeechGate {
  constructor({ sampleRate = 48000, silenceMs = 800, maxMs = 30000 } = {}) {
    this.sampleRate = sampleRate;
    this.silenceMs = silenceMs;
    this.maxMs = maxMs;
    this.reset();
  }
  reset() {
    this.active = false;
    this.frames = [];
    this.pre = [];
    this.voiced = 0;
    this.quiet = 0;
    this.total = 0;
    this.floor = 0.004;
  }
  push(samples) {
    const ms = (samples.length / this.sampleRate) * 1000;
    let sum = 0;
    for (const s of samples) sum += s * s;
    const rms = Math.sqrt(sum / samples.length);
    const threshold = Math.max(0.014, Math.min(0.045, this.floor * 3));
    const loud = rms > threshold;
    if (!this.active) {
      if (!loud) {
        this.floor = this.floor * 0.96 + rms * 0.04;
        this.pre.push(samples.slice());
        while (
          this.pre.reduce((a, b) => a + b.length, 0) >
          this.sampleRate * 0.22
        )
          this.pre.shift();
        return null;
      }
      this.active = true;
      this.frames = this.pre;
      this.pre = [];
    }
    this.frames.push(samples.slice());
    this.total += ms;
    if (loud) {
      this.voiced += ms;
      this.quiet = 0;
    } else this.quiet += ms;
    if (this.quiet >= this.silenceMs || this.total >= this.maxMs) {
      const valid = this.voiced >= 250;
      const count = this.frames.reduce((a, b) => a + b.length, 0);
      const data = new Float32Array(count);
      let i = 0;
      for (const f of this.frames) {
        data.set(f, i);
        i += f.length;
      }
      this.reset();
      return valid ? data : null;
    }
    return null;
  }
}
export function encodeWav(samples, rate) {
  const b = new ArrayBuffer(44 + samples.length * 2),
    v = new DataView(b);
  const str = (p, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, b.byteLength - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return b;
}
export function nextPhase({ active, busy, playing }) {
  return playing
    ? "speaking"
    : busy
      ? "thinking"
      : active
        ? "listening"
        : "standby";
}
