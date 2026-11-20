// Bundles the service worker, the side panel and the options page, and copies the static files
// into dist/extension/ (load it unpacked). The manifest takes the local name from .sidebar-name
// when there is one (`pnpm rename`); the pages read the name from the manifest at runtime.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { localName } from "./sidebar-name.mjs";

const out = "dist/extension";
const STATIC = ["manifest.json", "panel.html", "panel.css", "options.html", "icons"];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["background", "panel", "options"].map((name) => `extension/src/${name}.ts`),
  bundle: true,
  format: "esm",
  target: "chrome150",
  outdir: out,
  legalComments: "none",
});
for (const name of STATIC) await cp(join("extension", name), join(out, name), { recursive: true });
const name = await localName();
if (name !== undefined) {
  const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
  await writeFile(join(out, "manifest.json"), `${JSON.stringify({ ...manifest, name }, null, 2)}\n`);
  console.log(`named "${name}" (from .sidebar-name)`);
}

// Print a content hash of the build so a review can name the exact artifact.
const files = (await readdir(out, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile())
  .map((e) => join(e.parentPath, e.name).slice(out.length + 1).split("\\").join("/"))
  .sort();
const hash = createHash("sha256");
for (const name of files) {
  hash.update(name);
  hash.update(await readFile(join(out, name)));
}
console.log(`built ${out} (${files.length} files) sha256=${hash.digest("hex")}`);
