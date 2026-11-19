// Zips dist/extension (built by `pnpm build`) for a GitHub Release and prints the zip's path.
//   node scripts/release-zip.mjs [tag]   — a tag must match manifest.json's version (v0.2.0)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const dir = "dist/extension";
if (!existsSync(`${dir}/manifest.json`)) throw new Error("run `pnpm build` first");
const { version } = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
const tag = process.argv[2];
if (tag && tag !== `v${version}`) throw new Error(`tag ${tag} does not match manifest version ${version}`);
const zip = resolve(`dist/compact-sidebar-${version}.zip`);
rmSync(zip, { force: true });
execFileSync("zip", ["-qrX", zip, "."], { cwd: dir });
console.log(zip);
