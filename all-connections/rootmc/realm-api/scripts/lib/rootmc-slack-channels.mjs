/**
 * RootMC Slack channel IDs (workspace rootmcworkspace.slack.com).
 * Prefer these over Discord for ops/research destinations that have been migrated.
 */
export const ROOTMC_SLACK_CHANNELS = {
  /** Public paid plugin / marketplace planning — migrated from Discord 1529247837420912751 */
  pluginSales: "C0BLZCVAC3X",
  /** Server / workstation / connection logs — Incoming Webhook target */
  serverLogs: "C0BMX0QKSTS",
  /** Workspace announcements */
  allRootmc: "C0BLWBTUCR0",
  /** Plugin / feature design plans */
  pluginDevelopmentPlans: "C0BM4P3GVDX",
  /** Live build / digs / cutover chatter (Ava-owned layout) */
  development: "C0BMCPMDDQR",
  /** Canonical RootMC Cloudflare API reference — migrated from Discord 1520385893653938236 */
  apiDescription: "C0BM6HN0WMA",
  /** Canonical Discord channel ID inventory — migrated from Discord 1520386796406706216 */
  discordChannels: "C0BM4QT5U0Z",
  /** In-game /feedback + questionnaire + command-test reports — migrated from Discord 1516828735536365669 */
  feedback: "C0BLMGBVAMD",
  /** Worker cron / automation inventory — migrated from Discord 1520387570004135956 */
  cronsAutomation: "C0BLMHKTCTH",
  /** Automated reports status board — migrated from Discord 1527441888443895958 (live Discord edit still active) */
  automatedReports: "C0BM6KVFS0L",
  /** Copies of Discord AI reports (daily/weekly/monthly) after Discord post */
  serverReports: "C0BLY49H13M",
};

export const ROOTMC_SLACK_CHANNEL_URLS = {
  pluginSales: "https://rootmcworkspace.slack.com/archives/C0BLZCVAC3X",
  serverLogs: "https://rootmcworkspace.slack.com/archives/C0BMX0QKSTS",
  allRootmc: "https://rootmcworkspace.slack.com/archives/C0BLWBTUCR0",
  pluginDevelopmentPlans: "https://rootmcworkspace.slack.com/archives/C0BM4P3GVDX",
  development: "https://rootmcworkspace.slack.com/archives/C0BMCPMDDQR",
  apiDescription: "https://rootmcworkspace.slack.com/archives/C0BM6HN0WMA",
  discordChannels: "https://rootmcworkspace.slack.com/archives/C0BM4QT5U0Z",
  feedback: "https://rootmcworkspace.slack.com/archives/C0BLMGBVAMD",
  cronsAutomation: "https://rootmcworkspace.slack.com/archives/C0BLMHKTCTH",
  automatedReports: "https://rootmcworkspace.slack.com/archives/C0BM6KVFS0L",
  serverReports: "https://rootmcworkspace.slack.com/archives/C0BLY49H13M",
};

/** Slack Canvas docs (canonical long-form). */
export const ROOTMC_SLACK_CANVASES = {
  /** Ava chat org — Discord vs Slack lanes */
  avaChatOrg: "https://rootmcworkspace.slack.com/docs/T0BM02SM1FE/F0BM7FRUXJ9",
  /** Full API endpoint inventory (from Discord #api-references). */
  apiReference: "https://rootmcworkspace.slack.com/docs/T0BM02SM1FE/F0BLMFRPA8P",
  /** Discord guild channel ID map (from Discord #discord-ids). */
  discordChannelIds: "https://rootmcworkspace.slack.com/docs/T0BM02SM1FE/F0BLMFYJYEB",
  /** Plan: merge Root-Discord into Root-Core comms. */
  rootDiscordToCorePlan: "https://rootmcworkspace.slack.com/docs/T0BM02SM1FE/F0BMX8XLMPA",
  /** Worker cron schedule + Discord targets inventory. */
  cronsAutomation: "https://rootmcworkspace.slack.com/docs/T0BM02SM1FE/F0BLZK9RHHT",
  /** Automated reports board (ops home; live edits still Discord until Slack bot). */
  automatedReports: "https://rootmcworkspace.slack.com/docs/T0BM02SM1FE/F0BMX9FP716",
};
