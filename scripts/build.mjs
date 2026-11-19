// Bundles the service worker, the side panel and the options page, and copies the static files
// into dist/extension/ (load it unpacked).
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

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
