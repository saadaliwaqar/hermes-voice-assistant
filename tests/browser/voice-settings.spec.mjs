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
async function setup(page) {
  const writes = [],
    previews = [],
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
        /\/api\/(voices|voice-preview)/.test(String(url))
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
    let body = {};
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
  return { writes, previews, errors };
}
const provider = (page) => page.locator('[name="voice_provider"]');
const voice = (page) => page.locator('[name="voice"]');
const playing = (page) =>
  page.evaluate(
    () => window.players.filter((p) => !p.paused && !p.ended).length,
  );

test("provider catalog is searchable, drafts are isolated, and Save alone persists", async ({
  page,
}) => {
  const { writes, previews, errors } = await setup(page);
  await page.locator("#settings-open").click();
  await expect(page.locator("#voice-picker option")).toHaveCount(3);
  await page.locator("#voice-search").fill("Sonia");
  await expect(page.locator("#voice-picker option")).toHaveCount(2);
  await page.locator("#voice-picker").selectOption("en-GB-SoniaNeural");
  await expect(voice(page)).toHaveValue("en-GB-SoniaNeural");
  await provider(page).selectOption("openai");
  await expect(voice(page)).toHaveValue("");
  await page.locator("#voice-picker").selectOption("nova");
  await page.locator("#voice-preview").click();
  await expect.poll(() => playing(page)).toBe(1);
  expect(previews).toEqual([{ provider: "openai", voice: "nova" }]);
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect.poll(() => playing(page)).toBe(0);
  await page.locator("#settings-open").click();
  await expect(provider(page)).toHaveValue("edge");
  await expect(voice(page)).toHaveValue("en-US-AriaNeural");
  await provider(page).selectOption("piper");
  await page.locator("#voice-picker").selectOption("en_US-lessac-medium");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("#settings-status")).toHaveText(
    "Saved and verified.",
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    voice_provider: "piper",
    voice: "en_US-lessac-medium",
  });
  expect(Object.keys(writes[0]).sort()).toEqual([
    "fast_model",
    "language",
    "model",
    "provider",
    "voice",
    "voice_provider",
  ]);
  expect(errors).toEqual([]);
});

test("late catalogs cannot replace newer provider or closed-dialog state; unavailable metadata allows manual IDs", async ({
  page,
}) => {
  await setup(page);
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  await page.route("**/api/voices?provider=edge", async (route) => {
    await pending;
    await route
      .fulfill({
        json: { voices: catalogs.edge, available: true, message: "Stale Edge" },
      })
      .catch(() => {});
  });
  await page.locator("#settings-open").click();
  await provider(page).selectOption("openai");
  await expect(page.locator("#voice-picker")).toContainText("Nova");
  release();
  await page.waitForTimeout(150);
  await expect(page.locator("#voice-picker")).not.toContainText("Aria");
  await provider(page).selectOption("elevenlabs");
  await expect(page.locator("#voice-readiness")).toContainText(
    "ELEVENLABS_API_KEY",
  );
  await voice(page).fill("my-private-voice-id");
  await expect(voice(page)).toHaveValue("my-private-voice-id");
  await provider(page).selectOption("none");
  await expect(voice(page)).toHaveValue("");
  await expect(page.locator("#voice-preview")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-dialog")).not.toBeVisible();
});

test("preview stops capture and shared playback cancels on edits, stop, close, session switch and Interrupt", async ({
  page,
}) => {
  const { errors } = await setup(page);
  await page.locator("#microphone").click();
  await expect(page.locator("body")).toHaveClass(/listening/);
  await page.locator("#settings-open").click();
  const preview = async () => {
    await page.locator("#voice-preview").click();
    await expect.poll(() => playing(page)).toBe(1);
  };
  await preview();
  expect(
    await page.evaluate(() =>
      window.streams
        .flatMap((s) => s.getTracks())
        .every((t) => t.readyState === "ended"),
    ),
  ).toBe(true);
  await expect(page.locator("#microphone")).toHaveText("Start mic");
  await page.locator("#voice-preview-stop").click();
  await expect.poll(() => playing(page)).toBe(0);
  await preview();
  await voice(page).fill("different");
  await expect.poll(() => playing(page)).toBe(0);
  await preview();
  await provider(page).selectOption("openai");
  await expect.poll(() => playing(page)).toBe(0);
  await preview();
  // Modal makes background controls inert to pointers; invoke their actual handlers.
  await page.locator("#interrupt").evaluate((b) => b.click());
  await expect.poll(() => playing(page)).toBe(0);
  await preview();
  await page
    .locator("#sessions button")
    .nth(1)
    .evaluate((b) => b.click());
  await expect.poll(() => playing(page)).toBe(0);
  await preview();
  await page.keyboard.press("Escape");
  await expect.poll(() => playing(page)).toBe(0);
  expect(errors).toEqual([]);
});

test("late responses from a closed draft cannot affect a reopened dialog", async ({
  page,
}) => {
  await setup(page);
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  await page.route("**/api/voices?provider=openai", async (route) => {
    await pending;
    await route.fulfill({
      json: { voices: catalogs.openai, available: true, message: "Old draft" },
    });
  });
  await page.route("**/api/voice-preview", async (route) => {
    await pending;
    await route.fulfill({ contentType: "audio/wav", body: wav() });
  });
  await page.locator("#settings-open").click();
  await provider(page).selectOption("openai");
  await page.locator("#voice-preview").click();
  await page.keyboard.press("Escape");
  await page.locator("#settings-open").click();
  await expect(provider(page)).toHaveValue("edge");
  await expect(page.locator("#voice-picker")).toContainText("Aria");
  release();
  await page.waitForTimeout(200);
  await expect(page.locator("#voice-picker")).not.toContainText("Nova");
  expect(await page.evaluate(() => window.players.length)).toBe(0);
  await expect(page.locator("#voice-preview-stop")).toBeDisabled();
});

test("preview replaces foreground speech without overlapping audio", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Read aloud" }).click();
  await expect.poll(() => playing(page)).toBe(1);
  await page.locator("#settings-open").click();
  await page.locator("#voice-preview").click();
  await expect(page.locator("#voice-preview-status")).toContainText(
    "Playing preview",
  );
  expect(await playing(page)).toBe(1);
  expect(await page.evaluate(() => window.players[0].paused)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => playing(page)).toBe(0);
});

test("natural preview completion resets controls; orb and mobile settings remain usable", async ({
  page,
}) => {
  const { errors } = await setup(page);
  await expect(page.locator("#voice-orb-stage")).toBeVisible();
  await page.locator("#orb-toggle").click();
  await expect(page.locator("#voice-orb-stage")).toHaveAttribute(
    "data-compact",
    "true",
  );
  await page.locator("#orb-toggle").click();
  await page.locator("#theme").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#settings-open").click();
  await page.locator("#voice-preview").click();
  await expect.poll(() => playing(page)).toBe(1);
  await expect(page.locator("#voice-preview")).toBeDisabled();
  await expect(page.locator("#voice-preview-status")).toContainText(
    "Preview finished",
    { timeout: 7000 },
  );
  await expect(page.locator("#voice-preview")).toBeEnabled();
  await expect(page.locator("#voice-preview-stop")).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(
    await page
      .locator("#settings-dialog")
      .evaluate((d) => d.scrollWidth > d.clientWidth),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("late preview is discarded after close and request/media errors recover", async ({
  page,
}) => {
  const { writes, errors } = await setup(page);
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  await page.route("**/api/voice-preview", async (route) => {
    await pending;
    await route
      .fulfill({ contentType: "audio/wav", body: wav() })
      .catch(() => {});
  });
  await page.locator("#settings-open").click();
  await page.locator("#voice-preview").click();
  await expect(page.locator("#voice-preview-stop")).toBeEnabled();
  await page.keyboard.press("Escape");
  release();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.players.length)).toBe(0);
  await page.unroute("**/api/voice-preview");
  await page.route("**/api/voice-preview", (route) =>
    route.fulfill({ status: 503, json: { detail: "Provider not configured" } }),
  );
  await page.locator("#settings-open").click();
  await page.locator("#voice-preview").click();
  await expect(page.locator("#voice-preview-status")).toContainText(
    "Provider not configured",
  );
  await expect(page.locator("#voice-preview")).toBeEnabled();
  await page.unroute("**/api/voice-preview");
  await page.route("**/api/voice-preview", (route) =>
    route.fulfill({ contentType: "audio/wav", body: "invalid audio" }),
  );
  await page.locator("#voice-preview").click();
  await expect(page.locator("#voice-preview-status")).toContainText("playback");
  await expect(page.locator("#voice-preview-stop")).toBeDisabled();
  await page.route("**/api/voices?provider=elevenlabs", (route) =>
    route.fulfill({ status: 503, json: { detail: "Catalog offline" } }),
  );
  await provider(page).selectOption("elevenlabs");
  await expect(page.locator("#voice-readiness")).toContainText(
    "Catalog offline",
  );
  await voice(page).fill("manual-id");
  await expect(voice(page)).toBeEditable();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
