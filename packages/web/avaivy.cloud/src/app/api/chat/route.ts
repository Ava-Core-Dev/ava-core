import { NextResponse } from "next/server";

const LOGIN_REPLY =
  "The chat is here — log in to talk with me. Free accounts get 1 live use per IP, unlimited canned answers, and 3 resources.";

const GENERIC: Record<string, string> = {
  rootmc:
    "RootMC is survival Minecraft at play.rootmc.net — closed-loop Gold, claims, votes.",
  solar:
    "I run on the HI Pacific Solar Root Server — panels + battery on the Big Island.",
  kilauea:
    "Kīlauea and weather live under Root Record — real-world ops, not Minecraft.",
};

const ipUses = new Map<string, number>();

function clientIp(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  if (message.startsWith("__generic:")) {
    const key = message.slice("__generic:".length);
    return NextResponse.json({
      reply: GENERIC[key] || GENERIC.rootmc,
      brain: "canned",
      generic: true,
    });
  }

  const session = req.headers.get("cookie")?.includes("ava_session=");
  if (!session) {
    return NextResponse.json({
      reply: LOGIN_REPLY,
      gated: true,
      login: "/login",
      brain: "gate",
    });
  }

  const ip = clientIp(req);
  const used = ipUses.get(ip) || 0;
  if (used >= 1) {
    return NextResponse.json({
      reply:
        "Free live uses are spent for this IP. Unlimited canned answers stay open — upgrade for more live talks.",
      gated: true,
      brain: "free-limit",
    });
  }
  ipUses.set(ip, used + 1);

  return NextResponse.json({
    reply: LOGIN_REPLY,
    gated: true,
    brain: "origin",
    note: "live talk is origin-backed once session + quota allow",
  });
}
