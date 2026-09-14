export type ParsedEnchantedBook = { enchant: string; level: number };

export type ParsedPotion = { material: string; potionType: string };

const BOOK = "ENCHANTED_BOOK";
const BOOK_PREFIX = `${BOOK}_`;
const ROMAN = ["", "I", "II", "III", "IV", "V"];
const POTION_PREFIXES = [
  "SPLASH_POTION",
  "LINGERING_POTION",
  "TIPPED_ARROW",
  "POTION",
] as const;

export function parseEnchantedBookKey(itemKey: string): ParsedEnchantedBook | null {
  const upper = String(itemKey || "").toUpperCase();
  if (!upper.startsWith(BOOK_PREFIX)) return null;
  const rest = upper.slice(BOOK_PREFIX.length);
  const last = rest.lastIndexOf("_");
  if (last <= 0) return null;
  const level = Number.parseInt(rest.slice(last + 1), 10);
  if (!Number.isFinite(level) || level < 1) return null;
  const enchant = rest.slice(0, last);
  if (!enchant) return null;
  return { enchant, level };
}

export function parsePotionKey(itemKey: string): ParsedPotion | null {
  const upper = String(itemKey || "").toUpperCase();
  for (const prefix of POTION_PREFIXES) {
    const head = `${prefix}_`;
    if (!upper.startsWith(head)) continue;
    const potionType = upper.slice(head.length);
    if (!potionType) return null;
    return { material: prefix, potionType };
  }
  return null;
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function romanLevel(level: number): string {
  return level >= 1 && level <= 5 ? ROMAN[level]! : String(level);
}

function potionDisplayName(parsed: ParsedPotion): string {
  const effect = titleCase(parsed.potionType.toLowerCase().replace(/_/g, " "));
  switch (parsed.material) {
    case "SPLASH_POTION":
      return `Splash ${effect}`;
    case "LINGERING_POTION":
      return `Lingering ${effect}`;
    case "TIPPED_ARROW":
      return `Arrow of ${effect}`;
    default:
      return effect;
  }
}

export function displayItemName(itemKey: string): string {
  if (String(itemKey || "").toUpperCase() === "BONDED_NOTE") {
    return "Bonded note";
  }
  const book = parseEnchantedBookKey(itemKey);
  if (book) {
    return `${titleCase(book.enchant.replace(/_/g, " "))} ${romanLevel(book.level)}`;
  }
  const potion = parsePotionKey(itemKey);
  if (potion) {
    return potionDisplayName(potion);
  }
  return itemKey
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
