import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = process.cwd();
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webp": "image/webp" };
const server = createServer(async (request, response) => {
  try {
    const pathname = request.url === "/" ? "/index.html" : request.url.split("?")[0];
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root)) throw new Error("invalid path");
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end("not found");
  }
});

await new Promise((resolve) => server.listen(4177, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await page.route("https://mantledb.sh/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/list/")) {
      return route.fulfill({ json: { namespace: "test", entries: [{ path: "members/damon" }] } });
    }
    if (route.request().method() === "POST") return route.fulfill({ json: { success: true } });
    return route.fulfill({ json: { name: "damon", dietary: "", orderDate: "", recipeIds: [], activityDates: [], updatedAt: "" } });
  });
  await page.goto("http://127.0.0.1:4177", { waitUntil: "networkidle" });
  assert.equal(await page.locator(".recipe-card").count(), 47);
  assert.equal(await page.locator("#orderButton").textContent(), "下单");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole("button", { name: "damon" }).click();
  const images = page.locator(".recipe-image");
  for (let index = 0; index < await images.count(); index += 1) {
    await images.nth(index).scrollIntoViewIfNeeded();
  }
  await page.waitForFunction(() => [...document.querySelectorAll(".recipe-image")].every((image) => image.complete && image.naturalWidth > 0));
  assert.equal(await images.count(), 47);
  await page.locator("[data-recipe-id]").first().click();
  assert.equal(await page.locator("#selectedCount").textContent(), "1");
  assert.equal(await page.locator("#orderButton").isEnabled(), true);
  await page.screenshot({ path: "mobile-preview.png", fullPage: true });
  console.log("mobile checks passed: 47 dishes, 47/47 images, 390px no overflow, identity and ordering controls work");
} finally {
  await browser.close();
  server.close();
}
