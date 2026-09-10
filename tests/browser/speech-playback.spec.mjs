import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const reply = "A complete sentence with several useful words. ".repeat(120);
async function fixture(page, fakeMic = false) {
  if (fakeMic)
    await page.addInitScript(() => {
      const link = () => ({ connect() {}, disconnect() {} });
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
        },
      });
      window.AudioContext = class {
        state = "running";
        sampleRate = 16000;
        destination = {};
        audioWorklet = { addModule: async () => {} };
        resume() {
          return Promise.resolve();
        }
        close() {
          return Promise.resolve();
        }
        createMediaStreamSource() {
          return link();
        }
        createGain() {
          return { ...link(), gain: { value: 0 } };
        }
      };
      window.AudioWorkletNode = class {
        constructor() {
          this.port = {};
          window.micPort = this.port;
        }
        connect() {}
        disconnect() {}
      };
    });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.synth = [];
    window.players = [];
    window.revoked = [];
    const fetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (String(url) === "/api/synthesize")
        return new Promise((resolve, reject) => {
          // Deliberately ignore abort; observe signal while testing stale ownership.
          window.synth.push({
            text: JSON.parse(options.body).text,
            signal: options.signal,
            resolve: () =>
              resolve(new Response(new Blob(["test"], { type: "audio/wav" }))),
            reject,
          });
        });
      return fetch(url, options);
    };
    URL.revokeObjectURL = (url) => window.revoked.push(url);
    window.Audio = function (url) {
      const p = {
        src: url,
        paused: true,
        play() {
          this.paused = false;
          return Promise.resolve();
        },
        pause() {
          this.paused = true;
        },
        end() {
          this.paused = true;
          this.onended?.();
        },
        fail() {
          this.onerror?.();
        },
        addEventListener() {},
        removeEventListener() {},
      };
      window.players.push(p);
      return p;
    };
  });
  await page.route("http://speech.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/" || path.startsWith("/static/")) {
      const name = path === "/" ? "index.html" : path.slice(8);
      return route.fulfill({
        contentType: name.endsWith("html")
          ? "text/html"
          : name.endsWith("css")
            ? "text/css"
            : "text/javascript",
        body: await readFile(
          new URL(`../../src/hermes_voice/static/${name}`, import.meta.url),
        ),
      });
    }
    let json = {};
    if (path === "/api/settings")
      json = { voice_provider: "edge", voice: "test", hermes_available: true };
    if (path === "/api/setup")
      json = { completed: true, checks: [], defaults: {} };
    if (path === "/api/sessions")
      json = {
        sessions: [
          { id: "one", title: "One" },
          { id: "two", title: "Two" },
        ],
      };
    if (/^\/api\/sessions\/(one|two)$/.test(path))
      json = {
        session: {
          id: path.split("/").at(-1),
          title: path.endsWith("one") ? "One" : "Two",
        },
        messages: [
          { id: "reply", role: "assistant", content: reply },
          { id: "other", role: "assistant", content: "A different reply." },
        ],
        tasks: [],
        approvals: [],
      };
    if (path === "/api/voices") json = { available: true, voices: [] };
    return route.fulfill({ json });
  });
  await page.goto("http://speech.test");
  await expect(page.locator("#session-title")).toHaveText("One");
  return errors;
}
const count = (page) => page.evaluate(() => window.synth.length);
test("completed long reply starts first chunk with one lookahead, keeps text and state between chunks", async ({
  page,
}) => {
  const errors = await fixture(page);
  await page
    .getByRole("button", { name: "Read aloud", exact: true })
    .first()
    .click();
  await expect.poll(() => count(page)).toBe(1);
  expect(
    await page.evaluate(() => window.synth[0].text.length),
  ).toBeLessThanOrEqual(300);
  await page.evaluate(() => window.synth[0].resolve());
  await expect.poll(() => count(page)).toBe(2);
  await expect(page.locator("#voice-state")).toHaveText("Speaking…");
  await page.evaluate(() => window.players[0].end());
  await expect(page.locator("#voice-state")).toHaveText("Preparing speech…");
  expect(await page.evaluate(() => window.players.length)).toBe(1);
  await page.evaluate(() => window.synth[1].resolve());
  await expect.poll(() => count(page)).toBe(3);
  expect(await page.locator(".message-body").first().textContent()).toBe(reply);
  await page.locator("#interrupt").click();
  expect(
    await page.evaluate(() => window.synth.every((s) => s.signal.aborted)),
  ).toBe(true);
  expect(await page.evaluate(() => window.players.every((p) => p.paused))).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
for (const action of ["interrupt", "session", "new-read", "setup", "preview"])
  test(`${action} aborts synthesis; late result cannot overwrite newer speech`, async ({
    page,
  }) => {
    const errors = await fixture(page);
    await page
      .getByRole("button", { name: "Read aloud", exact: true })
      .first()
      .click();
    await expect.poll(() => count(page)).toBe(1);
    if (action === "interrupt") await page.locator("#interrupt").click();
    if (action === "session")
      await page.locator(".session").filter({ hasText: "Two" }).click();
    if (action === "new-read")
      await page
        .getByRole("button", { name: "Read aloud", exact: true })
        .nth(1)
        .click();
    if (action === "setup") await page.locator("#setup-open").click();
    if (action === "preview") {
      await page.locator("#settings-open").click();
      await page.locator("#voice-preview").click();
    }
    expect(await page.evaluate(() => window.synth[0].signal?.aborted)).toBe(
      true,
    );
    await page.evaluate(() => window.synth[0].resolve());
    if (action === "new-read") {
      await expect.poll(() => count(page)).toBe(2);
      await expect(page.locator("#voice-state")).toHaveText(
        "Preparing speech…",
      );
      await page.evaluate(() => window.synth[1].resolve());
      await expect(page.locator("#voice-state")).toHaveText("Speaking…");
    } else if (action !== "preview")
      expect(await page.evaluate(() => window.players.length)).toBe(0);
    expect(errors).toEqual([]);
  });
test("media failure stops later chunks and leaves explicit readable retry", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Read aloud", exact: true })
    .first()
    .click();
  await page.evaluate(() => window.synth[0].resolve());
  await expect.poll(() => count(page)).toBe(2);
  await page.evaluate(() => window.players[0].fail());
  await expect(page.locator("#notice-text")).toContainText(
    "Read aloud to retry",
  );
  expect(await page.evaluate(() => window.synth[1].signal.aborted)).toBe(true);
  await page.evaluate(() => window.synth[1].resolve());
  await expect(
    page.getByRole("button", { name: "Read aloud", exact: true }).first(),
  ).toBeEnabled();
  expect(await page.locator(".message-body").first().textContent()).toBe(reply);
  expect(await page.evaluate(() => window.players.length)).toBe(1);
});

test("late interrupt HTTP completion cannot reset new read-aloud status", async ({
  page,
}) => {
  await fixture(page);
  let release;
  await page.route("**/api/sessions/one/stop", async (route) => {
    await new Promise((r) => (release = r));
    await route.fulfill({ json: {} });
  });
  await page.locator("#interrupt").click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page
    .getByRole("button", { name: "Read aloud", exact: true })
    .nth(1)
    .click();
  await page.evaluate(() => window.synth[0].resolve());
  await expect(page.locator("#voice-state")).toHaveText("Speaking…");
  release();
  await expect(page.locator("#voice-state")).toHaveText("Speaking…");
});
test("mic gate stays closed between chunks and resumes only when speech ends", async ({
  page,
}) => {
  const errors = await fixture(page, true);
  let transcriptions = 0;
  await page.route("**/api/transcribe", (route) => {
    transcriptions++;
    return route.fulfill({ json: { text: "" } });
  });
  await page.locator("#microphone").click();
  await expect(page.locator("#voice-state")).toHaveText("Listening…");
  const utterance = () =>
    page.evaluate(async () => {
      for (let i = 0; i < 20; i++)
        await window.micPort.onmessage({
          data: new Float32Array(1600).fill(0.2),
        });
      for (let i = 0; i < 15; i++)
        await window.micPort.onmessage({ data: new Float32Array(1600) });
    });
  await page
    .getByRole("button", { name: "Read aloud", exact: true })
    .first()
    .click();
  await utterance();
  expect(transcriptions).toBe(0);
  await page.evaluate(() => window.synth[0].resolve());
  await expect.poll(() => count(page)).toBe(2);
  await page.evaluate(() => window.players[0].end());
  await expect(page.locator("#voice-state")).toHaveText("Preparing speech…");
  await utterance();
  expect(transcriptions).toBe(0);
  await page
    .getByRole("button", { name: "Read aloud", exact: true })
    .nth(1)
    .click();
  await page.evaluate(() => window.synth[2].resolve());
  await expect(page.locator("#voice-state")).toHaveText("Speaking…");
  await page.evaluate(() => window.players[1].end());
  await expect(page.locator("#voice-state")).toHaveText("Listening…");
  await utterance();
  expect(transcriptions).toBe(1);
  expect(errors).toEqual([]);
});

test("interrupted pending send cannot re-arm automatic speech or reset local status", async ({
  page,
}) => {
  await fixture(page);
  let release;
  await page.route("**/api/sessions/one/messages", async (route) => {
    await new Promise((r) => (release = r));
    await route.fulfill({ json: { id: "sent" } });
  });
  await page.locator("#message-input").fill("A pending message");
  await page.locator("#send").click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.locator("#interrupt").click();
  release();
  await expect(page.locator("#send")).toBeEnabled();
  await expect(page.locator("#voice-state")).toHaveText("Interrupted");
  await page.route("**/api/sessions/one", (route) =>
    route.fulfill({
      json: {
        session: { id: "one", title: "One" },
        messages: [
          { id: "reply", role: "assistant", content: reply },
          { id: "other", role: "assistant", content: "A different reply." },
          {
            id: "late",
            role: "assistant",
            content: "Late reply stays readable.",
          },
        ],
        tasks: [],
        approvals: [],
      },
    }),
  );
  await expect(
    page.getByText("Late reply stays readable.", { exact: true }),
  ).toBeVisible();
  expect(await count(page)).toBe(0);
});
