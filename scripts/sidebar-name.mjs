// The extension's name for a build: the default in extension/manifest.json, or a local override in
// .sidebar-name (gitignored; written by `pnpm rename`). Chrome's side-panel header shows the
// manifest name and nothing can change it at runtime, so a different name means a rebuild.
import { readFile } from "node:fs/promises";

export const NAME_FILE = ".sidebar-name";
/** Chrome refuses a manifest name over 75 characters and recommends at most 45. */
export const MAX_NAME = 75;
export const RECOMMENDED_NAME = 45;

/** The name as it will be used (spaces collapsed), or throws saying why it can't be. */
export function validName(input) {
  const name = String(input ?? "").replace(/\s+/g, " ").trim();
  if (name === "") throw new Error("the name is empty");
  if (name.length > MAX_NAME) throw new Error(`the name is ${name.length} characters; Chrome allows at most ${MAX_NAME}`);
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("the name has control characters");
  if (name.startsWith("__MSG_")) throw new Error("names starting with __MSG_ are Chrome's message placeholders");
  return name;
}

export async function defaultName() {
  return JSON.parse(await readFile("extension/manifest.json", "utf8")).name;
}

/** The override in .sidebar-name, or undefined when there's none. */
export async function localName() {
  try {
    return validName(await readFile(NAME_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error(`${NAME_FILE}: ${error.message} (run \`pnpm rename --reset\` to go back to the default)`);
  }
}
