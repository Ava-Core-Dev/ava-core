import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const loggedIn = Boolean(req.headers.get("cookie")?.includes("ava_session="));
  return NextResponse.json({
    loggedIn,
    free: {
      liveUsesPerIp: 1,
      genericUnlimited: true,
      resources: 3,
    },
    login: "/login",
  });
}
