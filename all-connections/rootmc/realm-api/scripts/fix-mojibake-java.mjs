import fs from "node:fs";
import path from "node:path";

const root = "D:/.1 Work Stations/RootMC/Plugin Building/Minecraft/plugins";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "build" || e.name === ".gradle") continue;
      walk(p, out);
    } else if (e.name.endsWith(".java")) out.push(p);
  }
  return out;
}

function replaceAll(s, from, to) {
  return s.split(from).join(to);
}

let n = 0;
for (const p of walk(root)) {
  let s = fs.readFileSync(p, "utf8");
  const before = s;
  s = s.replace(/\u00E2\u20AC[\u201C\u201D]/g, " - ");
  s = s.replace(/\u00E2\u20AC\u00A2/g, "-");
  s = s.replace(/\u00E2\u20AC\u00A6/g, "...");
  s = s.replace(/\u00E2\u20AC[\u2018\u2019\u2122]/g, "'");
  s = s.replace(/\u00C2\u00B7/g, " - ");
  s = s.replace(/\u00C3\u0097/g, "x");
  s = s.replace(/\u00E2\u86\u92/g, "->");
  s = s.replace(/\u00E2\u89\uA5/g, ">=");
  s = s.replace(/\u00E2\u89\uA4/g, "<=");
  // Corrupted section sign (not \u00A7 escapes)
  s = replaceAll(s, "Ã‚Â§", "\\u00A7");
  if (s !== before) {
    fs.writeFileSync(p, s, "utf8");
    n++;
    console.log("fixed", path.relative(root, p));
  }
}
console.log("java fixed", n);
