import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output) throw new Error("Usage: node build-standalone.mjs <output.html>");

const [sourceHtml, styles, app, rawRecipes] = await Promise.all([
  readFile(join(root, "index.html"), "utf8"),
  readFile(join(root, "styles.css"), "utf8"),
  readFile(join(root, "app.js"), "utf8"),
  readFile(join(root, "recipes.json"), "utf8")
]);
const recipes = JSON.parse(rawRecipes.replace(/^\uFEFF/, ""));
for (const recipe of recipes) {
  const image = await readFile(join(root, recipe.image));
  recipe.image = `data:image/webp;base64,${image.toString("base64")}`;
}

const html = sourceHtml
  .replace('<link rel="stylesheet" href="styles.css">', `<style>${styles}</style>`)
  .replace('<script src="app.js"></script>', `<script>window.__RECIPES__=${JSON.stringify(recipes)};</script><script>${app}</script>`);
await writeFile(output, html, "utf8");
console.log(`standalone HTML written: ${output}`);
