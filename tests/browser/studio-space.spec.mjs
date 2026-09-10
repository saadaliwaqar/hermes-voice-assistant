import { test, expect } from "@playwright/test";

test("hiding the Studio core returns its column to the conversation", async ({
  page,
}) => {
  await page.route("**/api/setup", (route) =>
    route.fulfill({ json: { completed: true, checks: [], defaults: {} } }),
  );
  await page.goto("/");
  const initial = await page.locator("#messages").boundingBox();
  await page.locator("#message-input").fill("Keep my unsent draft");
  await page.locator("#orb-toggle").click();
  await expect(page.locator("#voice-orb-stage")).toHaveAttribute(
    "data-compact",
    "true",
  );
  await expect
    .poll(async () => (await page.locator("#messages").boundingBox()).width)
    .toBeGreaterThan(initial.width * 1.4);
  await expect(page.locator("#message-input")).toHaveValue(
    "Keep my unsent draft",
  );
  await expect(page.locator("#microphone")).toBeVisible();
  await expect(page.locator("#interrupt")).toBeVisible();
  await page.locator("#orb-toggle").click();
  await expect
    .poll(async () => (await page.locator("#messages").boundingBox()).width)
    .toBeCloseTo(initial.width, 0);
});
