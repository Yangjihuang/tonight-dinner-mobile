import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const targetUrl = process.env.TARGET_URL || "https://yangjihuang.github.io/tonight-dinner-mobile/";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49"
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(targetUrl, { waitUntil: "networkidle" });
  if (targetUrl.startsWith("http")) assert.equal(response.status(), 200);
  await page.waitForSelector(".recipe-card");
  assert.equal(await page.locator(".recipe-card").count(), 13);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.match(await page.title(), /今晚吃什么/);
  const member = page.getByRole("button", { name: "damon" });
  await member.click();
  const images = page.locator(".recipe-image");
  for (let index = 0; index < await images.count(); index += 1) {
    await images.nth(index).scrollIntoViewIfNeeded();
  }
  await page.waitForFunction(() => [...document.querySelectorAll(".recipe-image")].every((image) => image.complete && image.naturalWidth > 0));
  assert.equal(await images.count(), 13);
  await page.locator("[data-recipe-id]").first().click();
  assert.equal(await page.locator("#orderButton").isEnabled(), true);
  const apiStatus = await page.evaluate(async () => (await fetch("https://mantledb.sh/v2/list/tonight-dinner-7fc44f0ce3c74618", { cache: "no-store" })).status);
  assert.equal(apiStatus, 200);
  const writeStatus = await page.evaluate(async () => (await fetch("https://mantledb.sh/v2/tonight-dinner-7fc44f0ce3c74618/healthcheck", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkedAt: new Date().toISOString() })
  })).status);
  assert.equal(writeStatus, 200);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "C:\\Users\\90761\\Documents\\Codex\\2026-08-18\\new-chat-2\\outputs\\今晚吃什么-手机预览.png", fullPage: true });
  console.log(`target checks passed (${targetUrl}): WeChat UA, 13/13 images, live shared API, 390px no overflow, ordering interaction`);
} finally {
  await browser.close();
}
