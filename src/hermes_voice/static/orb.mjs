import { drawStudioCore } from "./orb-geometry.mjs";

// Presentation only. Never records audio or starts the microphone.
export function createVoiceOrb(canvas, stage) {
  const pen = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0,
    height = 0,
    frame,
    last = 0,
    input = 0,
    energy = 0;
  let phase = "standby",
    context,
    analyser,
    source;
  let ink = "#7de2dd",
    line = "#283b42",
    background = "#091114";
  const labels = {
    standby: "SYSTEM STANDBY",
    listening: "VOICE INPUT ACTIVE",
    thinking: "PROCESSING REQUEST",
    speaking: "VOICE OUTPUT ACTIVE",
  };
  function palette() {
    const css = getComputedStyle(stage);
    ink = css.getPropertyValue("--accent").trim();
    line = css.getPropertyValue("--line").trim();
    background = css.getPropertyValue("--bg").trim();
  }
  const themeObserver = new MutationObserver(palette);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const resize = new ResizeObserver((entries) => {
    const box = entries[0].contentRect;
    width = box.width;
    height = box.height;
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * scale;
    canvas.height = height * scale;
    pen.setTransform(scale, 0, 0, scale, 0, 0);
  });
  resize.observe(canvas);
  palette();
  function setPhase(next) {
    phase = labels[next] ? next : "standby";
    stage.dataset.phase = phase;
    stage.querySelector(".orb-state").textContent = labels[phase];
    if (phase !== "listening") input = 0;
  }
  async function prepare() {
    try {
      context ||= new AudioContext();
      if (context.state === "suspended") await context.resume();
    } catch {
      /* Visualization must never prevent ordinary audio playback. */
    }
  }
  function disconnect() {
    source?.disconnect();
    source = null;
    analyser?.disconnect();
    analyser = null;
  }
  function attach(player) {
    if (!context || context.state !== "running") return;
    try {
      disconnect();
      const nextAnalyser = context.createAnalyser();
      nextAnalyser.fftSize = 256;
      const nextSource = context.createMediaElementSource(player);
      nextSource.connect(nextAnalyser);
      nextAnalyser.connect(context.destination);
      source = nextSource;
      analyser = nextAnalyser;
    } catch {
      /* Optional visual analysis; native playback remains the fallback. */
    }
  }
  const samples = new Uint8Array(256);
  function draw(now) {
    frame = requestAnimationFrame(draw);
    if (
      document.hidden ||
      stage.dataset.compact === "true" ||
      !width ||
      !height
    )
      return;
    if (now - last < (reduced.matches ? 180 : 32)) return;
    last = now;
    let level = phase === "listening" ? input : 0;
    if (phase === "speaking" && analyser) {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += ((value - 128) / 128) ** 2;
      level = Math.min(1, Math.sqrt(sum / samples.length) * 5);
    }
    energy = energy * 0.72 + level * 0.28;
    // Measured RMS is exposed as a diagnostic, never as synthetic progress.
    stage.dataset.energy = energy.toFixed(3);
    const studio = document.documentElement.dataset.layout === "studio";
    const renderer = studio ? "studio-3d" : "classic";
    if (stage.dataset.renderer !== renderer) stage.dataset.renderer = renderer;
    const motion = reduced.matches ? "reduced" : "full";
    if (stage.dataset.motion !== motion) stage.dataset.motion = motion;
    if (studio) {
      drawStudioCore(pen, {
        width,
        height,
        time: now * 0.00018,
        energy,
        phase,
        ink,
        reduced: reduced.matches,
      });
      return;
    }
    const x = width / 2,
      y = height / 2,
      r = Math.min(height * 0.34, width * 0.31, 132);
    const time = reduced.matches ? 0 : now * 0.00018;
    pen.clearRect(0, 0, width, height);
    const circle = (radius, color, alpha = 1, thickness = 1) => {
      pen.beginPath();
      pen.arc(x, y, radius, 0, Math.PI * 2);
      pen.strokeStyle = color;
      pen.globalAlpha = alpha;
      pen.lineWidth = thickness;
      pen.stroke();
    };
    pen.fillStyle = background;
    pen.globalAlpha = 0.15;
    pen.beginPath();
    pen.arc(x, y, r * 1.2, 0, Math.PI * 2);
    pen.fill();
    circle(r * 1.29, line, 0.9);
    circle(r * 1.16, ink, 0.18);
    circle(r * 0.72, ink, 0.16);
    for (let i = 0; i < 96; i++) {
      const a = (i * Math.PI * 2) / 96,
        length = i % 4 ? 3 : 7;
      pen.beginPath();
      pen.moveTo(x + Math.cos(a) * r * 1.21, y + Math.sin(a) * r * 1.21);
      pen.lineTo(
        x + Math.cos(a) * (r * 1.21 + length),
        y + Math.sin(a) * (r * 1.21 + length),
      );
      pen.strokeStyle = ink;
      pen.globalAlpha = i % 4 ? 0.16 : 0.45;
      pen.lineWidth = 0.8;
      pen.stroke();
    }
    for (let layer = 0; layer < 3; layer++) {
      pen.beginPath();
      for (let i = 0; i <= 200; i++) {
        const a = (i * Math.PI * 2) / 200;
        const ripple =
          (Math.sin(a * 6 + time * 5 + layer) + Math.cos(a * 11 - time * 3)) *
          (1 + energy * 12);
        const radius = r * (0.9 + layer * 0.044) + ripple;
        const px = x + Math.cos(a) * radius,
          py = y + Math.sin(a) * radius;
        if (i) pen.lineTo(px, py);
        else pen.moveTo(px, py);
      }
      pen.strokeStyle = ink;
      pen.globalAlpha = 0.25 + layer * 0.21 + energy * 0.12;
      pen.lineWidth = layer === 2 ? 1.5 : 0.8;
      pen.stroke();
    }
    for (let j = 0; j < 3; j++) {
      const a =
        time * (phase === "thinking" ? 3 : 1) * (j % 2 ? -1 : 1) + j * 2.1;
      pen.beginPath();
      pen.arc(x, y, r * (1.1 - j * 0.05), a, a + 0.5);
      pen.strokeStyle = ink;
      pen.globalAlpha = 0.65;
      pen.lineWidth = j === 1 ? 2 : 1;
      pen.stroke();
    }
    for (let i = 0; i < 34; i++) {
      const a = i * 2.39996 + time * 0.25,
        radius = r * (0.91 + 0.14 * Math.sin(i * 3.7));
      pen.beginPath();
      pen.arc(
        x + Math.cos(a) * radius,
        y + Math.sin(a) * radius,
        i % 7 ? 0.7 : 1.6,
        0,
        Math.PI * 2,
      );
      pen.fillStyle = ink;
      pen.globalAlpha = i % 7 ? 0.32 : 0.8;
      pen.fill();
    }
    pen.globalAlpha = 1;
  }
  frame = requestAnimationFrame(draw);
  return {
    setPhase,
    prepare,
    attach,
    disconnect,
    input(buffer) {
      let sum = 0;
      for (const value of buffer) sum += value * value;
      input = Math.min(1, Math.sqrt(sum / Math.max(1, buffer.length)) * 5);
    },
    destroy() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      themeObserver.disconnect();
      disconnect();
      context?.close().catch(() => {});
    },
  };
}
