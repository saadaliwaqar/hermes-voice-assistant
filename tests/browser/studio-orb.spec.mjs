import { test, expect } from "@playwright/test";

// Exercise the renderer independently of the layout controls. Audio fixtures
// supply measured input samples, not a simulated microphone permission grant.
test("Studio projects a 3D core and Classic retains its renderer", async ({
  page,
}) => {
  await page.route("**/api/setup", (route) =>
    route.fulfill({ json: { completed: true, checks: [], defaults: {} } }),
  );
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.dataset.layout = "studio";
  });
  const stage = page.locator("#voice-orb-stage");
  await expect(stage).toHaveAttribute("data-renderer", "studio-3d");
  expect(
    await page.locator("#voice-orb").evaluate((canvas) =>
      canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((value, i) => i % 4 === 3 && value > 0),
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.dataset.layout = "classic";
  });
  await expect(stage).toHaveAttribute("data-renderer", "classic");
});

test("3D renderer keeps real state and RMS contracts without opening a microphone", async ({
  page,
}) => {
  await page.route("**/api/setup", (route) =>
    route.fulfill({ json: { completed: true, checks: [], defaults: {} } }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const { createVoiceOrb } = await import("/static/orb.mjs");
    document.documentElement.dataset.layout = "studio";
    const stage = document.createElement("section");
    stage.id = "orb-contract";
    stage.style.cssText =
      "position:fixed;inset:0 auto auto 0;width:320px;height:320px";
    stage.innerHTML =
      '<canvas style="width:320px;height:320px"></canvas><span class="orb-state"></span>';
    document.body.append(stage);
    window.contractOrb = createVoiceOrb(stage.querySelector("canvas"), stage);
    window.contractOrb.setPhase("listening");
    window.contractOrb.input(new Float32Array(256).fill(0.1));
  });
  const stage = page.locator("#orb-contract");
  await expect(stage).toHaveAttribute("data-renderer", "studio-3d");
  await expect
    .poll(() => stage.getAttribute("data-energy").then(Number))
    .toBeGreaterThan(0.1);
  await expect(stage.locator(".orb-state")).toHaveText("VOICE INPUT ACTIVE");
  await page.evaluate(() => window.contractOrb.setPhase("thinking"));
  await expect(stage).toHaveAttribute("data-phase", "thinking");
  await expect(stage.locator(".orb-state")).toHaveText("PROCESSING REQUEST");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(stage).toHaveAttribute("data-motion", "reduced");
  await page.evaluate(() => {
    window.contractOrb.setPhase("standby");
    window.contractOrb.destroy();
    document.getElementById("orb-contract").remove();
  });
  await expect(page.locator("#microphone")).toHaveText("Start mic");
});
