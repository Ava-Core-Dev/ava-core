/**
 * Solar day cycles (HST) — midnight close + morning open reports.
 * Don't mix prior-day buckets into today's live / morning boards.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import {
  ecoHstDayKey,
  loadEcoSnapshot,
  refreshEcoFlow,
  summarizeMorningSolar,
  isEcoSampleLive,
  isEcoRemoved,
  ECO_NICKNAMES,
} from "./ecoflow.mjs";
import { AVA_CHANNELS } from "./config.mjs";
import { postAvaDiscord } from "./avaPost.mjs";
import { solarLinksFooterLines } from "./solarLinks.mjs";

function statePath() {
  return path.join(storePaths().dir, "solar-day-cycle.json");
}

function daysDir() {
  return path.join(storePaths().dir, "ecoflow", "days");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {
      activeDay: "",
      lastMidnightReportDay: "",
      lastMorningReportDay: "",
    };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

function snLabel(sn) {
  for (const [name, id] of Object.entries(ECO_NICKNAMES)) {
    if (id === sn && !/cucumbers|shackas|delta-2|river-2/i.test(name)) return name;
  }
  return sn;
}

function hstParts(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    day: ecoHstDayKey(ms),
  };
}

function buildLiveLines(snap) {
  const lines = [];
  const per = snap?.perSn || {};
  for (const [sn, v] of Object.entries(per)) {
    if (isEcoRemoved(sn)) continue;
    if (!isEcoSampleLive(v)) {
      lines.push(`- **${snLabel(sn)}**: not live`);
      continue;
    }
    lines.push(
      `- **${snLabel(sn)}**: SOC ${v.soc ?? "?"}% · in ${v.inW ?? "?"}W · out ${v.outW ?? "?"}W · solar ${v.solarW ?? "?"}W`,
    );
  }
  return lines;
}

function buildDaySummary({ day, kind, snap, morning }) {
  const lines = [
    `**Solar ${kind} report** — HST day **${day}**`,
    "",
    `Bank blend: **${snap?.batteryPct ?? "?"}%**`,
    ...buildLiveLines(snap),
  ];
  if (morning?.siteAvgW != null) {
    lines.push(
      "",
      `Morning cycle avg (today only): **~${Math.round(morning.siteAvgW)}W** site` +
        (morning.siteMinutes != null ? ` · ${morning.siteMinutes} site-minutes` : ""),
    );
  }
  lines.push(
    "",
    ...solarLinksFooterLines(),
    "",
    "New day cycle — prior-day minute buckets stay in history files but are **not** mixed into today's live/morning boards.",
    "",
    "— Ava",
  );
  return lines.join("\n");
}

/**
 * Tick from eco poll loop. Posts at most one midnight + one morning report per HST day.
 */
export async function tickSolarDayCycle({ channelId } = {}) {
  const ch = channelId || AVA_CHANNELS.updates || AVA_CHANNELS.general;
  const state = loadState();
  const { hour, minute, day } = hstParts();
  const out = { day, actions: [] };

  // Start / roll active day
  if (state.activeDay && state.activeDay !== day) {
    // Crossed midnight — close previous day if we haven't reported yet
    if (state.lastMidnightReportDay !== state.activeDay) {
      try {
        const snap = loadEcoSnapshot() || (await refreshEcoFlow());
        const morning = summarizeMorningSolar({ tzOffsetHours: -10 });
        const body = buildDaySummary({
          day: state.activeDay,
          kind: "midnight close",
          snap,
          morning,
        });
        fs.mkdirSync(daysDir(), { recursive: true });
        fs.writeFileSync(
          path.join(daysDir(), `${state.activeDay}.json`),
          JSON.stringify(
            {
              day: state.activeDay,
              closedAt: Date.now(),
              bankPct: snap?.batteryPct ?? null,
              perSn: snap?.perSn || {},
              morning,
            },
            null,
            2,
          ),
          "utf8",
        );
        await postAvaDiscord({
          channelId: ch,
          content: body,
          kind: "solar_midnight",
          source: "solar-day-cycle",
        });
        state.lastMidnightReportDay = state.activeDay;
        out.actions.push(`midnight_close:${state.activeDay}`);
      } catch (err) {
        out.error = err.message;
      }
    }
  }

  if (state.activeDay !== day) {
    state.activeDay = day;
    out.actions.push(`active_day:${day}`);
  }

  // Morning open report — after 08:00 HST once per day (matches Alex "not before 8AM" fresh scans)
  if (
    hour >= 8 &&
    state.lastMorningReportDay !== day &&
    !(hour === 8 && minute < 1)
  ) {
    try {
      const snap = await refreshEcoFlow().catch(() => loadEcoSnapshot());
      const morning = summarizeMorningSolar({ tzOffsetHours: -10 });
      const body = buildDaySummary({
        day,
        kind: "morning open",
        snap,
        morning,
      });
      await postAvaDiscord({
        channelId: ch,
        content: body,
        kind: "solar_morning",
        source: "solar-day-cycle",
      });
      state.lastMorningReportDay = day;
      out.actions.push(`morning_open:${day}`);
    } catch (err) {
      out.error = err.message;
    }
  }

  // Near-midnight catch (23:55–00:05): if still on same day and late, close today for next tick
  if (hour === 0 && minute <= 10 && state.lastMidnightReportDay !== day) {
    // Day already rolled; midnight close of *previous* handled above.
  }

  saveState(state);
  return out;
}
