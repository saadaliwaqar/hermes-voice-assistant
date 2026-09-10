class HermesCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.pos = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input)
      for (const s of input) {
        this.buffer[this.pos++] = s;
        if (this.pos === this.buffer.length) {
          this.port.postMessage(this.buffer);
          this.pos = 0;
          this.buffer = new Float32Array(2048);
        }
      }
    return true;
  }
}
registerProcessor("hermes-capture", HermesCapture);
