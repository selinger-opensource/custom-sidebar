// Scans every file that would be published for things that must never go public: absolute home
// paths, e-mail addresses, private workspace links, and (optionally) a private list of names.
//   node scripts/privacy-check.mjs [dir]       — generic patterns only (CI runs this)
//   PRIVACY_DENYLIST=/path/outside/repo.txt node scripts/privacy-check.mjs
// The denylist holds one term per line (case-insensitive, whole words) and must live outside the
// repository.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? ".";
const PATTERNS = [
  [/\/Users\/[A-Za-z0-9._-]+/, "absolute macOS home path"],
  [/\/home\/[a-z][a-z0-9._-]+\//, "absolute Linux home path"],
  [/[A-Za-z]:\\Users\\/, "absolute Windows home path"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "e-mail address"],
  [/claude\.ai\/(artifact|code|chat|project)/, "claude.ai link"],
  [/notion\.(so|site)\//, "Notion link"],
  [/\/var\/folders\//, "macOS temp path"],
];
const ALLOW = [/noreply@anthropic\.com/, /noreply@github\.com/, /git@github\.com/, /@types\//, /@v\d/, /@puppeteer\//];
const denylist = process.env.PRIVACY_DENYLIST
  ? readFileSync(process.env.PRIVACY_DENYLIST, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
      .map((t) => new RegExp(`(^|[^A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`, "i"))
  : [];

// Tracked and not-yet-ignored files when in a Git repo, else everything but dependencies/builds.
let files;
try {
  files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
} catch {
  files = execFileSync("find", [".", "-type", "f", "-not", "-path", "./node_modules/*", "-not", "-path", "./dist/*", "-not", "-path", "./.git/*"], { cwd: root, encoding: "utf8" })
    .split("\n").filter(Boolean).map((f) => f.slice(2));
}

const findings = [];
for (const file of files) {
  if (file.endsWith("scripts/privacy-check.mjs")) continue; // holds the patterns themselves
  const buf = readFileSync(join(root, file));
  const text = buf.toString("latin1"); // binary files (PNGs) too: metadata can carry paths
  for (const [line, n] of text.split("\n").map((l, i) => [l, i + 1])) {
    for (const [re, what] of PATTERNS) {
      const m = line.match(re);
      if (m && !ALLOW.some((a) => a.test(m[0]))) findings.push(`${file}:${n}: ${what}: ${m[0]}`);
    }
    for (const term of denylist) if (term.test(line)) findings.push(`${file}:${n}: denylisted term`);
  }
}
if (findings.length) {
  console.error(findings.join("\n"));
  console.error(`\nprivacy check: ${findings.length} finding(s) in ${files.length} files`);
  process.exit(1);
}
console.log(`privacy check: ${files.length} files clean${denylist.length ? ` (+${denylist.length} denylisted terms)` : ""}`);
