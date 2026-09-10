// Dependency-free 3D geometry projected onto Canvas2D. Presentation only:
// no media devices, provider calls, timers, DOM state or synthetic progress.
const POINT_COUNT = 530;
const POINTS = Array.from({ length: POINT_COUNT }, (_, i) => {
  const y = 1 - (2 * i) / (POINT_COUNT - 1);
  const radius = Math.sqrt(1 - y * y);
  const angle = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
});

function project(x, y, z, angle, radius, cx, cy) {
  const rx = x * Math.cos(angle) + z * Math.sin(angle);
  const rz = -x * Math.sin(angle) + z * Math.cos(angle);
  const tilt = 0.3;
  const ry = y * Math.cos(tilt) - rz * Math.sin(tilt);
  const depthZ = y * Math.sin(tilt) + rz * Math.cos(tilt);
  const depth = 3.6 / (3.6 - depthZ);
  return {
    x: cx + rx * radius * depth,
    y: cy + ry * radius * depth,
    z: depthZ,
    depth,
  };
}

export function drawStudioCore(
  pen,
  { width, height, time, energy, phase, ink, reduced },
) {
  const cx = width / 2;
  const cy = height * 0.37;
  const radius = Math.min(width * 0.265, height * 0.2, 126);
  const angle = reduced ? 0 : time * (phase === "thinking" ? 1.7 : 0.65);
  const expansion = reduced ? 1 : 1 + energy * 0.09;
  pen.save();
  pen.clearRect(0, 0, width, height);
  pen.fillStyle = ink;
  // Sort by camera depth so brighter foreground points carry the form.
  const points = POINTS.map(([x, y, z]) =>
    project(x * expansion, y * expansion, z * expansion, angle, radius, cx, cy),
  ).sort((a, b) => a.z - b.z);
  for (const point of points) {
    pen.beginPath();
    pen.globalAlpha = Math.max(0.1, Math.min(0.95, 0.17 + (point.z + 1) * 0.3));
    pen.arc(
      point.x,
      point.y,
      Math.max(0.45, point.depth * (0.85 + (reduced ? 0 : energy) * 0.15)),
      0,
      Math.PI * 2,
    );
    pen.fill();
  }
  for (let ring = 0; ring < 3; ring++) {
    pen.beginPath();
    for (let i = 0; i <= 150; i++) {
      const a = (i / 150) * Math.PI * 2;
      const x = Math.cos(a) * (1.22 + ring * 0.12);
      const y = Math.sin(a) * 0.28;
      const z = Math.sin(a) * (1.22 + ring * 0.12);
      const tilt = ring * 0.85 + 0.45;
      const point = project(
        y * Math.sin(tilt) + x * Math.cos(tilt),
        y * Math.cos(tilt) - x * Math.sin(tilt),
        z,
        angle * 0.4 + ring,
        radius,
        cx,
        cy,
      );
      if (i) pen.lineTo(point.x, point.y);
      else pen.moveTo(point.x, point.y);
    }
    pen.strokeStyle = ink;
    pen.globalAlpha = ring === 0 ? 0.65 : 0.25;
    pen.lineWidth = ring === 0 ? 1.1 : 0.65;
    pen.stroke();
  }
  pen.beginPath();
  pen.ellipse(
    cx,
    cy + radius * 1.45,
    radius * 0.92,
    radius * 0.12,
    0,
    0,
    Math.PI * 2,
  );
  pen.strokeStyle = ink;
  pen.globalAlpha = 0.15;
  pen.lineWidth = 0.7;
  pen.stroke();
  pen.restore();
}
