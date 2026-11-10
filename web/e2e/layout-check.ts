/**
 * Reflow and contrast checks for the design review.
 * Needs the site on :3000. Chain reads are redirected to the test registry so
 * pages render with real data: npx tsx e2e/layout-check.ts
 */
import path from "node:path";
import { chromium, Page } from "playwright-core";

const TEST_REGISTRY = "kheer-demo.testnet";
const PAGES = ["/", "/create", "/limits", "/agent/1", "/agent/1/history", "/agent/1/owner", "/job/0"];
const LONG = "a96ad3cb539b653e4b869bd7cf26590690e8971de87d98bae20dfaed23e8c1f";

function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return ((x + 0.05) / (y + 0.05)).toFixed(2);
};

async function overflow(page: Page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const scroll = document.documentElement.scrollWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== "fixed")
      .map((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className || ""} "${(e.textContent ?? "").trim().slice(0, 28)}"`)
      .slice(0, 4);
    return { w, scroll, offenders };
  });
}

async function main() {
  console.log("== Contrast (WCAG ratio)");
  for (const [name, fg, bg] of [
    ["muted text on white", "#6e6e73", "#ffffff"],
    ["muted text on surface", "#6e6e73", "#f5f5f7"],
    ["saffron chip text on chip", "#9a5f00", "#fff3dc"],
    ["saffron balance on white", "#9a5f00", "#ffffff"],
    ["error on white", "#b3261e", "#ffffff"],
    ["white on ink button", "#ffffff", "#1d1d1f"],
    ["input border on white (1.4.11)", "#8e8e93", "#ffffff"],
    ["focus ring on white (1.4.11)", "#0071e3", "#ffffff"],
  ]) console.log(`  ${ratio(fg, bg)}:1  ${name}`);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const [label, width, scale] of [["320px", 320, 1], ["200% zoom of 1280", 640, 2]] as const) {
    console.log(`\n== Reflow at ${label}`);
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: scale });
    await ctx.route("**/test.rpc.fastnear.com/**", async (route) => {
      const body = route.request().postData() ?? "";
      await route.continue({ postData: body.replace("app.kheer-demo.testnet", TEST_REGISTRY) });
    });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      await page.goto(`http://localhost:3000${p}`);
      await page.waitForTimeout(3500);
      const o = await overflow(page);
      console.log(`  ${o.scroll > o.w ? "OVERFLOW" : "ok      "} ${p}  scrollWidth ${o.scroll} vs ${o.w}${o.offenders.length ? `  ${o.offenders.join(" | ")}` : ""}`);
      if (width === 320) await page.screenshot({ path: path.join(__dirname, "shots", `review-320${p.replace(/\//g, "_") || "_home"}.png`), fullPage: true });
    }
    if (width === 320) {
      await page.goto("http://localhost:3000/agent/1/history");
      await page.waitForTimeout(3500);
      await page.evaluate((long) => {
        const s = document.querySelector(".row span");
        if (s) s.firstChild!.textContent = `${long}.near`;
      }, LONG);
      const o = await overflow(page);
      console.log(`  ${o.scroll > o.w ? "OVERFLOW" : "ok      "} history with a 64-character implicit account  scrollWidth ${o.scroll}`);
      await page.screenshot({ path: path.join(__dirname, "shots", "review-320-long-account.png"), fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
}

void main();
