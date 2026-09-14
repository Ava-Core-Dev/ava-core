import fs from "node:fs";

const p = process.argv[2];
const s = fs.readFileSync(p, "utf8");
const needle = "${label}";
const idx = s.indexOf(needle);
console.log("idx", idx);
console.log(JSON.stringify(s.slice(idx, idx + 30)));
for (const ch of s.slice(idx + needle.length, idx + needle.length + 8)) {
  console.log(JSON.stringify(ch), "U+" + ch.codePointAt(0).toString(16).toUpperCase());
}

// count suspicious sequences
const patterns = ["â€", "Â·", "Ã—", "â‰", "â†", "â€¢", "â€”", "â€“"];
for (const pat of patterns) {
  let n = 0;
  let i = 0;
  while ((i = s.indexOf(pat, i)) >= 0) {
    n++;
    i += pat.length;
  }
  if (n) console.log("count", JSON.stringify(pat), n);
}
