import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, LineChart, Wallet, Gift, MoreHorizontal, Trophy } from "lucide-react";

export const ROOTMC_NAV = [
  { to: "/rootmc", label: "Home", icon: Home, testId: "nav-home", end: true },
  { to: "/rootmc/market", label: "Market", icon: LineChart, testId: "nav-market" },
  { to: "/rootmc/portfolio", label: "Portfolio", icon: Wallet, testId: "nav-portfolio" },
  { to: "/rootmc/rewards", label: "Rewards", icon: Gift, testId: "nav-rewards" },
  { to: "/rootmc/leaderboards", label: "Boards", icon: Trophy, testId: "nav-leaderboards", desktopOnly: true },
  { to: "/rootmc/more", label: "More", icon: MoreHorizontal, testId: "nav-more" },
];

export function isRootMcNavActive(pathname, to, end) {
  if (end || to === "/rootmc") return pathname === "/rootmc" || pathname === "/rootmc/";
  return pathname.startsWith(to);
}

/** Mobile bottom tab bar — hidden from md up (desktop uses SideNav). */
export default function BottomNav() {
  const { pathname } = useLocation();
  const items = ROOTMC_NAV.filter((i) => !i.desktopOnly);
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 md:hidden bg-bg-base/85 backdrop-blur-xl border-t border-white/10"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      data-testid="bottom-nav"
    >
      <ul className="grid grid-cols-5 max-w-lg mx-auto">
        {items.map(({ to, label, icon: Icon, testId, end }) => {
          const active = isRootMcNavActive(pathname, to, end);
          return (
            <li key={to}>
              <NavLink
                to={to}
                end={!!end}
                data-testid={testId}
                className="relative flex flex-col items-center justify-center py-2.5 gap-0.5 min-h-[56px]"
              >
                <Icon
                  size={20}
                  strokeWidth={active ? 2.4 : 1.8}
                  className={active ? "text-gold" : "text-text-secondary"}
                />
                <span
                  className={`text-[10px] font-mono uppercase tracking-[0.15em] ${
                    active ? "text-white" : "text-text-secondary"
                  }`}
                >
                  {label}
                </span>
                {active && (
                  <span className="absolute top-1 h-0.5 w-8 rounded-full bg-gold" />
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
