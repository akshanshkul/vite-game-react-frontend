import { test, expect } from "@playwright/test";
import { levels } from "../src/services/content";
test.beforeAll(async ({ request }) => {
  if (process.env.ZEN_API_TESTS !== "1") return;
  try {
    const response = await request.get("/api/v1/health", { timeout: 10000 });
    if (!response.ok() || (await response.json()).status !== "ok")
      throw new Error("Unhealthy backend");
  } catch {
    throw new Error(
      "Full-stack tests require a running, migrated and seeded API/MySQL backend. Start it with php spark serve in apps/api first. For an API on another port, set ZEN_API_TARGET to its origin.",
    );
  }
});

test("optional account sync and signed online completion through browser", async ({
  page,
}) => {
  test.setTimeout(240000);
  test.skip(
    process.env.ZEN_API_TESTS !== "1",
    "Run with ZEN_API_TESTS=1 and the local API/MySQL services.",
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.locator(".account-card").click();
  await page.getByRole("tab", { name: "Sign up" }).click();
  const email = `browser-${Date.now()}@example.test`,
    password = `Browser-test-${Date.now()}-long-password`;
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator("dialog")).toContainText("Account created.");
  await page
    .getByRole("button", { name: "Sync completed progress", exact: true })
    .click();
  await expect(page.locator("dialog")).toContainText(
    "Completed progress synced.",
  );
  await page
    .getByRole("button", { name: "Start this level as a verified online run" })
    .click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Online run started.");
  await page.getByText("Accessible tile controls", { exact: true }).click();
  for (const pair of levels[0].puzzle.solution)
    for (const id of pair)
      await page
        .getByRole("button", { name: new RegExp(` · ${id} ·`) })
        .click();
  await expect(page.getByRole("status")).toContainText("Online run verified.", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Ranks", exact: true }).click();
  await expect(page.locator("dialog")).toContainText("Guest gardener");
  const csrf = await (await page.request.get("/api/v1/auth/csrf")).json();
  const response = await page.request.delete("/api/v1/me", {
    headers: { "X-CSRF-Token": csrf.token },
    data: { password },
  });
  expect(response.status()).toBe(200);
});
