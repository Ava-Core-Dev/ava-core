(function () {
  var BOOK = "ENCHANTED_BOOK";
  var BOOK_PREFIX = BOOK + "_";
  var ROMAN = ["", "I", "II", "III", "IV", "V"];
  var POTION_PREFIXES = [
    "SPLASH_POTION",
    "LINGERING_POTION",
    "TIPPED_ARROW",
    "POTION",
  ];

  function parseEnchantedBookKey(key) {
    var upper = String(key || "").toUpperCase();
    if (!upper.startsWith(BOOK_PREFIX)) return null;
    var rest = upper.slice(BOOK_PREFIX.length);
    var last = rest.lastIndexOf("_");
    if (last <= 0) return null;
    var level = parseInt(rest.slice(last + 1), 10);
    if (!Number.isFinite(level) || level < 1) return null;
    var enchant = rest.slice(0, last);
    if (!enchant) return null;
    return { enchant: enchant, level: level };
  }

  function parsePotionKey(key) {
    var upper = String(key || "").toUpperCase();
    for (var i = 0; i < POTION_PREFIXES.length; i++) {
      var prefix = POTION_PREFIXES[i];
      var head = prefix + "_";
      if (!upper.startsWith(head)) continue;
      var potionType = upper.slice(head.length);
      if (!potionType) return null;
      return { material: prefix, potionType: potionType };
    }
    return null;
  }

  function titleCase(text) {
    return String(text || "").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function romanLevel(level) {
    return level >= 1 && level <= 5 ? ROMAN[level] : String(level);
  }

  function potionDisplayName(parsed) {
    var effect = titleCase(parsed.potionType.replace(/_/g, " "));
    switch (parsed.material) {
      case "SPLASH_POTION":
        return "Splash " + effect;
      case "LINGERING_POTION":
        return "Lingering " + effect;
      case "TIPPED_ARROW":
        return "Arrow of " + effect;
      default:
        return effect;
    }
  }

  function displayName(key) {
    if (String(key || "").toUpperCase() === "BONDED_NOTE") {
      return "Bonded note";
    }
    var book = parseEnchantedBookKey(key);
    if (book) {
      return titleCase(book.enchant.replace(/_/g, " ")) + " " + romanLevel(book.level);
    }
    var potion = parsePotionKey(key);
    if (potion) {
      return potionDisplayName(potion);
    }
    return titleCase(String(key || "").replace(/_/g, " "));
  }

  window.RootMcItemKeys = {
    displayName: displayName,
    parseEnchantedBookKey: parseEnchantedBookKey,
    parsePotionKey: parsePotionKey,
  };
})();
