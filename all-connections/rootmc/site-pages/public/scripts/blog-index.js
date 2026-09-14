/** RootMC /blog/ filters: category, this-site vs linked, pagination. */
(function () {
  var PAGE = 8;
  var root = document.getElementById("blog-index");
  if (!root) return;
  var cards = Array.prototype.slice.call(root.querySelectorAll("[data-blog-card]"));
  var catBtns = document.querySelectorAll("[data-blog-cat]");
  var focusBtns = document.querySelectorAll("[data-blog-focus]");
  var pager = document.getElementById("blog-pager");
  var meta = document.getElementById("blog-page-meta");
  var params = new URLSearchParams(location.search);
  var cat = params.get("cat") || "";
  var focus = params.get("focus") === "all" ? "all" : "site";
  var page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);

  function writeUrl() {
    var q = new URLSearchParams();
    if (cat) q.set("cat", cat);
    if (focus === "all") q.set("focus", "all");
    if (page > 1) q.set("page", String(page));
    var s = q.toString();
    history.replaceState(null, "", s ? location.pathname + "?" + s : location.pathname);
  }

  function visible() {
    return cards.filter(function (el) {
      var cats = (el.getAttribute("data-cats") || "").split(/\s+/);
      var brand = el.getAttribute("data-brand") || "RootMC";
      if (focus === "site" && brand !== "RootMC") return false;
      if (cat && cats.indexOf(cat) < 0) return false;
      return true;
    });
  }

  function render() {
    var list = visible();
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (page > pages) page = pages;
    cards.forEach(function (el) {
      el.style.display = "none";
    });
    var start = (page - 1) * PAGE;
    list.slice(start, start + PAGE).forEach(function (el) {
      el.style.display = "";
    });
    if (meta) {
      meta.textContent = list.length + " post" + (list.length === 1 ? "" : "s") + " · page " + page + " of " + pages;
    }
    catBtns.forEach(function (b) {
      var id = b.getAttribute("data-blog-cat");
      b.classList.toggle("is-on", id === cat || (id === "" && !cat));
    });
    focusBtns.forEach(function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-blog-focus") === focus);
    });
    if (pager) {
      pager.innerHTML = "";
      if (pages > 1) {
        function add(label, n, on) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "blog-toggle" + (on ? " is-on" : "");
          btn.textContent = label;
          btn.disabled = n < 1 || n > pages;
          btn.addEventListener("click", function () {
            page = n;
            writeUrl();
            render();
            window.scrollTo(0, 0);
          });
          pager.appendChild(btn);
        }
        add("Previous", page - 1, false);
        for (var i = 1; i <= pages; i++) add(String(i), i, i === page);
        add("Next", page + 1, false);
      }
    }
    writeUrl();
  }

  catBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      cat = b.getAttribute("data-blog-cat") || "";
      page = 1;
      render();
    });
  });
  focusBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      focus = b.getAttribute("data-blog-focus") || "site";
      page = 1;
      render();
    });
  });
  render();
})();
