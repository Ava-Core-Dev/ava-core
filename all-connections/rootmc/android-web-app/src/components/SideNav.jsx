import React from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ROOTMC_NAV, isRootMcNavActive } from "./BottomNav";

/** Desktop left rail — md+ only. */
export default function SideNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <aside
      className="hidden md:flex fixed inset-y-0 left-0 z-50 w-56 flex-col border-r border-white/10 bg-bg-base/95 backdrop-blur-xl"
      data-testid="side-nav"
    >
      <button
        type="button"
        onClick={() => navigate("/")}
        className="flex items-center gap-2.5 px-5 py-5 border-b border-white/5 text-left hover:bg-white/[0.03]"
        data-testid="sidenav-root-link"
      >
        <div className="h-9 w-9 rounded-md bg-gold/10 border border-gold/30 grid place-items-center">
          <span className="font-display font-extrabold text-gold text-sm tracking-tight">R</span>
        </div>
        <div className="leading-tight">
          <div className="font-display font-extrabold tracking-tight text-white text-sm">
            ROOTMC<span className="text-gold">.</span>
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
            Terminal
          </div>
        </div>
      </button>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {ROOTMC_NAV.map(({ to, label, icon: Icon, testId, end }) => {
          const active = isRootMcNavActive(pathname, to, end);
          return (
            <NavLink
              key={to}
              to={to}
              end={!!end}
              data-testid={`side-${testId}`}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-gold/10 text-gold border border-gold/25"
                  : "text-text-secondary hover:text-white hover:bg-white/5 border border-transparent"
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
              <span className="font-medium tracking-wide">{label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-white/5 text-[11px] font-mono text-text-secondary leading-relaxed">
        play.rootmc.net
        <br />
        <a className="text-gold/80 hover:text-gold" href="https://rootmc.net" target="_blank" rel="noreferrer">
          rootmc.net ↗
        </a>
      </div>
    </aside>
  );
}
