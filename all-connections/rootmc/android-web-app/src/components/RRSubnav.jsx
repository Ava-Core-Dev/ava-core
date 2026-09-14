import React from "react";
import { Link } from "react-router-dom";

const INK = "#0B1F2A";
const MOSS = "#2F6B4F";
const ge = { fontFamily: "'Geist', system-ui, sans-serif" };

const items = [
  { to: "/rootrecord", key: "home", label: "Home" },
  { to: "/rootrecord#products", key: "products", label: "Products" },
  { to: "/rootrecord/pricing", key: "pricing", label: "Pricing" },
  { to: "/rootrecord/about", key: "about", label: "About" },
  { href: "https://rootrecord.online/blog", key: "blog", label: "Blog" },
];

/** Secondary in-section navigation for the RootRecord brand pages. */
export default function RRSubnav({ active = "home" }) {
  return (
    <div className="border-b" style={{ borderColor: "rgba(11,31,42,0.1)", background: "rgba(244,240,231,0.6)" }} data-testid="rr-subnav">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 h-12 flex items-center gap-1 overflow-x-auto" style={ge}>
        {items.map((it) => {
          const on = it.key === active;
          const className =
            "shrink-0 px-3.5 py-1.5 rounded-full text-[13.5px] font-medium transition-colors";
          const style = {
            color: on ? "#fff" : "rgba(11,31,42,0.6)",
            background: on ? MOSS : "transparent",
          };
          if (it.href) {
            return (
              <a
                key={it.key}
                href={it.href}
                data-testid={`rr-subnav-${it.key}`}
                className={className}
                style={style}
              >
                {it.label}
              </a>
            );
          }
          return (
            <Link
              key={it.key}
              to={it.to}
              data-testid={`rr-subnav-${it.key}`}
              className={className}
              style={style}
            >
              {it.label}
            </Link>
          );
        })}
        <a
          href="https://account.rootrecord.info/"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="rr-subnav-account"
          className="ml-auto shrink-0 px-3.5 py-1.5 rounded-full text-[13.5px] font-semibold"
          style={{ border: `1px solid ${INK}`, color: INK }}
        >
          Account
        </a>
      </div>
    </div>
  );
}
