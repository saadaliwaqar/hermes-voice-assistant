import { test } from "node:test";
import assert from "node:assert/strict";
import { drawStudioCore } from "../src/hermes_voice/static/orb-geometry.mjs";

function render(overrides = {}) {
  const calls = [];
  const pen = new Proxy(
    {},
    {
      get:
        (_, key) =>
        (...args) =>
          calls.push([key, ...args]),
      set: (_, key, value) => {
        calls.push([key, value]);
        return true;
      },
    },
  );
  drawStudioCore(pen, {
    width: 320,
    height: 400,
    time: 5,
    energy: 0,
    phase: "standby",
    ink: "#7de2dd",
    reduced: false,
    ...overrides,
  });
  return calls;
}

test("reduced motion freezes geometry despite audio and clock changes", () => {
  assert.deepEqual(
    render({ reduced: true, time: 0, energy: 0 }),
    render({ reduced: true, time: 250, energy: 1 }),
  );
});
test("full motion responds to measured audio energy", () => {
  assert.notDeepEqual(render({ energy: 0 }), render({ energy: 1 }));
});
test("projected geometry stays finite and within the canvas", () => {
  for (const width of [180, 320, 520]) {
    const height = 340;
    for (const call of render({ width, height, energy: 1 })) {
      for (const value of call.slice(1))
        if (typeof value === "number") assert.ok(Number.isFinite(value));
      if (["arc", "moveTo", "lineTo", "ellipse"].includes(call[0])) {
        assert.ok(
          call[1] >= 0 && call[1] <= width,
          `${call[0]} outside horizontal bounds`,
        );
        assert.ok(
          call[2] >= 0 && call[2] <= height,
          `${call[0]} outside vertical bounds`,
        );
      }
    }
  }
});
