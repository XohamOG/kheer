/** Desktop screenshots of key screens for visual review. Needs the site on :3000. */
import path from "node:path";
import { chromium } from "playwright-core";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Read real data from the test registry so agent pages render.
  await ctx.route("**/test.rpc.fastnear.com/**", (r) =>
    r.continue({ postData: (r.request().postData() ?? "").replace("app.kheer-demo.testnet", "kheer-demo.testnet") }),
  );
  const page = await ctx.newPage();
  const shot = (n: string) => page.screenshot({ path: path.join(__dirname, "shots", `look-${n}.png`), fullPage: true });

  await page.goto("http://localhost:3000/");
  await page.waitForTimeout(3000);
  await shot("home");
  await page.goto("http://localhost:3000/create");
  await page.getByRole("button", { name: "Pitch deck review" }).click();
  await page.waitForTimeout(1200);
  await shot("create-template");
  await page.goto("http://localhost:3000/agent/1");
  await page.waitForTimeout(3500);
  await shot("agent");
  await browser.close();
}

void main();
