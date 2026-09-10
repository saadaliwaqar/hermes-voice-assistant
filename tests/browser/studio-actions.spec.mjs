import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`Studio permission and worker controls keep their target at ${width}px`, async ({
    page,
  }) => {
    const calls = [];
    const session = {
      id: "studio-test-session",
      title: "Permission fixture",
      archived: false,
      busy: true,
    };
    let approvals = [
      {
        id: "studio-test-approval",
        task_id: "studio-test-worker",
        kind: "command",
        question: "Run this fixture command?",
        command: "printf fixture-only",
      },
    ];
    let tasks = [
      {
        id: "studio-test-worker",
        brief: "Fixture worker, no real command will run",
        status: "running",
        worker: true,
      },
    ];
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (req.method() !== "GET") {
        calls.push({ path, body: req.postDataJSON() });
        if (path === "/api/approvals/studio-test-approval") approvals = [];
        if (path === "/api/tasks/studio-test-worker/cancel")
          tasks = [{ ...tasks[0], status: "cancelled" }];
        return route.fulfill({ json: { ok: true } });
      }
      const values = {
        "/api/setup": { completed: true, checks: [], defaults: {} },
        "/api/settings": {
          model: "fixture",
          provider: "fixture",
          voice_provider: "none",
          voice: "",
          language: "en",
          hermes_available: true,
        },
        "/api/health": { ok: true, service: "hermes-voice" },
        "/api/sessions": { sessions: [session] },
        "/api/sessions/studio-test-session": {
          session,
          messages: [],
          tasks,
          approvals,
        },
      };
      return route.fulfill({ json: values[path] || {} });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.locator(".approval")).toBeVisible();
    await page
      .locator('input[aria-label="Answer to approval question"]')
      .fill("Not approved in fixture");
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await expect
      .poll(() =>
        calls.find((x) => x.path === "/api/approvals/studio-test-approval"),
      )
      .toEqual({
        path: "/api/approvals/studio-test-approval",
        body: { approved: false, answer: "Not approved in fixture" },
      });
    await page
      .getByRole("button", { name: "Cancel worker", exact: true })
      .click();
    await expect
      .poll(() =>
        calls.some((x) => x.path === "/api/tasks/studio-test-worker/cancel"),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    expect(
      calls.some((x) => /synthesize|transcribe|message/.test(x.path)),
    ).toBe(false);
  });
}
