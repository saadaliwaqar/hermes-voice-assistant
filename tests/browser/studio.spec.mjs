import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/setup", (route) =>
    route.fulfill({ json: { completed: true, checks: [], defaults: {} } }),
  );
});

test("Studio defaults to a side-by-side workspace with immediate persistent Classic fallback", async ({
  page,
}) => {
  await page.goto("/");
  const toggle = page.getByRole("button", {
    name: "Switch to Classic layout",
    exact: true,
  });
  await expect(toggle).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "studio");
  const orb = await page.locator("#voice-orb-stage").boundingBox();
  const transcript = await page.locator("#messages").boundingBox();
  expect(orb.x + orb.width).toBeLessThanOrEqual(transcript.x);
  await page.locator("#message-input").fill("Unsent layout-switch draft");
  await page.locator("#worker-mode").check();
  await page.locator("#hands-free").uncheck();
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "classic");
  await expect(page.locator(".conversation")).toHaveCSS("display", "flex");
  await expect(page.locator("#message-input")).toHaveValue(
    "Unsent layout-switch draft",
  );
  await expect(page.locator("#worker-mode")).toBeChecked();
  await expect(page.locator("#hands-free")).not.toBeChecked();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "classic");
  await page
    .getByRole("button", { name: "Switch to Studio layout", exact: true })
    .click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "studio");
});

test("Studio keeps sessions, tasks and voice controls reachable on small screens and Daylight", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const selector of [
      "#new-session",
      "#search",
      "#show-archived",
      "#tasks",
      "#approvals",
      "#microphone",
      "#interrupt",
      "#auto-speech",
      "#hands-free",
      "#send",
      "#layout-toggle",
    ]) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await expect(page.locator(selector)).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await expect(page.locator("#layout-toggle")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  expect(errors).toEqual([]);
});

test("layout fallback works even if application module fails and storage is unavailable", async ({
  page,
}) => {
  await page.route("**/static/app.mjs", (route) => route.abort());
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage blocked");
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Switch to Classic layout", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "classic");
  await page
    .getByRole("button", { name: "Switch to Studio layout", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "studio");
});
