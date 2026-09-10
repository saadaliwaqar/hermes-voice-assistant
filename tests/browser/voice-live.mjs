import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const fixture = process.env.HERMES_VOICE_TEST_WAV;
if (!fixture || !fs.existsSync(fixture))
  throw new Error(
    "Set HERMES_VOICE_TEST_WAV to a prerecorded WAV fixture. This opt-in test uses real providers.",
  );
const base = process.env.HERMES_VOICE_TEST_URL || "http://127.0.0.1:8780";
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${fixture}%noloop`,
  ],
});
const errors = [],
  responses = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.addInitScript(() => {
    window.__streams = [];
    window.__played = 0;
    const gum = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const s = await gum(...args);
      window.__streams.push(s);
      return s;
    };
    document.addEventListener("playing", () => window.__played++, true);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) {
      this.addEventListener("playing", () => window.__played++, { once: true });
      return play.apply(this, a);
    };
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (
      r.url().includes("/api/synthesize") ||
      r.url().includes("/api/transcribe")
    )
      responses.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  await page.addInitScript(() => {
    window.__orbEvidence = { listening: 0, speaking: 0 };
    setInterval(() => {
      const stage = document.getElementById("voice-orb-stage");
      if (stage && stage.dataset.phase in window.__orbEvidence)
        window.__orbEvidence[stage.dataset.phase] = Math.max(
          window.__orbEvidence[stage.dataset.phase],
          Number(stage.dataset.energy || 0),
        );
    }, 40);
  });
  // Dismiss the optional first-run guide without marking setup complete.
  const setupResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/setup",
  );
  await page.goto(base);
  const setupState = await (await setupResponse).json().catch(() => ({}));
  if (setupState.completed === false) await page.locator("#setup-skip").click();
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("connected"),
  );
  await page.locator("#new-session").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#session-title").textContent === "New session",
  );
  await page.locator("#auto-speech").check();
  await page.locator("#microphone").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".message.assistant .message-body").length > 0,
    {},
    { timeout: 120000 },
  );
  await page.waitForFunction(() => window.__played > 0, {}, { timeout: 90000 });
  console.log(
    "ACTUAL_USER",
    await page.locator(".message.user .message-body").first().textContent(),
  );
  console.log(
    "ACTUAL_REPLY",
    await page
      .locator(".message.assistant .message-body")
      .first()
      .textContent(),
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#voice-detail").textContent ===
      "Speech finished.",
    {},
    { timeout: 60000 },
  );
  await page.locator("#new-session").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#microphone").textContent === "Start mic" &&
      document.querySelectorAll(".message").length === 0,
  );
  assert.equal(await page.locator("#microphone").textContent(), "Start mic");
  assert.equal(
    await page.evaluate(() =>
      window.__streams.every((s) =>
        s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
    true,
  );
  assert.equal(await page.locator(".message").count(), 0);
  assert.ok(
    responses.some((r) => r.path === "/api/transcribe" && r.status === 200),
  );
  assert.ok(
    responses.some((r) => r.path === "/api/synthesize" && r.status === 200),
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    ".local/live-voice-results.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "synthetic mic -> local Whisper -> real configured conversation model -> Edge audio -> actual browser playback",
          "session switch releases all microphone tracks",
          "new session has no previous transcript",
          "no browser JS errors",
        ],
        responses,
        errors,
      },
      null,
      2,
    ),
  );
  const visual = await page.evaluate(() => window.__orbEvidence);
  assert.ok(visual.listening > 0.01, "orb measured real microphone RMS");
  assert.ok(visual.speaking > 0.01, "orb measured real playback RMS");
  console.log("AUDIO_REACTIVE_ORB", visual);
  console.log("LIVE_BROWSER_VOICE_PASS");
} finally {
  await browser.close();
}
