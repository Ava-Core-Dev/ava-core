/** Shared RootMC Constitution version + ratification (HST). */
export const CONSTITUTION_VERSION = "2026-07-06";
export const CONSTITUTION_DECLARED_HST = "July 2, 2026 (HST)";
export const CONSTITUTION_RATIFIED_HST = "July 6, 2026 (HST)";
export const CONSTITUTION_RATIFY_CLOSES_HST = "Sunday, July 5, 2026, 08:00 HST";
/** Sunday 5 Jul 2026 08:00 HST = 18:00 UTC */
export const CONSTITUTION_RATIFY_CLOSES_ISO = "2026-07-05T18:00:00.000Z";
export const CONSTITUTION_RATIFY_POLL_ID = "549cf16c";
export const CONSTITUTION_WIKI_URL = "https://rootmc.net/wiki/constitution/";

export function constitutionPollTitle() {
  return `Ratify RootMC Constitution (${CONSTITUTION_VERSION})`;
}

export function constitutionPollDescription() {
  return [
    `Community vote to adopt **RootMC Constitution version \`${CONSTITUTION_VERSION}\`** (ratified **${CONSTITUTION_RATIFIED_HST}**) as authoritative policy for Gold, the Server Reserve, treasury grants, and governance.`,
    "",
    "A **For** vote supports ratifying the wiki document and weighted governance rules described there.",
    "",
    `**Original poll deadline:** ${CONSTITUTION_RATIFY_CLOSES_HST}.`,
    "",
    "Pass requires weighted majority (Council poll `549cf16c`).",
  ].join("\n");
}

export function constitutionBillSummary() {
  return `Adopts constitution ${CONSTITUTION_VERSION} (ratified ${CONSTITUTION_RATIFIED_HST}): gold-backed Notes, closed-loop reserve, redeemable Gold peg, treasury grants, weighted Council governance.`;
}

export function formatPollClosesLine(closesIso) {
  if (closesIso === CONSTITUTION_RATIFY_CLOSES_ISO) {
    return `_Original deadline ${CONSTITUTION_RATIFY_CLOSES_HST} · ratified ${CONSTITUTION_RATIFIED_HST}_`;
  }
  return `_Closes ${String(closesIso).replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}_`;
}
