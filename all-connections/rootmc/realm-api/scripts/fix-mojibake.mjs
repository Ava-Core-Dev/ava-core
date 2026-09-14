import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, "..", "src");

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));

function replaceAll(s, from, to) {
  return s.split(from).join(to);
}

/** Build mojibake string from code points (encoding-safe). */
function cps(...points) {
  return String.fromCodePoint(...points);
}

// UTF-8 bytes for punctuation, misread as Windows-1252, then stored as Unicode.
const MOJI = {
  emDash: cps(0xe2, 0x20ac, 0x201d), // â€"  (—)
  enDash: cps(0xe2, 0x20ac, 0x201c), // â€"  (–) sometimes 0x93 → U+201C
  bullet: cps(0xe2, 0x20ac, 0xa2), // â€¢
  ellipsis: cps(0xe2, 0x20ac, 0xa6), // â€¦
  lsquo: cps(0xe2, 0x20ac, 0x2122), // â€˜ (approx)
  rsquo: cps(0xe2, 0x20ac, 0x2122),
  ldquo: cps(0xe2, 0x20ac, 0x153), // â€œ
  rdquo: cps(0xe2, 0x20ac, 0x9d), // â€
  middot: cps(0xc2, 0xb7), // Â·
  times: cps(0xc3, 0x97), // Ã—
  ge: cps(0xe2, 0x89, 0xa5), // â‰¥
  le: cps(0xe2, 0x89, 0xa4), // â‰¤
  arrow: cps(0xe2, 0x86, 0x92), // â†’
};

// Verify actual sequences present in known-bad file
const probe = fs.readFileSync(path.join(dir, "rootmc-daily-report.ts"), "utf8");
const around = probe.slice(probe.indexOf("${label}") + 8, probe.indexOf("${label}") + 12);
console.log("probe dash codes", [...around].map((c) => "U+" + c.codePointAt(0).toString(16)));

const reps = [
  [MOJI.emDash, " - "],
  [cps(0xe2, 0x20ac, 0x201c), " - "], // en-dash mojibake variant
  [cps(0xe2, 0x20ac, 0x2013), "-"],
  [MOJI.bullet, "-"],
  [cps(0xe2, 0x20ac, 0xa2), "-"],
  [MOJI.ellipsis, "..."],
  [cps(0xe2, 0x20ac, 0xa6), "..."],
  [MOJI.middot, " - "],
  [MOJI.times, "x"],
  [MOJI.ge, ">="],
  [MOJI.le, "<="],
  [MOJI.arrow, "->"],
  [cps(0xe2, 0x80, 0x94), " - "], // if somehow real UTF-8 em dash bytes as latin1
  // Proper Unicode → ASCII (keep source ASCII-safe)
  ["\u2014", " - "],
  ["\u2013", "-"],
  ["\u2022", "-"],
  ["\u00B7", " - "],
  ["\u2192", "->"],
  ["\u2265", ">="],
  ["\u2264", "<="],
  ["\u00D7", "x"],
  ["\u2026", "..."],
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201C", '"'],
  ["\u201D", '"'],
];

let fixedFiles = 0;
for (const f of files) {
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, "utf8");
  const before = s;
  for (const [from, to] of reps) {
    if (!from) continue;
    s = replaceAll(s, from, to);
  }
  // Catch remaining â€ prefix clusters that look like mojibake
  s = s.replace(/\u00E2\u20AC[\u201C\u201D\u2018\u2019\u00A2\u00A6\u2122\u0153\u009D]/g, (m) => {
    const last = m.codePointAt(2);
    if (last === 0x201c || last === 0x201d) return " - ";
    if (last === 0xa2) return "-";
    if (last === 0xa6) return "...";
    if (last === 0x2018 || last === 0x2019 || last === 0x2122) return "'";
    return '"';
  });
  if (s !== before) {
    fs.writeFileSync(p, s, "utf8");
    fixedFiles++;
    console.log("fixed", f);
  }
}
console.log("done, fixed", fixedFiles, "files");
