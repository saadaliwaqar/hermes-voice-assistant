import { test, expect } from "@playwright/test";

test("voice orb renders, follows theme, and can collapse without losing controls", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Keep orb assertions independent of first-run completion state.
  await page.route("**/api/setup", (route) =>
    route.fulfill({ json: { completed: true, checks: [], defaults: {} } }),
  );
  await page.goto("/");
  const stage = page.locator("#voice-orb-stage");
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute("data-phase", "standby");
  const canvas = await page.locator("#voice-orb").boundingBox();
  expect(canvas.height).toBeGreaterThan(150);
  expect(
    await page.locator("#voice-orb").evaluate((c) => {
      const data = c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height).data;
      return data.some((value, index) => index % 4 === 3 && value > 0);
    }),
  ).toBeTruthy();
  await page.locator("#orb-toggle").click();
  await expect(stage).toHaveAttribute("data-compact", "true");
  await expect(page.locator("#microphone")).toBeVisible();
  await page.locator("#orb-toggle").click();
  await expect(stage).toHaveAttribute("data-compact", "false");
  await page.locator("#theme").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBeFalsy();
  expect(errors).toEqual([]);
});
