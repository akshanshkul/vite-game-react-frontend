import { test, expect } from "@playwright/test";
import { levels } from "../src/services/content";
async function welcome(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await expect(page.locator("canvas")).toBeVisible();
}
for (const mobile of [false, true])
  test(`complete and resume ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await welcome(page);
    await page.getByText("Accessible tile controls", { exact: true }).click();
    const witness = levels[0].puzzle.solution;
    for (const [a, b] of witness) {
      await page.getByRole("button", { name: new RegExp(` · ${a} ·`) }).click();
      await page.getByRole("button", { name: new RegExp(` · ${b} ·`) }).click();
    }
    await expect(
      page.getByRole("heading", { name: "Garden complete" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: false }).click();
    await expect(
      page.getByRole("heading", { name: "Garden complete" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".metrics")).toContainText(
      String((witness.length - 1) * 100).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    );
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "A quiet pause." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Return to the garden" }).click();
    await expect(page.locator("canvas")).toBeVisible();
  });
test("campaign, daily, hint, shuffle, settings and persistence", async ({
  page,
}) => {
  await welcome(page);
  await page.getByRole("button", { name: "Hint", exact: false }).click();
  await expect(page.getByRole("status")).toContainText("Match the highlighted");
  await page.getByRole("button", { name: "Shuffle", exact: false }).click();
  await expect(page.getByRole("status")).toContainText(
    "solvable fresh arrangement",
  );
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await expect(page.getByRole("button", { name: /Play level/ })).toHaveCount(
    100,
  );
  await expect(
    page.getByRole("button", { name: "Play level 2 (locked)", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Play level 1", exact: true }).click();
  await expect(page.locator(".eyebrow")).toContainText("LEVEL 1");
  await page
    .getByRole("button", { name: "Daily", exact: true })
    .click();
  await expect(page.locator(".eyebrow")).toContainText("DAILY");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("High contrast").check();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass("contrast");
});
test("pause hides accessible board; keyboard shortcuts and restart work", async ({
  page,
}) => {
  await welcome(page);
  await page.getByText("Accessible tile controls", { exact: true }).click();
  await page.keyboard.press("p");
  await expect(page.locator(".accessible button")).toHaveCount(0);
  await page.keyboard.press("p");
  await expect(page.locator(".accessible button")).toHaveCount(
    levels[0].puzzle.tiles.length,
  );
  await page.keyboard.press("h");
  await expect(page.getByRole("status")).toContainText("Match the highlighted");
  await page.getByRole("button", { name: "Restart", exact: false }).click();
  await expect(page.locator(".metrics")).toContainText("0");
});
test("production service worker supports offline reload and play", async ({
  page,
  context,
}) => {
  await welcome(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.locator("canvas")).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByText("Accessible tile controls", { exact: true }).click();
  for (const id of levels[0].puzzle.solution[0])
    await page.getByRole("button", { name: new RegExp(` · ${id} ·`) }).click();
  await expect(page.locator(".metrics")).toContainText("100");
  await context.setOffline(false);
});
test("save timer survives reload and repeated reward is idempotent", async ({
  page,
}) => {
  await welcome(page);
  await expect
    .poll(async () => page.locator(".metrics").innerText())
    .toContain("0:02");
  await page.reload();
  await expect(page.locator(".metrics")).not.toContainText("0:00");
  await page.getByText("Accessible tile controls", { exact: true }).click();
  for (const [a, b] of levels[0].puzzle.solution) {
    for (const id of [a, b])
      await page
        .getByRole("button", { name: new RegExp(` · ${id} ·`) })
        .click();
  }
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.locator("dialog")).toContainText("25 garden coins");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.locator("dialog")).toContainText("25 garden coins");
});

test("version-1 incompatible save is archived before a fresh run is saved", async ({
  page,
}) => {
  await page.goto("/icons/icon.svg");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("zen-tiles", 10);
        open.onupgradeneeded = () =>
          open.result.createObjectStore("runs", { keyPath: "id" });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("runs", "readwrite");
          tx.objectStore("runs").put({ id: "active", state: { legacy: true } });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
  );
  await welcome(page);
  await expect(page.getByRole("status")).toContainText("save was archived");
  const count = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("zen-tiles");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result
            .transaction("runs")
            .objectStore("runs")
            .getAll();
          req.onsuccess = () => {
            open.result.close();
            resolve(
              req.result.filter(
                (r: { id: string; state?: { legacy?: boolean } }) =>
                  r.id.startsWith("archive-") && r.state?.legacy,
              ).length,
            );
          };
        };
      }),
  );
  expect(count).toBe(1);
});

test("fifty restarts retain a bounded heap and a playable board", async ({
  page,
}) => {
  test.setTimeout(240000);
  await welcome(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  for (let i = 0; i < 50; i++)
    await page.getByRole("button", { name: "Restart", exact: false }).click();
  await cdp.send("HeapProfiler.collectGarbage");
  const after = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  expect(after - before).toBeLessThan(25 * 1024 * 1024);
  await page.getByRole("button", { name: "Hint", exact: false }).click();
  await expect(page.getByRole("status")).toContainText("Match the highlighted");
});
