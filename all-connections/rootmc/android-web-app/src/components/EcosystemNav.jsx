import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";

const LINKS = [
  { to: "/", key: "root", label: "The Root" },
  { href: "https://rootmc.net/", key: "rootmc", label: "RootMC" },
  { to: "/rootrecord", key: "rootrecord", label: "RootRecord" },
  { to: "/ava", key: "ava", label: "Ava" },
];

function EcoLink({ link, on, t, testId, onClick, className }) {
  const style = {
    color: on ? t.activeText : t.text,
    background: on ? "rgba(255,255,255,0.08)" : "transparent",
  };
  if (link.href) {
    return (
      <a href={link.href} data-testid={testId} onClick={onClick} className={className} style={style}>
        {link.label}
        {on && (
          <span
            className="absolute left-3.5 right-3.5 -bottom-[1px] h-[2px] rounded-full"
            style={{ background: t.accent }}
          />
        )}
      </a>
    );
  }
  return (
    <Link to={link.to} data-testid={testId} onClick={onClick} className={className} style={style}>
      {link.label}
      {on && (
        <span
          className="absolute left-3.5 right-3.5 -bottom-[1px] h-[2px] rounded-full"
          style={{ background: t.accent }}
        />
      )}
    </Link>
  );
}

/**
 * Shared ecosystem switcher used across the unified site (Portal / RootRecord / Ava).
 * RootMC always opens the live site at rootmc.net.
 */
export default function EcosystemNav({ active = "root", theme = {} }) {
  const [open, setOpen] = useState(false);
  const t = {
    bar: "rgba(10,18,16,0.72)",
    border: "rgba(255,255,255,0.10)",
    text: "rgba(255,255,255,0.62)",
    activeText: "#ffffff",
    accent: "#f0a83c",
    ...theme,
  };

  return (
    <header
      className="sticky top-0 z-50 backdrop-blur-xl"
      style={{ background: t.bar, borderBottom: `1px solid ${t.border}` }}
      data-testid="ecosystem-nav"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8 h-14 flex items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-2 shrink-0"
          data-testid="ecosystem-brand"
          style={{ color: t.activeText }}
        >
          <span
            className="h-6 w-6 rounded-md grid place-items-center text-[13px] font-black"
            style={{ background: t.accent, color: "#0a1210" }}
          >
            ✧
          </span>
          <span className="font-semibold tracking-tight text-[15px]">The Root</span>
        </Link>

        <nav className="hidden sm:flex items-center gap-1">
          {LINKS.map((l) => (
            <EcoLink
              key={l.key}
              link={l}
              on={l.key === active}
              t={t}
              testId={`eco-link-${l.key}`}
              className="relative px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors"
            />
          ))}
        </nav>

        <button
          className="sm:hidden p-1.5 rounded-md"
          style={{ color: t.activeText }}
          onClick={() => setOpen((v) => !v)}
          data-testid="eco-menu-toggle"
          aria-label="Menu"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div className="sm:hidden px-5 pb-3 flex flex-col gap-1" style={{ borderTop: `1px solid ${t.border}` }}>
          {LINKS.map((l) => (
            <EcoLink
              key={l.key}
              link={l}
              on={l.key === active}
              t={t}
              testId={`eco-mlink-${l.key}`}
              onClick={() => setOpen(false)}
              className="px-3 py-2.5 rounded-lg text-sm font-medium"
            />
          ))}
        </div>
      )}
    </header>
  );
}
