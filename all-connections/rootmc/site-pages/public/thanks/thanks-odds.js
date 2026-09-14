(function () {
  const bands = [
    { a: 1, b: 50, label: "1–50", role: "Junk / weak" },
    { a: 51, b: 100, label: "51–100", role: "Low utility" },
    { a: 101, b: 150, label: "101–150", role: "Mid" },
    { a: 151, b: 200, label: "151–200", role: "Strong" },
    { a: 201, b: 9999, label: "201+", role: "Apex" },
  ];

  const metaEl = document.getElementById("odds-meta");
  const bodyEl = document.getElementById("odds-body");
  const filterEl = document.getElementById("odds-filter");
  const sortEl = document.getElementById("odds-sort");
  const bandEl = document.getElementById("band-cards");
  if (!metaEl || !bodyEl) return;

  let rows = [];
  let weightSum = 1;

  function pct(weight) {
    return (100 * weight) / weightSum;
  }

  function renderBands() {
    if (!bandEl) return;
    bandEl.innerHTML = bands
      .map((b) => {
        const share = rows
          .filter((r) => r.rank >= b.a && r.rank <= b.b)
          .reduce((s, r) => s + pct(r.weight), 0);
        return `<div class="band-card"><strong>${share.toFixed(2)}%</strong><span>${b.label} · ${b.role}</span></div>`;
      })
      .join("");
  }

  function sortedFiltered() {
    const q = (filterEl?.value || "").trim().toLowerCase();
    let list = rows.slice();
    if (q) {
      list = list.filter(
        (r) =>
          r.entry.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          (r.kind || "").toLowerCase().includes(q)
      );
    }
    const mode = sortEl?.value || "prob-desc";
    if (mode === "rank") list.sort((a, b) => a.rank - b.rank);
    else if (mode === "prob-asc") list.sort((a, b) => a.weight - b.weight || a.rank - b.rank);
    else list.sort((a, b) => b.weight - a.weight || a.rank - b.rank);
    return list;
  }

  function renderTable() {
    const list = sortedFiltered();
    bodyEl.innerHTML = list
      .map((r) => {
        const p = pct(r.weight);
        const oneIn = Math.max(1, Math.round(100 / p));
        return `<tr>
          <td class="num">${p.toFixed(4)}</td>
          <td class="num">${oneIn.toLocaleString()}</td>
          <td class="num">${r.rank}</td>
          <td>${escapeHtml(r.entry)}</td>
          <td class="num">${r.qty}</td>
        </tr>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  fetch("/thanks/rewards.json")
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((data) => {
      rows = data.rewards || [];
      weightSum = data.weightSum || rows.reduce((s, r) => s + (r.weight || 0), 0) || 1;
      metaEl.textContent = `${rows.length} rewards · formula ${data.formula || "(248−rank)^1.2"} · weights sum ${weightSum.toLocaleString()}`;
      renderBands();
      renderTable();
    })
    .catch((err) => {
      metaEl.textContent = "Could not load odds catalog (" + err.message + ").";
    });

  filterEl?.addEventListener("input", renderTable);
  sortEl?.addEventListener("change", renderTable);
})();
