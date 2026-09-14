import React, { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import Portal from "./pages/Portal";
import RootRecord from "./pages/RootRecord";
import RootRecordPricing from "./pages/RootRecordPricing";
import RootRecordAbout from "./pages/RootRecordAbout";
import Ava from "./pages/Ava";

/** RootMC production site is rootmc.net — not the Emergent phone terminal. */
function GoRootMc() {
  useEffect(() => {
    window.location.replace("https://rootmc.net/");
  }, []);
  return (
    <div className="min-h-screen grid place-items-center bg-[#0a0f10] text-[#e8efe9] px-6 text-center">
      <div>
        <p className="text-sm uppercase tracking-[0.25em] text-[#f0a83c] font-semibold">RootMC</p>
        <p className="mt-3 text-lg">Opening the live site…</p>
        <a className="mt-4 inline-block text-[#f0a83c] underline" href="https://rootmc.net/">
          rootmc.net
        </a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Portal />} />
        <Route path="/rootrecord" element={<RootRecord />} />
        <Route path="/rootrecord/pricing" element={<RootRecordPricing />} />
        <Route path="/rootrecord/about" element={<RootRecordAbout />} />
        <Route path="/ava" element={<Ava />} />
        <Route path="/rootmc/*" element={<GoRootMc />} />
        <Route path="*" element={<Portal />} />
      </Routes>
    </AuthProvider>
  );
}
