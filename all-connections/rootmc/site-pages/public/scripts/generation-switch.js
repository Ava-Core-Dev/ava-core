/** Server switcher — Towny/Claims/gen retired.
 * Future: Test ↔ Production only (ENABLE_TEST_PROD_SWITCH = true when cutover UI is wanted).
 * Until then this script mounts nothing.
 */
(function () {
  var ENABLE_TEST_PROD_SWITCH = false; // not needed right away

  function mount() {
    // Remove any leftover Towny/Claims/gen switch hosts
    document.querySelectorAll("[data-generation-switch], .generation-switch").forEach(function (el) {
      el.remove();
    });
    if (!ENABLE_TEST_PROD_SWITCH) return;
    // Stub for later: Test | Production
    // host.innerHTML = '<a ... title="Test">Test</a><a ... title="Production">Prod</a>';
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
  document.addEventListener("rootmc:nav-ready", mount);
})();
