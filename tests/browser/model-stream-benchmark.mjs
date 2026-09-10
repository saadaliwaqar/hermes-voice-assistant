// Opt-in real-provider benchmark. Run against isolated QA data only.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.HERMES_VOICE_TEST_URL;
if (!base || !["8781", "8782"].includes(new URL(base).port))
  throw new Error("Set isolated QA URL on8781 or8782; not live history.");
const variant = process.env.BENCH_VARIANT || "before";
const trials = Number(process.env.BENCH_TRIALS || 3);
const paragraph = [
  "The observatory stood above the quiet valley, where a narrow path curved between the pine trees and the old stone walls.",
  "Every evening, the caretaker opened the shutters and checked the instruments before the first stars appeared over the eastern ridge.",
  "A small notebook rested beside the telescope, filled with careful sketches, weather notes, and questions that had not yet found answers.",
  "The building was simple, but its wide windows made the distant landscape feel like part of the room.",
  "Visitors usually arrived just before sunset, carrying warm coats and the patient curiosity that makes an ordinary evening memorable.",
  "Inside, a kettle began to sing while someone unfolded a map of the sky across the wooden table.",
  "There was no hurry to discover anything remarkable, because learning to notice small details was already a useful beginning.",
  "The caretaker explained how to find familiar constellations, then stepped aside so everyone could look through the telescope in turn.",
  "Some visitors asked technical questions, while others preferred to watch in silence and remember what they had seen.",
  "Beyond the windows, the valley lights gradually faded until the road was only a pale ribbon beneath the hills.",
  "A passing cloud briefly covered the moon, changing the shadows on the floor without disturbing the conversation.",
  "When the sky cleared again, the group returned to their observations with renewed attention and a few more thoughtful questions.",
  "Before leaving, each visitor wrote one sentence in the notebook about something they hoped to understand better.",
  "The caretaker closed the shutters, washed the cups, and left the notebook open for another evening of patient discovery.",
].join(" ");
const prompt =
  "Repeat the following passage verbatim, with no introduction, headings, omissions, or additional text:\n\n" +
  paragraph;
const output = ".local/stream-evidence/" + variant + ".json";
fs.mkdirSync(".local/stream-evidence", { recursive: true });
const records = fs.existsSync(output)
  ? JSON.parse(fs.readFileSync(output))
  : [];
for (let trial = 0; trial < trials; trial++) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    const synth = [];
    let taskId, sid;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", async (r) => {
      if (
        r.request().method() === "POST" &&
        /\/api\/sessions\/[^/]+\/messages$/.test(new URL(r.url()).pathname)
      ) {
        const result = await r.json();
        taskId = result.id;
        sid = new URL(r.url()).pathname.split("/")[3];
      }
    });
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/synthesize")
        synth.push(r.postDataJSON().text);
    });
    await page.addInitScript(() => {
      window.__bench = { start: null, first: null, final: null };
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        this.addEventListener(
          "playing",
          () => {
            if (window.__bench.start !== null && window.__bench.first === null)
              window.__bench.first = performance.now();
          },
          { once: true },
        );
        return play.apply(this, args);
      };
      document.addEventListener(
        "submit",
        (e) => {
          if (e.target.id === "composer")
            window.__bench.start = performance.now();
        },
        true,
      );
      new MutationObserver(() => {
        if (
          window.__bench.start !== null &&
          window.__bench.final === null &&
          document.querySelector(".message.assistant .message-body")
        )
          window.__bench.final = performance.now();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.route("**/api/setup", (r) =>
      r.fulfill({ json: { completed: true, checks: [], defaults: {} } }),
    );
    await page.goto(base + (variant === "before" ? "" : "/?stream=1"));
    await page.waitForFunction(() =>
      document.getElementById("connection").textContent.includes("connected"),
    );
    await page.locator("#new-session").click();
    await page.waitForFunction(
      () =>
        document.getElementById("session-title").textContent ===
          "New session" && !document.querySelector(".message"),
    );
    await page.locator("#auto-speech").check();
    await page.locator("#message-input").fill(prompt);
    await page.locator("#send").click();
    await page.waitForFunction(
      () => window.__bench.first !== null,
      {},
      { timeout: 120000 },
    );
    assert.ok(taskId && sid, "received send identity before first audio");
    const atAudio = await (
      await page.request.get(base + "/api/sessions/" + sid)
    ).json();
    const runningAtAudio =
      atAudio.tasks.find((t) => t.id === taskId)?.status === "running";
    await page.waitForFunction(
      () => window.__bench.final !== null,
      {},
      { timeout: 120000 },
    );
    const text = await page
      .locator(".message.assistant .message-body")
      .last()
      .textContent();
    const timing = await page.evaluate(() => ({
      firstAudioMs: window.__bench.first - window.__bench.start,
      finalVisibleMs: window.__bench.final - window.__bench.start,
    }));
    assert.equal(
      text.trim(),
      paragraph,
      "real final model output equals the requested fixture",
    );
    assert.ok(
      synth.length && paragraph.startsWith(synth[0].trim()),
      "first synthesized content belongs to actual response",
    );
    assert.deepEqual(errors, []);
    await page.locator("#interrupt").click();
    const record = {
      variant,
      trial: records.length + 1,
      ...timing,
      runningAtAudio,
      characters: text.length,
      synthesisRequestsAtStop: synth.length,
      firstSpeechChars: synth[0].length,
      taskId,
      sessionId: sid,
      errors,
    };
    records.push(record);
    fs.writeFileSync(output, JSON.stringify(records, null, 2));
    console.log(JSON.stringify(record));
  } finally {
    await browser.close();
  }
}
console.log("REAL_STREAM_BENCHMARK_SAVED", output);
