import React from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import BottomNav from "./components/BottomNav";
import SideNav from "./components/SideNav";
import TopBar from "./components/TopBar";
import TickerStrip from "./components/TickerStrip";
import ServerHealthBanner from "./components/ServerHealthBanner";
import Home from "./pages/Home";
import Market from "./pages/Market";
import MarketDetail from "./pages/MarketDetail";
import Portfolio from "./pages/Portfolio";
import Rewards from "./pages/Rewards";
import Auth from "./pages/Auth";
import Leaderboards from "./pages/Leaderboards";
import More from "./pages/More";

export default function RootMCApp() {
  const location = useLocation();
  const hideChrome = location.pathname === "/rootmc/auth";
  return (
    <div className="min-h-screen relative bg-bg-base" data-testid="rootmc-app">
      {!hideChrome && <SideNav />}
      <div className={!hideChrome ? "md:pl-56" : ""}>
        {!hideChrome && (
          <>
            <TopBar />
            <ServerHealthBanner />
            <TickerStrip />
          </>
        )}
        <div className={!hideChrome ? "mx-auto w-full max-w-6xl pb-safe md:pb-8" : "min-h-screen"}>
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="" element={<Home />} />
              <Route path="market" element={<Market />} />
              <Route path="market/:ticker" element={<MarketDetail />} />
              <Route path="portfolio" element={<Portfolio />} />
              <Route path="rewards" element={<Rewards />} />
              <Route path="leaderboards" element={<Leaderboards />} />
              <Route path="more" element={<More />} />
              <Route path="auth" element={<Auth />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </AnimatePresence>
        </div>
        {!hideChrome && <BottomNav />}
      </div>
    </div>
  );
}
