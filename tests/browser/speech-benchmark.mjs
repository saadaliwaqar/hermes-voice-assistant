// Fixed-text speech A/B benchmark, NOT model or microphone latency.
// Session responses below are explicit test fixtures; synthesis is the real local API.
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const base = process.env.HERMES_VOICE_TEST_URL || "http://127.0.0.1:8781";
const variant = process.env.BENCH_VARIANT || "after";
const root = process.cwd();
const staticRoot = path.join(
  root,
  variant === "before"
    ? ".local/speed-baseline/static"
    : "src/hermes_voice/static",
);
const sample =
  "A useful voice assistant should begin speaking promptly, while keeping every sentence in the correct order. The first sentence should not wait for the entire reply to become an audio file. While you hear one part, the next part can be prepared quietly in the background. Only one audio player should speak at a time, and pressing Interrupt should stop it immediately. Switching conversations must also stop old audio and cancel unnecessary speech requests. Your written response should remain available even if the voice service fails. Local speech can avoid network delays after its model is loaded, while cloud speech depends on network conditions and the provider. These checks use the same fixed passage each time so the measurements compare speech startup, not differences between generated model answers.";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const results = [];
const full = process.env.BENCH_FULL === "1";
try {
  for (const [provider, voice] of [
    ["piper", "en_US-ljspeech-medium"],
    ["edge", "en-US-AriaNeural"],
  ]) {
    for (let trial = 0; trial < (full ? 1 : 3); trial++) {
      const page = await browser.newPage();
      const settings = {
        provider: "test-fixture",
        model: "fixed-text-only",
        fast_model: "",
        voice_provider: provider,
        voice,
        language: "en",
        hermes_available: true,
      };
      const changed = await page.request.patch(base + "/api/settings", {
        headers: { "X-Hermes-Voice": "browser", Origin: base },
        data: { voice_provider: provider, voice },
      });
      assert.ok(changed.ok());
      assert.equal(
        (await (await page.request.get(base + "/api/settings")).json())
          .voice_provider,
        provider,
      );
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url()),
          p = url.pathname;
        if (p === "/api/synthesize") return route.continue();
        if (p === "/api/settings") return route.fulfill({ json: settings });
        if (p === "/api/setup")
          return route.fulfill({ json: { completed: true } });
        if (p === "/api/sessions")
          return route.fulfill({
            json: {
              sessions: [
                {
                  id: "fixture",
                  title: "Fixed speech benchmark fixture",
                  busy: false,
                  archived: false,
                },
              ],
            },
          });
        if (p === "/api/sessions/fixture")
          return route.fulfill({
            json: {
              session: {
                id: "fixture",
                title: "Fixed speech benchmark fixture",
                archived: false,
              },
              messages: [
                {
                  id: "sample",
                  role: "assistant",
                  content: sample,
                  created_at: 1,
                },
              ],
              tasks: [],
              approvals: [],
            },
          });
        if (p.startsWith("/api/")) return route.fulfill({ json: {} });
        const name = p === "/" ? "index.html" : p.replace(/^\/static\//, "");
        if (!/^[\w.-]+$/.test(name)) return route.abort();
        const body = await readFile(path.join(staticRoot, name));
        return route.fulfill({
          body,
          contentType: name.endsWith(".html")
            ? "text/html"
            : name.endsWith(".css")
              ? "text/css"
              : "text/javascript",
        });
      });
      await page.addInitScript(() => {
        window.__bench = { requests: [], played: 0, ended: 0, maxActive: 0 };
        const players = [];
        const original = fetch;
        window.fetch = async (...args) => {
          const p = String(args[0]);
          if (!p.endsWith("/api/synthesize")) return original(...args);
          const record = {
            start: performance.now(),
            chars: JSON.parse(args[1].body).text.length,
            text: JSON.parse(args[1].body).text,
          };
          window.__bench.requests.push(record);
          try {
            const r = await original(...args);
            record.headers = performance.now();
            return r;
          } catch (e) {
            record.aborted = e.name === "AbortError";
            throw e;
          }
        };
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          const player = this;
          players.push(player);
          window.__bench.played++;
          player.addEventListener("ended", () => window.__bench.ended++, {
            once: true,
          });
          const id = setInterval(() => {
            if (player.currentTime > 0 && !player.paused) {
              window.__bench.firstAudio ??= performance.now();
              window.__bench.maxActive = Math.max(
                window.__bench.maxActive,
                players.filter((p) => !p.paused && !p.ended).length,
              );
              clearInterval(id);
            }
          }, 5);
          return play.call(this);
        };
      });
      await page.goto(base);
      await page
        .getByRole("button", { name: "Read aloud", exact: true })
        .waitFor();
      await page.evaluate(() => (window.__bench.click = performance.now()));
      await page
        .getByRole("button", { name: "Read aloud", exact: true })
        .click();
      await page.waitForFunction(() => window.__bench.firstAudio > 0, null, {
        timeout: 90000,
      });
      if (full) {
        await page.waitForFunction(
          () => document.querySelector("#voice-state").textContent === "Ready",
          null,
          { timeout: 120000 },
        );
        const completed = await page.evaluate(() => window.__bench);
        assert.equal(
          completed.requests
            .map((r) => r.text)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
          sample,
        );
        assert.equal(completed.played, completed.requests.length);
        assert.equal(completed.ended, completed.played);
        assert.equal(completed.maxActive, 1);
        console.log(
          "FULL_REAL_SPEECH_ORDER_PASS",
          provider,
          completed.played,
          "chunks",
        );
      }
      const timing = await page.evaluate(() => window.__bench);
      const firstAudioMs = timing.firstAudio - timing.click;
      await page.locator("#interrupt").click();
      results.push({
        variant,
        provider,
        trial,
        characters: sample.length,
        firstAudioMs,
        requests: timing.requests.map((r) => ({
          chars: r.chars,
          headersMs: r.headers - r.start,
        })),
      });
      console.log(
        variant,
        provider,
        trial,
        "first audio ms:",
        firstAudioMs.toFixed(1),
      );
      await mkdir(".local/speed-evidence", { recursive: true });
      await writeFile(
        `.local/speed-evidence/${variant}${full ? "-full" : ""}.json`,
        JSON.stringify(results, null, 2),
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
}
assert.equal(results.length, full ? 2 : 6);
