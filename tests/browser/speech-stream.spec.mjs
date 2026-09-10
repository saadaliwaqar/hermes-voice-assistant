import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function fixture(page, query = "?stream=1", fakeMic = false) {
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
  const model = {
    text: "",
    revision: 0,
    final: null,
    status: "running",
    sent: false,
    body: null,
    streamTask: "owned",
    streamSession: null,
  };
  await page.addInitScript(() => {
    window.synth = [];
    window.players = [];
    const fetch = window.fetch.bind(window);
    window.fetch = (url, options) =>
      String(url) === "/api/synthesize"
        ? new Promise((resolve) =>
            window.synth.push({
              text: JSON.parse(options.body).text,
              signal: options.signal,
              resolve: () => resolve(new Response(new Blob(["test"]))),
            }),
          )
        : fetch(url, options);
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
        addEventListener() {},
        removeEventListener() {},
      };
      window.players.push(p);
      return p;
    };
  });
  await page.route("http://stream.test/**", async (route) => {
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
    if (path.endsWith("/messages")) {
      model.sent = true;
      model.body = route.request().postDataJSON();
      json = { id: "owned", status: "running" };
    }
    if (/^\/api\/sessions\/(one|two)$/.test(path)) {
      const id = path.split("/").at(-1);
      json = {
        session: { id, title: id === "one" ? "One" : "Two" },
        messages:
          model.final === null
            ? []
            : [{ id: "final", role: "assistant", content: model.final }],
        tasks: model.sent
          ? [
              {
                id: "owned",
                worker: false,
                status: model.final === null ? model.status : "completed",
                result: model.final,
              },
            ]
          : [],
        streams:
          model.sent && model.final === null
            ? [
                {
                  task_id: model.streamTask,
                  session_id: model.streamSession || id,
                  text: model.text,
                  revision: model.revision,
                },
              ]
            : [],
        approvals: [],
      };
    }
    return route.fulfill({ json });
  });
  await page.goto("http://stream.test/" + query);
  await expect(page.locator("#session-title")).toHaveText("One");
  return model;
}
async function send(page) {
  await page.locator("#message-input").fill("Explain");
  await page.locator("#send").click();
}
const count = (page) => page.evaluate(() => window.synth.length);
test("owned early sentence before final, suffix once and provisional replaced", async ({
  page,
}) => {
  const m = await fixture(page);
  await send(page);
  expect(m.body.stream).toBe(true);
  m.text = "First sentence. Pending";
  m.revision++;
  await expect.poll(() => count(page)).toBe(1);
  await expect(page.locator("#stream-preview")).toContainText(m.text);
  expect(m.final).toBeNull();
  await expect(page.locator(".message.assistant .message-body")).toHaveCount(0);
  await page.evaluate(() => window.synth[0].resolve());
  await expect(page.locator("#voice-state")).toHaveText("Speaking…");
  await page.evaluate(() => window.players[0].end());
  await expect(page.locator("#voice-state")).toHaveText("Preparing speech…");
  m.final = "First sentence. Pending suffix";
  await expect.poll(() => count(page)).toBe(2);
  expect(
    await page.evaluate(() => window.synth.map((x) => x.text).join("")),
  ).toBe(m.final);
  await expect(page.locator("#stream-preview")).toHaveCount(0);
  await page.evaluate(() => window.synth[1].resolve());
  await expect.poll(() => page.evaluate(() => window.players.length)).toBe(2);
  await page.evaluate(() => window.players[1].end());
  await page.waitForTimeout(1000);
  expect(await count(page)).toBe(2);
});
for (const action of [
  "interrupt",
  "session",
  "trial",
  "speech",
  "reload",
  "settings",
  "setup",
  "mode",
])
  test(`${action} discards late tokens and final`, async ({ page }) => {
    const m = await fixture(page);
    await send(page);
    m.text = "Early sentence. ";
    m.revision++;
    await expect.poll(() => count(page)).toBe(1);
    if (action === "interrupt") await page.locator("#interrupt").click();
    if (action === "session")
      await page.locator(".session").filter({ hasText: "Two" }).click();
    if (action === "trial") await page.locator("#stream-replies").uncheck();
    if (action === "speech") await page.locator("#auto-speech").uncheck();
    if (action === "settings") await page.locator("#settings-open").click();
    if (action === "setup") await page.locator("#setup-open").click();
    if (action === "mode") await page.locator("#worker-mode").check();
    if (action === "reload") await page.reload();
    else {
      expect(await page.evaluate(() => window.synth[0].signal.aborted)).toBe(
        true,
      );
      await page.evaluate(() => window.synth[0].resolve());
    }
    m.text += "Late sentence. ";
    m.revision++;
    await page.waitForTimeout(900);
    m.final = m.text + "Done";
    await page.waitForTimeout(1000);
    expect(await count(page)).toBe(action === "reload" ? 0 : 1);
    expect(await page.evaluate(() => window.players.length)).toBe(0);
  });
test("missing callback final once", async ({ page }) => {
  const m = await fixture(page, "");
  await expect(page.locator("#stream-replies")).not.toBeChecked();
  await page.locator("#stream-replies").check();
  await send(page);
  m.final = "Final only";
  await expect.poll(() => count(page)).toBe(1);
  expect(await page.evaluate(() => window.synth[0].text)).toBe(m.final);
  await page.waitForTimeout(1000);
  expect(await count(page)).toBe(1);
});
test("explicit query opt-in is consumed and opt-out survives reload", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.locator("#stream-replies")).toBeChecked();
  expect(new URL(page.url()).searchParams.has("stream")).toBe(false);
  await page.locator("#stream-replies").uncheck();
  await page.reload();
  await expect(page.locator("#stream-replies")).not.toBeChecked();
});
for (const mode of ["off", "worker"])
  test(`${mode} send omits stream opt-in`, async ({ page }) => {
    const m = await fixture(page, mode === "off" ? "" : "?stream=1");
    if (mode === "worker") await page.locator("#worker-mode").check();
    await send(page);
    expect(m.body).not.toHaveProperty("stream");
  });
test("stale acknowledgement cannot acquire ownership after interrupt", async ({
  page,
}) => {
  const m = await fixture(page);
  let release;
  await page.route("**/api/sessions/one/messages", async (route) => {
    m.sent = true;
    await new Promise((r) => (release = r));
    await route.fulfill({ json: { id: "owned" } });
  });
  await send(page);
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.locator("#interrupt").click();
  release();
  await expect(page.locator("#send")).toBeEnabled();
  m.text = "Late sentence. ";
  m.revision++;
  await page.waitForTimeout(900);
  m.final = m.text;
  await page.waitForTimeout(900);
  expect(await count(page)).toBe(0);
});
test("mic stays gated in sentence arrival gaps and resumes after final audio", async ({
  page,
}) => {
  const m = await fixture(page, "?stream=1", true);
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
  await send(page);
  await utterance();
  expect(transcriptions).toBe(0);
  m.text = "Early sentence. ";
  m.revision++;
  await expect.poll(() => count(page)).toBe(1);
  await page.evaluate(() => window.synth[0].resolve());
  await expect(page.locator("#voice-state")).toHaveText("Speaking…");
  await page.evaluate(() => window.players[0].end());
  await expect(page.locator("#voice-state")).toHaveText("Preparing speech…");
  await utterance();
  expect(transcriptions).toBe(0);
  m.final = m.text + "Final suffix";
  await expect.poll(() => count(page)).toBe(2);
  await utterance();
  expect(transcriptions).toBe(0);
  await page.evaluate(() => window.synth[1].resolve());
  await expect(page.locator("#voice-state")).toHaveText("Speaking…");
  await page.evaluate(() => window.players[1].end());
  await expect(page.locator("#voice-state")).toHaveText("Listening…");
  await utterance();
  expect(transcriptions).toBe(1);
});
test("cancelled task drops queued speech and no final replay", async ({
  page,
}) => {
  const m = await fixture(page);
  await send(page);
  m.text = "Early sentence. ";
  m.revision++;
  await expect.poll(() => count(page)).toBe(1);
  m.status = "cancelled";
  await expect(page.locator("#notice-text")).toContainText("stopped");
  expect(await page.evaluate(() => window.synth[0].signal.aborted)).toBe(true);
  m.final = "Late result";
  await page.waitForTimeout(1000);
  expect(await count(page)).toBe(1);
});
test("snapshots cannot grant ownership; foreign task/session and old revisions are ignored", async ({
  page,
}) => {
  const m = await fixture(page);
  m.sent = true;
  m.streamTask = "background-task";
  m.text = "Background sentence. ";
  m.revision = 1;
  await page.waitForTimeout(1000);
  expect(await count(page)).toBe(0);
  await send(page);
  m.streamTask = "foreign";
  m.text = "Foreign sentence. ";
  m.revision = 2;
  await page.waitForTimeout(1000);
  expect(await count(page)).toBe(0);
  m.streamTask = "owned";
  m.streamSession = "two";
  m.revision = 3;
  await page.waitForTimeout(500);
  expect(await count(page)).toBe(0);
  m.streamSession = null;
  m.text = "Owned sentence. ";
  m.revision = 4;
  await expect.poll(() => count(page)).toBe(1);
  m.text = "Stale rewrite. ";
  m.revision = 2;
  await page.waitForTimeout(500);
  await expect(page.locator("#stream-preview")).toContainText(
    "Owned sentence.",
  );
  m.final = "Owned sentence. Final suffix";
  await page.evaluate(() => window.synth[0].resolve());
  await expect.poll(() => count(page)).toBe(2);
  expect(
    await page.evaluate(() => window.synth.map((x) => x.text).join("")),
  ).toBe(m.final);
});
test("provider failure never replays final and final remains readable", async ({
  page,
}) => {
  const m = await fixture(page);
  await send(page);
  m.text = "Early sentence. ";
  m.revision++;
  await expect.poll(() => count(page)).toBe(1);
  await page.evaluate(() => window.synth[0].resolve());
  await expect(page.locator("#voice-state")).toHaveText("Speaking…");
  await page.evaluate(() => window.players[0].onerror());
  await expect(page.locator("#notice-text")).toContainText("Read aloud");
  m.final = m.text + "Final suffix";
  await expect(page.locator(".message-body")).toHaveText(m.final);
  await page.waitForTimeout(1000);
  expect(await count(page)).toBe(1);
});
test("changed prefix warns and never replays authoritative final", async ({
  page,
}) => {
  const m = await fixture(page);
  await send(page);
  m.text = "Early sentence. ";
  m.revision++;
  await expect.poll(() => count(page)).toBe(1);
  m.final = "Different authoritative reply.";
  await expect(page.locator("#notice-text")).toContainText("changed");
  await expect(page.locator(".message-body")).toHaveText(m.final);
  await page.waitForTimeout(1000);
  expect(await count(page)).toBe(1);
});
