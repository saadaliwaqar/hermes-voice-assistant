import { test, expect } from "@playwright/test";
import { createServer } from "node:http";

test("browser rejects cross-origin framing but allows top-level dashboard", async ({
  page,
  baseURL,
}) => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<iframe src="${baseURL}"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const denied = page.waitForEvent("console", {
      predicate: (m) => m.text().includes("frame-ancestors"),
      timeout: 10000,
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await denied;
    await expect(page.frameLocator("iframe").locator("#composer")).toHaveCount(
      0,
    );
    await page.goto(baseURL);
    await expect(page.locator("#connection")).toContainText("connected");
    await expect(page.locator("#microphone")).toHaveText("Start mic");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
