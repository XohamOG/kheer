/** Opens a production build and confirms the real wallet picker appears. */
import path from "node:path";
import { chromium } from "playwright-core";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3000");
  await page.getByText("Own the AI that does it.").waitFor();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(__dirname, "shots", "14-wallet-picker.png") });
  console.log("page errors:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
}

void main();
