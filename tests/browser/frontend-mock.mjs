// Frontend-only mocked protocol smoke test. Not a real Hermes/provider E2E.
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
});
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    }),
    errors = [],
    writes = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sessions = [
    { id: "one", title: "First conversation", busy: false, archived: false },
    { id: "two", title: "Second conversation", busy: false, archived: false },
  ];
  const details = Object.fromEntries(
    sessions.map((session) => [
      session.id,
      { session, messages: [], tasks: [], approvals: [] },
    ]),
  );
  details.one.messages = [
    {
      id: "old",
      role: "assistant",
      content: "<img src=x onerror=alert(1)> Historical reply",
    },
  ];
  details.one.tasks = [
    { id: "chat", brief: "Chat turn", status: "completed", worker: false },
    { id: "work", brief: "Explicit worker", status: "running", worker: true },
  ];
  let settings = {
    model: "default",
    provider: "configured",
    fast_model: "",
    voice_provider: "none",
    voice: "",
    language: "en",
    hermes_available: true,
  };
  await page.route("http://frontend.test/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let data;
    if (path === "/") {
      return route.fulfill({
        contentType: "text/html",
        body: await readFile("src/hermes_voice/static/index.html", "utf8"),
      });
    }
    if (path.startsWith("/static/"))
      return route.fulfill({
        contentType: path.endsWith(".css") ? "text/css" : "text/javascript",
        body: await readFile("src/hermes_voice" + path, "utf8"),
      });
    if (req.method() !== "GET") {
      assert.equal(req.headers()["x-hermes-voice"], "browser");
      writes.push([path, req.postDataJSON()]);
    }
    if (path === "/api/settings") {
      if (req.method() === "PATCH")
        settings = { ...settings, ...req.postDataJSON() };
      data = settings;
    } else if (path === "/api/sessions") data = { sessions };
    else if (/^\/api\/sessions\/[^/]+$/.test(path))
      data = details[path.split("/").at(-1)];
    else if (path.endsWith("/messages")) {
      const id = path.split("/")[3],
        body = req.postDataJSON();
      details[id].messages.push({
        id: "new-user",
        role: "user",
        content: body.text,
      });
      data = { id: "submitted", status: "running" };
    } else data = { ok: true };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto("http://frontend.test");
  await page.locator(".message").waitFor();
  assert.equal(await page.locator(".message img").count(), 0);
  assert.equal(await page.locator("#tasks .task").count(), 1);
  await page.locator("#message-input").fill("Private draft");
  await page
    .locator(".session")
    .filter({ hasText: "Second conversation" })
    .click();
  assert.equal(await page.locator("#message-input").inputValue(), "");
  await page
    .locator(".session")
    .filter({ hasText: "First conversation" })
    .click();
  assert.equal(
    await page.locator("#message-input").inputValue(),
    "Private draft",
  );
  await page.locator("#worker-mode").check();
  await page.locator("#send").click();
  assert.ok(
    writes.some(
      ([p, b]) =>
        p.endsWith("/messages") &&
        b.worker === true &&
        b.text === "Private draft",
    ),
  );
  await page.locator("#theme").click();
  assert.equal(
    await page.locator("html").getAttribute("data-theme"),
    "daylight",
  );
  await page.locator("#settings-open").click();
  await page.locator("[name=fast_model]").fill("chat-override");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByText("Saved and verified.").waitFor();
  assert.equal(settings.fast_model, "chat-override");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator("#settings-dialog").evaluate((e) => e.open),
    false,
  );
  await page.locator("#interrupt").click();
  assert.ok(writes.some(([p]) => p === "/api/sessions/one/stop"));
  assert.ok(!writes.some(([p]) => p.includes("/cancel")));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: mocked browser XSS-safe rendering, worker-only cards, isolated drafts, explicit delegation/header, themes, settings/readback, modal Escape, interrupt scope, mobile overflow; no page errors.",
  );
} finally {
  await browser.close();
}
