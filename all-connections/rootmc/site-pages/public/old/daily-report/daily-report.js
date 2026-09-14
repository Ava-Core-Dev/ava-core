(function () {
  var API = "/api/rootmc/daily-report";
  var LIMIT = 21;

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (_e) {
      return String(iso);
    }
  }

  function renderMarkdown(text) {
    var raw = String(text || "").trim();
    if (!raw) return "";
    return raw
      .split(/\n/)
      .map(function (line) {
        var t = line.trim();
        if (t.indexOf("## ") === 0) {
          return "<h3 class=\"daily-report-h3\">" + esc(t.slice(3)) + "</h3>";
        }
        if (t.indexOf("### ") === 0) {
          return "<h4 class=\"daily-report-h4\">" + esc(t.slice(4)) + "</h4>";
        }
        if (t.indexOf("- ") === 0) {
          return "<p class=\"daily-report-bullet\">" + esc(t.slice(2)).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") + "</p>";
        }
        return "<p>" + esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") + "</p>";
      })
      .join("");
  }

  function reportBlock(title, summary, body, meta) {
    var html = "<section class=\"daily-report-block\">";
    if (title) html += "<h3 class=\"daily-report-section-title\">" + esc(title) + "</h3>";
    if (meta) html += "<p class=\"rmc-muted daily-report-meta\">" + esc(meta) + "</p>";
    if (summary) html += "<p class=\"daily-report-summary\">" + esc(summary) + "</p>";
    if (body) html += "<div class=\"daily-report-body\">" + renderMarkdown(body) + "</div>";
    html += "</section>";
    return html;
  }

  async function load() {
    var subtitle = el("dr-subtitle");
    var errEl = el("dr-error");
    var list = el("dr-list");
    try {
      var res = await fetch(API + "?limit=" + LIMIT, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      var reports = Array.isArray(data.reports) ? data.reports : [];
      var daysBehind = Number(data.days_behind) || 0;
      var latestKey = data.latest_day_key || (reports[0] && reports[0].day_key) || "";
      var expectedKey = data.expected_day_key || "";
      var staleEl = el("dr-stale");
      if (daysBehind > 0) {
        staleEl.hidden = false;
        staleEl.textContent =
          "Archive is " + daysBehind + " day(s) behind (latest " + latestKey
          + (expectedKey ? ", expected through " + expectedKey : "")
          + "). The midnight HST cron backfills one day every 10 minutes until caught up.";
      } else {
        staleEl.hidden = true;
        staleEl.textContent = "";
      }
      subtitle.textContent = reports.length
        ? reports.length + " archived day(s) · latest " + (latestKey || "—")
        : "No archived reports yet.";
      if (!reports.length) {
        list.innerHTML = "<p class=\"rmc-muted\">Reports publish after the midnight HST cron.</p>";
        return;
      }
      list.innerHTML = reports.map(function (day) {
        var card = "<article class=\"rmc-card daily-report-day\">";
        card += "<header class=\"daily-report-day-head\">";
        card += "<h2>" + esc(day.day_key || "Day") + "</h2>";
        if (day.posted_at) card += "<time class=\"rmc-muted\">" + esc(fmtWhen(day.posted_at)) + "</time>";
        if (day.unchanged_from_prior) {
          card += "<span class=\"daily-report-badge\">Unchanged metrics</span>";
        }
        card += "</header>";
        card += reportBlock("Daily summary", day.summary, day.report_text);
        (day.categories || []).forEach(function (cat) {
          card += reportBlock(cat.title || cat.category, cat.summary, cat.report_text);
        });
        card += "</article>";
        return card;
      }).join("");
    } catch (e) {
      errEl.hidden = false;
      errEl.textContent = e && e.message ? e.message : "Could not load daily report.";
      subtitle.textContent = "Unavailable";
      list.innerHTML = "";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
