// Opt-in live backend/model/Piper walkthrough, using a synthetic browser microphone.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const base = process.env.HERMES_VOICE_TEST_URL || "http://127.0.0.1:8781";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__setupStreams = [];
    const get = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await get(...args);
      window.__setupStreams.push(stream);
      return stream;
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__setupPlayer = this;
      return play.call(this);
    };
  });
  const status = await (await page.request.get(base + "/api/setup")).json();
  await page.goto(base);
  if (status.completed) await page.locator("#setup-open").click();
  await page.locator("#setup-dialog[open]").waitFor();
  await page.waitForFunction(
    () => document.querySelector("#setup-checks").children.length > 0,
  );
  assert.equal(await page.evaluate(() => window.__setupStreams.length), 0);
  await page.screenshot({ path: "docs/images/setup.png" });
  await page.locator("#setup-next").click();
  await page.locator("#setup-test-model").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#setup-model-result")
        .textContent.includes("success"),
    null,
    { timeout: 60000 },
  );
  console.log("LIVE_BROWSER_SETUP_MODEL_PASS");
  await page.locator("#setup-next").click();
  await page.locator("#setup-voice-provider").selectOption("piper");
  await page
    .locator("#setup-voice-picker")
    .selectOption("en_US-ljspeech-medium");
  await page.locator("#setup-next").click();
  await page.locator("#setup-mic").click();
  await page.waitForFunction(
    () => Number(document.querySelector("#setup-level").value) > 0.01,
  );
  await page.locator("#setup-speaker").click();
  await page.waitForFunction(
    () =>
      window.__setupPlayer &&
      !window.__setupPlayer.paused &&
      window.__setupPlayer.currentTime > 0.05,
  );
  assert.equal(
    await page.evaluate(() =>
      window.__setupStreams.every((s) =>
        s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
    true,
  );
  await page.locator("#setup-stop").click();
  assert.equal(await page.evaluate(() => window.__setupPlayer.paused), true);
  console.log("LIVE_SETUP_MIC_LEVEL_AND_PIPER_PLAYBACK_PASS");
  await page.locator("#setup-next").click();
  await page.locator("#setup-save").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#setup-save-result")
      .textContent.toLowerCase()
      .includes("verified"),
  );
  assert.equal(
    (await (await page.request.get(base + "/api/settings")).json())
      .voice_provider,
    "piper",
  );
  await page.locator("#setup-finish").click();
  await page.locator("#setup-dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await (await page.request.get(base + "/api/setup")).json()).completed,
    true,
  );
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("connected"),
  );
  assert.equal(await page.locator("#setup-dialog").isVisible(), false);
  assert.deepEqual(errors, []);
  console.log("LIVE_SETUP_SAVE_FINISH_RELOAD_PASS");
} finally {
  await browser.close();
}
