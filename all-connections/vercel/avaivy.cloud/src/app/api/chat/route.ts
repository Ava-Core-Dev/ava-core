import { NextResponse } from "next/server";
import { DIRECTORY, matchPublicReply } from "@/lib/publicReplies";

const ORIGIN = process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  const canned = matchPublicReply(message);
  if (canned) return NextResponse.json(canned);

  try {
    const r = await fetch(`${ORIGIN}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") || "",
      },
      body: JSON.stringify({ message, context: body.context || "" }),
      signal: AbortSignal.timeout(20000),
    });
    if (r.ok) {
      const data = await r.json();
      if (data?.reply) return NextResponse.json(data);
    }
  } catch {
    /* origin dark — fall through */
  }

  return NextResponse.json({
    reply: DIRECTORY,
    brain: "directory",
    login: "https://rootmc.net/login/",
  });
}
