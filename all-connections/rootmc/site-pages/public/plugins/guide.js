/** Wire version badge, download button, and bStats link from manifest + data-bstats-url. */
(function () {
  var id = document.body && document.body.getAttribute("data-plugin-id");
  if (!id) return;

  var bstatsUrl = document.body.getAttribute("data-bstats-url");
  var bstatsEl = document.getElementById("guide-bstats-link");
  if (bstatsEl && bstatsUrl) {
    bstatsEl.href = bstatsUrl;
    bstatsEl.hidden = false;
    bstatsEl.style.display = "";
  }

  fetch("/plugins/manifest.json?v=" + Date.now(), { cache: "no-store" })
    .then(function (r) {
      return r.ok ? r.json() : {};
    })
    .then(function (m) {
      var e = m && m[id];
      var badge = document.getElementById("guide-version-badge");
      var btn = document.getElementById("guide-download-btn");
      if (!e) {
        if (badge) badge.textContent = "Not in manifest";
        return;
      }
      if (badge && e.version) badge.textContent = "v" + e.version;
      if (btn && e.url) {
        btn.href = e.url;
        btn.setAttribute("download", e.filename || "");
        btn.textContent = "Download " + (e.filename || id + ".jar");
      }
    })
    .catch(function () {
      var badge = document.getElementById("guide-version-badge");
      if (badge) badge.textContent = "Version unavailable";
    });
})();
