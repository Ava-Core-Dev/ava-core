/**
 * Replace common third-party product/vendor tokens with neutral wording
 * so public surfaces (e.g. live /api/context dumps) do not leak brand names.
 */
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bChatGPT\b/gi, "cloud model"],
  [/\bOpenAI\b/gi, "cloud model"],
  [/\bAnthropic\b/gi, "cloud model"],
  [/\bClaude\b/gi, "cloud model"],
  [/\bGrok-class\b/gi, "cloud-model"],
  [/\bGrok\b/gi, "cloud model"],
  [/\bxAI\b/g, "cloud provider"],
  [/\bOllama\b/gi, "local model"],
  [/\bCursor\b/g, "coding agent"],
  [/\bSlack\b/g, "staff chat"],
];

export function sanitizeVendorNames(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function sanitizeVendorDeep(value: unknown): unknown {
  if (typeof value === "string") return sanitizeVendorNames(value);
  if (Array.isArray(value)) return value.map(sanitizeVendorDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeVendorDeep(v);
    }
    return out;
  }
  return value;
}
