import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("system theme follows OS, explicit choice persists, and system restores tracking", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "System theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("copy writes the real command and falls back to keyboard selection", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("./");
  await page.getByRole("button", { name: "Copy npx etymon" }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "npx etymon",
  );
  await expect(page.getByRole("status").first()).toHaveText("Command copied.");
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: () => Promise.reject(new Error("Denied")),
    });
  });
  await page.getByRole("button", { name: "Copy npx etymon" }).first().click();
  await expect(page.getByRole("status").first()).toHaveText(
    "Select and copy the command using your keyboard.",
  );
  await expect(page.locator("#hero-command")).toBeFocused();
  expect(
    await page
      .locator("#hero-command")
      .evaluate((input: HTMLInputElement) =>
        input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
      ),
  ).toBe("npx etymon");
});

test("workflow tabs support keyboard selection and reduced motion stays still", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  const demo = page.locator("[data-demo]");
  await expect(demo).toHaveAttribute("data-active", "sync");
  await expect(demo).toHaveAttribute("data-phase", "complete");
  await page.getByRole("tab", { name: "sync", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "init", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("etymon init");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "convert", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText(
    "etymon convert claude",
  );
  await page.keyboard.press("End");
  await expect(page.getByRole("tabpanel")).toContainText(
    "etymon skills add vercel-labs/skills --skill find-skills",
  );
  await expect(demo).toHaveAttribute("data-playback", "paused");
  await page.waitForTimeout(5500);
  await expect(demo).toHaveAttribute("data-active", "skill");
});

test("autoplay pauses, resumes after selection, and suspends when offscreen", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("./");
  const demo = page.locator("[data-demo]");
  await page.getByRole("button", { name: "Pause demo", exact: true }).click();
  await expect(demo).toHaveAttribute("data-playback", "paused");
  await page.getByRole("tab", { name: "init", exact: true }).click();
  await page.getByRole("button", { name: "Play demo", exact: true }).click();
  await page.mouse.move(1, 1);
  await expect(demo).toHaveAttribute("data-active", "convert", {
    timeout: 15000,
  });
  await page.locator("#start-title").scrollIntoViewIfNeeded();
  const current = await demo.getAttribute("data-active");
  await page.waitForTimeout(8500);
  await expect(demo).toHaveAttribute("data-active", current!);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} theme has no accessibility violations or mobile overflow`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("./");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    for (const width of [320, 375, 640, 768, 1024, 1280, 1440, 1536]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          { message: `Overflow at ${width}px` },
        )
        .toBe(true);
    }
  });
}

test("production assets resolve under the GitHub Pages path", async ({
  page,
  request,
}) => {
  const failed: string[] = [];
  page.on("pageerror", (error) => failed.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failed.push(response.url());
  });
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "One setup.Every coding agent.",
  );
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe(
    "https://landoncrabtree.github.io/etymon/",
  );
  expect((await request.get("favicon.svg")).ok()).toBe(true);
  await page.getByRole("link", { name: "Tools", exact: true }).click();
  await expect(page).toHaveURL(/#tools$/);
  expect(failed).toEqual([]);
});

test("without JavaScript the commands, links, and completed demo remain readable", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4321/etymon/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#hero-command")).toHaveValue("npx etymon");
  await expect(page.locator("#scene-sync .tree-after")).toBeVisible();
  await expect(page.getByRole("tablist")).toBeHidden();
  await expect(
    page.getByRole("link", { name: "Read the guide" }),
  ).toBeVisible();
  await context.close();
});
