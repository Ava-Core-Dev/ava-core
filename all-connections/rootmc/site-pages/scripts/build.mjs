import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build");

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "public"), out, { recursive: true });

const voteDir = join(root, "public/tools/vote-sites");
const toolsOut = join(out, "tools");
mkdirSync(toolsOut, { recursive: true });
try {
  execFileSync("zip", ["-j", "-q", join(toolsOut, "rootmc-open-vote-sites.zip"), "open-vote-sites.bat", "README.md"], { cwd: voteDir });
  execFileSync("zip", ["-j", "-q", join(toolsOut, "rootmc-open-vote-sites-linux.zip"), "open-vote-sites.sh", "install-linux-desktop.sh", "README.md"], { cwd: voteDir });
} catch {
  console.warn("zip not available — vote-site archives skipped");
}

console.log("rootmc-web build → build/");
