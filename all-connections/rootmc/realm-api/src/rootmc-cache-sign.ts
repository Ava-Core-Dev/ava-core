/**
 * Optional HMAC signature on cacheable public GET responses (future launcher mesh).
 */

export async function signCacheableBody(
  body: string,
  keyMaterial: string,
): Promise<{ signature: string; timestamp: string } | null> {
  const key = String(keyMaterial || "").trim();
  if (!key || key.length < 16) return null;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = enc.encode(`${timestamp}.${body}`);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, payload);
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { signature: hex, timestamp };
}

export async function maybeAttachResponseSignature(
  response: Response,
  env: { ROOTMC_EDGE_SIGNING_KEY?: string },
): Promise<Response> {
  if (response.status !== 200) return response;
  if (response.headers.get("X-RootMC-Cacheable") !== "1") return response;
  const key = String(env.ROOTMC_EDGE_SIGNING_KEY || "").trim();
  if (!key) return response;
  const ct = response.headers.get("content-type") || "";
  if (!ct.includes("application/json") && !ct.includes("text/") && !ct.includes("image/")) {
    return response;
  }
  const body = await response.clone().text();
  const signed = await signCacheableBody(body, key);
  if (!signed) return response;
  const headers = new Headers(response.headers);
  headers.set("X-RootMC-Cache-Signature", signed.signature);
  headers.set("X-RootMC-Cache-Timestamp", signed.timestamp);
  headers.set("X-RootMC-Cache-Alg", "HMAC-SHA256");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
