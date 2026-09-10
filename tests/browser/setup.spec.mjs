import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// A private static origin plus in-memory API fixtures: never touch user settings.
let server, origin;
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const path =
        req.url === "/" ? "index.html" : req.url.replace(/^\/static\//, "");
      if (!/^[\w.-]+$/.test(path)) throw new Error("Not found");
      const body = await readFile(
        new URL(`../../src/hermes_voice/static/${path}`, import.meta.url),
      );
      res.setHeader(
        "Content-Type",
        path.endsWith("html")
          ? "text/html"
          : path.endsWith("css")
            ? "text/css"
            : "text/javascript",
      );
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin =
    process.env.HERMES_VOICE_TEST_URL ||
    `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise((resolve) => server.close(resolve)));

function wav() {
  const rate = 16000,
    frames = rate * 4,
    b = Buffer.alloc(44 + frames * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    b.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 220) / rate) * 1500),
      44 + i * 2,
    );
  return b;
}
const catalogs = {
  edge: [
    { id: "en-US-AriaNeural", name: "Aria · English" },
    { id: "en-GB-SoniaNeural", name: "Sonia · British" },
  ],
  openai: [
    { id: "alloy", name: "Alloy" },
    { id: "nova", name: "Nova" },
  ],
  piper: [{ id: "en_US-lessac-medium", name: "Lessac (installed)" }],
  elevenlabs: [],
  none: [],
};
async function setup(page, { completed = false, unavailable = false } = {}) {
  const writes = [],
    previews = [],
    modelChecks = [],
    requests = [],
    errors = [];
  let settings = {
    provider: "test",
    model: "test",
    fast_model: "",
    voice_provider: "edge",
    voice: "en-US-AriaNeural",
    language: "en",
    hermes_available: true,
  };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.players = [];
    window.streams = [];
    // Simulate transports that complete despite abort, exercising epoch guards too.
    const fetch = window.fetch.bind(window);
    window.fetch = (url, options) =>
      fetch(
        url,
        /\/api\/(voices|voice-preview|setup)/.test(String(url))
          ? { ...options, signal: undefined }
          : options,
      );
    const Audio = window.Audio;
    window.Audio = function (...args) {
      const audio = new Audio(...args);
      window.players.push(audio);
      return audio;
    };
    const get = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await get(...args);
      window.streams.push(stream);
      return stream;
    };
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    requests.push([route.request().method(), path]);
    let body = {};
    if (path === "/api/setup")
      return route.fulfill(
        unavailable
          ? { status: 404, json: { detail: "Not found" } }
          : {
              json: {
                completed,
                checks: [
                  {
                    id: "runtime",
                    label: "Hermes runtime",
                    status: "missing",
                    detail: "Install Hermes on the server",
                  },
                  {
                    id: "provider",
                    label: "Provider",
                    status: "warning",
                    detail: "Not tested",
                  },
                ],
                defaults: settings,
              },
            },
      );
    if (path === "/api/setup/complete") {
      completed = true;
      return route.fulfill({ json: { completed: true } });
    }
    if (path === "/api/setup/test-model") {
      modelChecks.push(route.request().postDataJSON());
      return route.fulfill({
        json: { ok: true, message: "Connection verified" },
      });
    }
    if (path === "/api/settings") {
      if (route.request().method() === "PATCH") {
        writes.push(route.request().postDataJSON());
        settings = { ...settings, ...writes.at(-1) };
      }
      body = settings;
    } else if (path === "/api/sessions")
      body = {
        sessions: [
          { id: "one", title: "One" },
          { id: "two", title: "Two" },
        ],
      };
    else if (/^\/api\/sessions\/(one|two)$/.test(path))
      body = {
        session: {
          id: path.split("/").at(-1),
          title: path.endsWith("one") ? "One" : "Two",
        },
        messages: [{ id: "reply", role: "assistant", content: "Test reply" }],
        tasks: [],
        approvals: [],
      };
    else if (path === "/api/voices")
      body = {
        voices: catalogs[url.searchParams.get("provider")],
        available: url.searchParams.get("provider") !== "elevenlabs",
        message:
          url.searchParams.get("provider") === "elevenlabs"
            ? "Configure ELEVENLABS_API_KEY; manual voice ID supported."
            : "Provider ready",
      };
    else if (path === "/api/synthesize")
      return route.fulfill({ contentType: "audio/wav", body: wav() });
    else if (path === "/api/voice-preview") {
      previews.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "audio/wav", body: wav() });
    }
    return route.fulfill({ json: body });
  });
  await page.goto(origin);
  await expect(page.locator("#session-title")).toHaveText("One");
  return { writes, previews, errors, modelChecks, requests };
}

const next = (page) =>
  page.getByRole("button", { name: "Next", exact: true }).click();
test("first run is passive, dismissible and reopenable with honest flags", async ({
  page,
}) => {
  const f = await setup(page);
  await expect(
    page.getByRole("dialog", { name: "Welcome to Hermes" }),
  ).toBeVisible();
  await expect(page.locator("#setup-dialog")).toContainText("missing");
  await expect(page.locator("#setup-dialog")).toContainText("warning");
  await expect(page.locator("#setup-dialog")).toContainText(
    "does not mean chat is ready",
  );
  expect(f.modelChecks).toEqual([]);
  expect(f.previews).toEqual([]);
  expect(f.writes).toEqual([]);
  expect(await page.evaluate(() => window.streams.length)).toBe(0);
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.locator("#setup-dialog")).not.toBeVisible();
  await page.locator("#setup-open").click();
  await expect(page.locator("#setup-dialog")).toBeVisible();
  expect(f.requests.filter(([m]) => m !== "GET")).toEqual([]);
});
test("missing setup endpoint and completed installs keep dashboard usable", async ({
  page,
}) => {
  await setup(page, { unavailable: true });
  await expect(page.locator("#setup-dialog")).not.toBeVisible();
  await page.locator("#setup-open").click();
  await expect(page.locator("#setup-dialog")).toContainText(
    "Setup status unavailable",
  );
  await page.keyboard.press("Escape");
  await page.locator("#settings-open").click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
});
test("model check is explicit billable opt-in and stale checks cannot validate edited or cancelled drafts", async ({
  page,
}) => {
  const f = await setup(page);
  let release;
  const pending = new Promise((r) => (release = r));
  await page.route("**/api/setup/test-model", async (route) => {
    await pending;
    await route.fulfill({ json: { ok: true, message: "OLD success" } });
  });
  await next(page);
  await expect(page.locator("#setup-dialog")).toContainText(
    "may incur a small charge",
  );
  await page.locator("#setup-model").fill("draft-model");
  await page.getByRole("button", { name: "Test connection" }).click();
  await page.locator("#setup-model").fill("new-model");
  release();
  await expect(page.locator("#setup-model-result")).toContainText("Not tested");
  await page.keyboard.press("Escape");
  await page.locator("#setup-open").click();
  await next(page);
  await expect(page.locator("#setup-model")).toHaveValue("test");
  expect(f.writes).toEqual([]);
});
test("save reads back before finish, voice catalog guides selection and preview uses selected provider", async ({
  page,
}) => {
  const f = await setup(page);
  await next(page);
  await page.locator("#setup-model").fill("chosen");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.locator("#setup-model-result")).toContainText(
    "Connection verified",
  );
  expect(f.modelChecks).toEqual([{ model: "chosen", provider: "test" }]);
  await next(page);
  await page.locator("#setup-voice-provider").selectOption("openai");
  await expect(page.locator("#setup-voice-picker")).toContainText("Nova");
  await page.locator("#setup-voice-picker").selectOption("nova");
  await next(page);
  await page.getByRole("button", { name: "Test speaker" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.players.filter((p) => !p.paused && !p.ended).length,
      ),
    )
    .toBe(1);
  expect(f.previews).toEqual([{ provider: "openai", voice: "nova" }]);
  expect(await page.evaluate(() => window.streams.length)).toBe(0);
  await next(page);
  await expect
    .poll(() => page.evaluate(() => window.players.every((p) => p.paused)))
    .toBe(true);
  await page.getByRole("button", { name: "Save choices" }).click();
  await expect(page.locator("#setup-save-result")).toHaveText(
    "Saved and verified.",
  );
  expect(f.writes).toHaveLength(1);
  expect(
    f.requests.slice(
      f.requests.findIndex(([m]) => m === "PATCH"),
      f.requests.findIndex(([m]) => m === "PATCH") + 2,
    ),
  ).toEqual([
    ["PATCH", "/api/settings"],
    ["GET", "/api/settings"],
  ]);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.locator("#setup-dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.locator("#setup-open")).toBeVisible();
  await expect(page.locator("#setup-dialog")).not.toBeVisible();
  expect(f.errors).toEqual([]);
});
test("mic test never transcribes and releases tracks on step, session, exit and late permission", async ({
  page,
}) => {
  const f = await setup(page);
  await next(page);
  await next(page);
  await next(page);
  const start = () =>
    page.getByRole("button", { name: "Test microphone", exact: true }).click();
  const ended = () =>
    page.evaluate(() =>
      window.streams
        .flatMap((s) => s.getTracks())
        .every((t) => t.readyState === "ended"),
    );
  await start();
  await expect(page.locator("#setup-audio-result")).toContainText(
    "Microphone active",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect.poll(ended).toBe(true);
  await next(page);
  await start();
  await expect(page.locator("#setup-audio-result")).toContainText(
    "Microphone active",
  );
  await page
    .locator("#sessions button")
    .nth(1)
    .evaluate((b) => b.click());
  await expect.poll(ended).toBe(true);
  await start();
  await expect(page.locator("#setup-audio-result")).toContainText(
    "Microphone active",
  );
  await page.keyboard.press("Escape");
  await expect.poll(ended).toBe(true);
  await page.locator("#setup-open").click();
  await next(page);
  await next(page);
  await next(page);
  await page.evaluate(() => {
    const get = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const s = await get(...args);
      await new Promise((r) => (window.releaseMic = r));
      return s;
    };
  });
  await start();
  await expect.poll(() => page.evaluate(() => !!window.releaseMic)).toBe(true);
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.releaseMic());
  await expect.poll(ended).toBe(true);
  expect(f.requests.some(([, p]) => p === "/api/transcribe")).toBe(false);
  expect(f.errors).toEqual([]);
});

test("cancelled model results and late speaker responses cannot affect a reopened wizard", async ({
  page,
}) => {
  await setup(page);
  let release;
  const pending = new Promise((r) => (release = r));
  await page.route("**/api/setup/test-model", async (route) => {
    await pending;
    await route.fulfill({ json: { ok: true, message: "OLD closed result" } });
  });
  await next(page);
  await page.locator("#setup-test-model").click();
  await page.keyboard.press("Escape");
  await page.locator("#setup-open").click();
  await next(page);
  release();
  await page.waitForTimeout(100);
  await expect(page.locator("#setup-model-result")).toContainText("Not tested");
  let releaseAudio;
  const audioPending = new Promise((r) => (releaseAudio = r));
  await page.route("**/api/voice-preview", async (route) => {
    await audioPending;
    await route.fulfill({ contentType: "audio/wav", body: wav() });
  });
  await next(page);
  await next(page);
  await page.locator("#setup-speaker").click();
  await page.keyboard.press("Escape");
  await page.locator("#setup-open").click();
  releaseAudio();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.players.length)).toBe(0);
});
test("read-back mismatch and completion failure never claim success", async ({
  page,
}) => {
  await setup(page);
  await next(page);
  await page.locator("#setup-model").fill("not-saved");
  await next(page);
  await next(page);
  await next(page);
  await expect(page.locator("#setup-finish")).toBeDisabled();
  await page.route("**/api/settings", async (route) =>
    route.fulfill({
      json: {
        model: "different",
        provider: "test",
        voice_provider: "edge",
        voice: "en-US-AriaNeural",
        language: "en",
        fast_model: "",
      },
    }),
  );
  await page.locator("#setup-save").click();
  await expect(page.locator("#setup-save-result")).toContainText(
    "read-back differs",
  );
  await expect(page.locator("#setup-finish")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.locator("#setup-open").click();
  await next(page);
  await next(page);
  await next(page);
  await next(page);
  await page.route("**/api/setup/complete", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Setup storage unavailable" },
    }),
  );
  await page.locator("#setup-finish").click();
  await expect(page.locator("#setup-error")).toContainText(
    "Setup storage unavailable",
  );
  await expect(page.locator("#setup-dialog")).toBeVisible();
});
test("speaker playback releases on stop, session and exit; None skips speech and mobile steps fit", async ({
  page,
}) => {
  const f = await setup(page);
  await next(page);
  await next(page);
  await next(page);
  const play = async () => {
    await page.locator("#setup-speaker").click();
    await expect
      .poll(() =>
        page.evaluate(() => window.players.some((p) => !p.paused && !p.ended)),
      )
      .toBe(true);
  };
  const paused = () =>
    page.evaluate(() => window.players.every((p) => p.paused));
  await play();
  await page.locator("#setup-stop").click();
  await expect.poll(paused).toBe(true);
  await play();
  await page
    .locator("#sessions button")
    .nth(1)
    .evaluate((b) => b.click());
  await expect.poll(paused).toBe(true);
  await play();
  await page.keyboard.press("Escape");
  await expect.poll(paused).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#setup-open").click();
  for (let i = 0; i < 5; i++) {
    if (i === 2) {
      await page.locator("#setup-voice-provider").selectOption("none");
      await expect(page.locator("#setup-voice-readiness")).toContainText(
        "Speech is off",
      );
    }
    if (i === 3) await expect(page.locator("#setup-speaker")).toBeDisabled();
    expect(
      await page
        .locator("#setup-dialog")
        .evaluate((d) => d.scrollWidth <= d.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (i === 0)
      await page.screenshot({
        path: ".local/setup-agent-results/welcome-mobile.png",
      });
    if (i < 4) await next(page);
  }
  await page.screenshot({
    path: ".local/setup-agent-results/review-mobile.png",
  });
  expect(f.errors).toEqual([]);
});
