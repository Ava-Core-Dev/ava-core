/* Ava OBS card overlays — shared fetch helpers */
window.AVA_ORIGIN = window.AVA_ORIGIN || "__ORIGIN__";
window.avaFetch = async function (path) {
  const r = await fetch((window.AVA_ORIGIN || "") + path, { cache: "no-store" });
  return r.json();
};
window.avaWatts = function (v) {
  if (v == null || v === "") return "—";
  return Math.round(Number(v)) + " W";
};
window.avaPct = function (v) {
  if (v == null || v === "") return "—";
  return Number(v).toFixed(0) + "%";
};
window.avaEsc = function (s) {
  return String(s || "").replace(/</g, "&lt;");
};
window.avaHstClock = function (el) {
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "Pacific/Honolulu",
  }) + " HST";
};
window.avaHstDate = function (el) {
  if (!el) return;
  el.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: "Pacific/Honolulu",
  });
};
window.avaDur = function (s) {
  s = Number(s) || 0;
  if (!s) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return d + "d " + h + "h";
  return h + "h " + m + "m";
};
window.avaEvery = function (fn, ms) {
  fn();
  return setInterval(fn, ms);
};
