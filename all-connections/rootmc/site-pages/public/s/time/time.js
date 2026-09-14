(function () {
  var S = window.RootMcServerSite;
  var serverId = S.serverIdFromPath();

  function el(id) {
    return document.getElementById(id);
  }

  function drawChart(samples) {
    var canvas = el("s-times-chart");
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!samples || samples.length < 2) {
      ctx.fillStyle = "#8aa0a8";
      ctx.font = "14px DM Sans, sans-serif";
      ctx.fillText("Not enough samples yet", 16, h / 2);
      return;
    }
    var maxY = 1;
    samples.forEach(function (s) {
      maxY = Math.max(maxY, (s.online || 0) + (s.afk || 0), s.online || 0);
    });
    function xAt(i) {
      return (i / (samples.length - 1)) * (w - 24) + 12;
    }
    function yAt(v) {
      return h - 16 - (v / maxY) * (h - 32);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(12, h - 16);
    ctx.lineTo(w - 12, h - 16);
    ctx.stroke();

    ctx.strokeStyle = "#3d9b8f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach(function (s, i) {
      var y = yAt(s.online || 0);
      if (i === 0) ctx.moveTo(xAt(i), y);
      else ctx.lineTo(xAt(i), y);
    });
    ctx.stroke();

    ctx.strokeStyle = "#f5b942";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    samples.forEach(function (s, i) {
      var y = yAt(s.afk || 0);
      if (i === 0) ctx.moveTo(xAt(i), y);
      else ctx.lineTo(xAt(i), y);
    });
    ctx.stroke();
  }

  function render(data, hub) {
    var name = (data && data.server_name) || (hub && hub.server_name) || "Server";
    document.title = "Time — " + name;
    window.RootMcServerChrome.mount({ serverId: serverId, serverName: name, current: "time" });
    el("s-times-home").href = S.basePath(serverId);

    if (!data) {
      el("s-times-status").textContent = "No Times data yet";
      el("s-times-online").textContent = "Install Root-Times and wait for cloud-status push.";
      return;
    }

    var staleNote = data.stale ? ' <span class="s-times-stale">(stale)</span>' : "";
    el("s-times-status").innerHTML =
      "Day #" +
      S.esc(data.dayId) +
      " · " +
      S.esc(data.todTicks) +
      " ticks (" +
      S.esc(data.phase) +
      ") · " +
      S.esc(data.lengthMinutes) +
      " min/day" +
      staleNote;
    el("s-times-online").textContent = data.online + " online · " + data.afk + " AFK";
    el("s-times-meta").textContent =
      (data.timezone || "UTC") +
      (data.updated_at ? " · updated " + data.updated_at.replace("T", " ").replace(/\.\d+Z$/, " UTC") : "");
    el("s-times-peak").textContent = "Peak online (48h samples): " + (data.peak_online_48h || 0);

    var list = el("s-times-players");
    list.innerHTML = "";
    (data.players || []).forEach(function (p) {
      var li = document.createElement("li");
      li.textContent = p.name + (p.afk ? " (AFK)" : "");
      if (p.afk) li.className = "afk";
      list.appendChild(li);
    });
    if (!(data.players || []).length) {
      list.innerHTML = '<li class="rmc-muted">No one online</li>';
    }

    drawChart(data.samples || []);
  }

  function refresh() {
    return Promise.all([S.fetchTimes(serverId), S.fetchHub(serverId)]).then(function (pair) {
      render(pair[0], pair[1]);
    });
  }

  if (!serverId) {
    el("s-times-status").textContent = "Missing server id";
    return;
  }
  window.RootMcServerChrome.mount({ serverId: serverId, serverName: "Server", current: "time" });
  el("s-times-home").href = S.basePath(serverId);
  refresh();
  setInterval(refresh, 5000);
})();
