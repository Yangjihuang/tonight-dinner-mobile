import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("C:/Users/90761/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp");
const root = dirname(fileURLToPath(import.meta.url));
const baseUrl = "https://family-dinner-vote-2026.damonyangjihuang.chatgpt.site";
const recipes = JSON.parse((await readFile(join(root, "recipes.json"), "utf8")).replace(/^\uFEFF/, ""));
const response = await fetch(`${baseUrl}/api/state?code=HOOME`);
if (!response.ok) throw new Error(`菜谱接口返回 ${response.status}`);
const state = await response.json();
const sourceById = new Map(state.recipeLibrary.map((recipe) => [recipe.id, recipe.image_url]));
await mkdir(join(root, "images"), { recursive: true });

let completed = 0;
async function worker() {
  while (recipes.length) {
    const recipe = recipes.shift();
    const imageUrl = sourceById.get(recipe.id);
    if (!imageUrl) throw new Error(`缺少线上图片：${recipe.name}`);
    const imageResponse = await fetch(new URL(imageUrl, baseUrl));
    if (!imageResponse.ok) throw new Error(`图片下载失败 ${imageResponse.status}：${recipe.name}`);
    const output = await sharp(Buffer.from(await imageResponse.arrayBuffer()))
      .resize(720, 720, { fit: "cover", position: "centre" })
      .webp({ quality: 78, effort: 5 })
      .toBuffer();
    await writeFile(join(root, recipe.image), output);
    completed += 1;
    console.log(`${completed}/47 ${recipe.name}`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
if (completed !== 47) throw new Error(`应同步 47 张图片，实际 ${completed}`);
