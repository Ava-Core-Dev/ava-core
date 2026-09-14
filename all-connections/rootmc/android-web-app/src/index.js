import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

const root = createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <App />
    <Toaster
      position="bottom-center"
      theme="dark"
      offset="80px"
      toastOptions={{
        duration: 2600,
        style: {
          background: "#121212",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "#fff",
          fontFamily: "Manrope, sans-serif",
        },
      }}
    />
  </BrowserRouter>
);

// Phase 2: register PWA service worker (offline shell + install prompt)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch(() => { /* SW is best-effort */ });
  });
}
