import { test, expect } from "@playwright/test";

// Real local REST transport and browser DOM. These checks do not call a model.
test("sessions, themes, settings and refresh use the live service", async ({
  page,
  request,
  baseURL,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // This suite covers the dashboard; setup has its own first-run coverage.
  await page.route("**/api/setup", (route) =>
    route.fulfill({ json: { completed: true, checks: [], defaults: {} } }),
  );
  const headers = { "X-Hermes-Voice": "browser", Origin: baseURL };
  const title = "Browser QA " + Date.now();
  const response = await request.post("/api/sessions", {
    headers,
    data: { title },
  });
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  await page.goto("/");
  await expect(page.locator("#connection")).not.toContainText("Connecting", {
    timeout: 15000,
  });
  await page.locator("#sessions").getByText(title, { exact: true }).click();
  await expect(page.locator("#session-title")).toHaveText(title);
  await expect(page.locator("#microphone")).toHaveText("Start mic");
  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");
  await page.screenshot({
    path: ".local/screenshots/daylight.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");
  await expect(page.locator("#session-title")).toHaveText(title);
  await page.locator("#settings-open").click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
  await expect(page.locator('[name="voice_provider"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page.locator("#session-menu summary").click();
  await page.locator("#rename-session").click();
  await expect(page.locator("#action-dialog")).toBeVisible();
  await page.locator("#action-input").fill("Renamed browser session");
  await page.locator("#action-confirm").click();
  await expect(page.locator("#session-title")).toHaveText(
    "Renamed browser session",
  );
  const detail = await (
    await request.get(`/api/sessions/${session.id}`)
  ).json();
  expect(detail.session.title).toBe("Renamed browser session");
  await page.locator("#theme").click();
  await page.screenshot({
    path: ".local/screenshots/core.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBeFalsy();
  await page.screenshot({
    path: ".local/screenshots/mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
