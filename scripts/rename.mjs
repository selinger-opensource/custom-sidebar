// Names this build of the extension, then rebuilds dist/extension:
//   pnpm rename "My Sidebar"     — use that name (kept in .sidebar-name, gitignored)
//   pnpm rename  |  --reset      — back to the default name from extension/manifest.json
// The name survives `pnpm check`, `git pull` and rebuilds; no tracked file changes. Reload the
// extension at chrome://extensions afterwards: settings stay, as Chrome knows it by its folder.
import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { NAME_FILE, RECOMMENDED_NAME, defaultName, validName } from "./sidebar-name.mjs";

const args = process.argv.slice(2);
const reset = args.length === 0 || (args.length === 1 && args[0] === "--reset");
let name;
if (reset) {
  await rm(NAME_FILE, { force: true });
  name = await defaultName();
} else {
  try {
    name = validName(args.join(" "));
  } catch (error) {
    console.error(`Can't rename: ${error.message}.`);
    process.exit(1);
  }
  await writeFile(NAME_FILE, `${name}\n`);
  if (name.length > RECOMMENDED_NAME) console.warn(`Note: ${name.length} characters; Chrome recommends at most ${RECOMMENDED_NAME}, and the side panel's header cuts long names short.`);
}
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
console.log(`Named "${name}"${reset ? " (the default)" : ""}. Reload it at chrome://extensions.`);
