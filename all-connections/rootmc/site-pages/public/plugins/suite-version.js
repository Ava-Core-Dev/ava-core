/** Fill [data-live-suite-version] from live manifest.json (no hardcoded jar line). */
(function () {
  var nodes = document.querySelectorAll("[data-live-suite-version]");
  if (!nodes.length) return;
  fetch("/plugins/manifest.json?v=" + Date.now(), { cache: "no-store" })
    .then(function (r) {
      return r.ok ? r.json() : {};
    })
    .then(function (m) {
      var ver = m && m["root-core"] && m["root-core"].version;
      if (!ver && m) {
        var counts = {};
        Object.keys(m).forEach(function (k) {
          var v = m[k] && m[k].version;
          if (v) counts[v] = (counts[v] || 0) + 1;
        });
        ver = Object.keys(counts).sort(function (a, b) {
          return counts[b] - counts[a];
        })[0];
      }
      nodes.forEach(function (el) {
        el.textContent = ver || "manifest";
      });
    })
    .catch(function () {
      nodes.forEach(function (el) {
        el.textContent = "manifest";
      });
    });
})();
