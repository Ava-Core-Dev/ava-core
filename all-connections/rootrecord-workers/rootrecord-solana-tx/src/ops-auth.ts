async function sha256DigestBytes(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

function timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const ua = new Uint8Array(a);
  const ub = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i]! ^ ub[i]!;
  return diff === 0;
}

async function verifyPushAdminKey(headerVal: string | null, secret: string): Promise<boolean> {
  const h = (headerVal || "").trim();
  const s = (secret || "").trim();
  if (!h || !s) return false;
  const pHash = await sha256DigestBytes(h);
  const sHash = await sha256DigestBytes(s);
  return timingSafeEqual(pHash, sHash);
}

/** Same gate as rootrecord-primary internal routes (`X-RR-Push-Admin-Key` vs `RR_PUSH_ADMIN_SECRET`). */
export async function verifyWorkerOpsAdmin(
  request: Request,
  env: { RR_PUSH_ADMIN_SECRET?: string },
): Promise<boolean> {
  const secret = (env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!secret) return false;
  return verifyPushAdminKey(request.headers.get("X-RR-Push-Admin-Key"), secret);
}
