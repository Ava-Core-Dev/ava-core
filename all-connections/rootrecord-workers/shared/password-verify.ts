/**
 * Shared `license_accounts` password verification for rootrecord-primary + rootrecord-license.
 * Apps send plaintext to the API; rows may have been created with different PBKDF2 params or encodings.
 * Canonical new + upgraded rows: PBKDF2-HMAC-SHA256, 100k iters (Cloudflare Web Crypto caps PBKDF2 at 100k; see workerd),
 * 16-byte random salt as base64url, hash as base64url (32 bytes).
 * Iterations above 100k use @noble/hashes PBKDF2 (async) so legacy rows (e.g. 120k/600k) still verify.
 * Password material: UTF-8 (Web defaults) plus UTF-16LE with/without BOM for .NET `Encoding.Unicode` / legacy Rfc2898DeriveBytes-style rows.
 */

import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha1 } from "@noble/hashes/sha1";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";

/** Canonical storage for new signups and post-verify upgrades (must be ≤ Cloudflare Web Crypto PBKDF2 iteration cap). */
export const LICENSE_PBKDF2_ITERATIONS = 100_000;

/** Cloudflare Workers `crypto.subtle.deriveBits` rejects PBKDF2 iteration counts above this (workerd limit). */
const WEBCRYPTO_PBKDF2_MAX_ITERATIONS = 100_000;

/**
 * PBKDF2 iteration counts for legacy rows. Keep lists short: each failed login walks the full grid,
 * and high iterations (600k+) × many PRFs exceed the Worker CPU budget (1102).
 */
const PBKDF2_ITERATIONS_SHA256 = [
  100_000, 120_000, 50_000, 25_000, 10_000, 5_000, 2_048, 1_000, 310_000, 210_000, 300_000, 250_000,
] as const;
const PBKDF2_ITERATIONS_SHA1 = [1_000, 10_000, 100_000, 120_000] as const;
const PBKDF2_ITERATIONS_SHA512 = [100_000, 120_000, 310_000, 210_000, 50_000, 10_000, 1_000] as const;
const OUTPUT_BITS_SHA256_SHA1 = [256, 160] as const;
/** 384/512-bit SHA-512 PBKDF2 is rare; 256-bit covers ASP.NET-style subkeys without 3× CPU cost. */
const OUTPUT_BITS_SHA512 = [256] as const;

type Pbkdf2Prf = "SHA-256" | "SHA-1" | "SHA-512";

/** PBKDF2 "password" input bytes — UTF-8, UTF-16 LE/BE, BOM variants (.NET Unicode / BigEndianUnicode). */
const PASSWORD_MATERIAL_ENCODINGS = ["utf8", "utf16le", "utf16le-bom", "utf16be"] as const;
type PasswordMaterialEncoding = (typeof PASSWORD_MATERIAL_ENCODINGS)[number];

function passwordMaterialBytes(password: string, enc: PasswordMaterialEncoding): Uint8Array {
  if (enc === "utf8") return new TextEncoder().encode(password);
  const len = password.length;
  const body = new Uint8Array(len * 2);
  for (let i = 0; i < len; i++) {
    const c = password.charCodeAt(i);
    body[i * 2] = c & 0xff;
    body[i * 2 + 1] = (c >> 8) & 0xff;
  }
  if (enc === "utf16le") return body;
  if (enc === "utf16be") {
    const be = new Uint8Array(len * 2);
    for (let i = 0; i < len; i++) {
      const c = password.charCodeAt(i);
      be[i * 2] = (c >> 8) & 0xff;
      be[i * 2 + 1] = c & 0xff;
    }
    return be;
  }
  const out = new Uint8Array(2 + body.byteLength);
  out[0] = 0xff;
  out[1] = 0xfe;
  out.set(body, 2);
  return out;
}


export function b64url(buf: ArrayBuffer | ArrayBufferView): string {
  const u =
    buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlEncodeUtf8(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

export function b64urlToBytes(s: string): Uint8Array {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function tryB64urlToBytes(s: string): Uint8Array | null {
  try {
    const u = b64urlToBytes(s);
    return u.byteLength ? u : null;
  } catch {
    return null;
  }
}

function tryHexToBytes(s: string): Uint8Array | null {
  const t = s.trim();
  if (!/^[0-9a-fA-F]+$/.test(t) || t.length % 2 !== 0 || t.length < 16) return null;
  try {
    const out = new Uint8Array(t.length / 2);
    for (let i = 0; i < t.length; i += 2) {
      out[i / 2] = Number.parseInt(t.slice(i, i + 2), 16);
    }
    return out.byteLength ? out : null;
  } catch {
    return null;
  }
}

function bytesToHexLower(u: Uint8Array): string {
  let h = "";
  for (let i = 0; i < u.length; i++) h += u[i]!.toString(16).padStart(2, "0");
  return h;
}

function tryStdBase64ToBytes(s: string): Uint8Array | null {
  try {
    const t = s.trim();
    if (!t) return null;
    const b = t.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b.length % 4 ? 4 - (b.length % 4) : 0;
    const bin = atob(b + "=".repeat(pad));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.byteLength ? out : null;
  } catch {
    return null;
  }
}

function saltVariants(saltRaw: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  const seen = new Set<string>();
  const push = (u: Uint8Array | null) => {
    if (!u || !u.byteLength) return;
    const key = bytesToHexLower(u);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(u);
  };
  push(tryB64urlToBytes(saltRaw));
  push(tryStdBase64ToBytes(saltRaw));
  push(tryHexToBytes(saltRaw));
  const utf8Salt = new TextEncoder().encode(saltRaw);
  if (utf8Salt.byteLength >= 8) push(utf8Salt);
  return out;
}

function stdBase64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!);
  return btoa(s);
}

function eqStrSafe(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function storedEqualsStoredHash(stored: string, derived: Uint8Array): boolean {
  const st = stored.trim();
  if (!st) return false;
  const b64 = b64url(derived);
  if (eqStrSafe(st, b64)) return true;
  const hex = bytesToHexLower(derived);
  if (eqStrSafe(st.toLowerCase(), hex)) return true;
  const sb = stdBase64(derived);
  if (eqStrSafe(st, sb)) return true;
  return false;
}

function nobleHashFn(prf: Pbkdf2Prf) {
  if (prf === "SHA-256") return sha256;
  if (prf === "SHA-1") return sha1;
  return sha512;
}

async function tryDeriveRawNoble(
  password: string,
  saltBytes: Uint8Array,
  iterations: number,
  prf: Pbkdf2Prf,
  outBits: number,
  passwordEncoding: PasswordMaterialEncoding
): Promise<Uint8Array | null> {
  try {
    const pw = passwordMaterialBytes(password, passwordEncoding);
    const h = nobleHashFn(prf);
    const dkLen = outBits / 8;
    return await pbkdf2Async(h, pw, saltBytes, { c: iterations, dkLen });
  } catch {
    return null;
  }
}

async function tryDeriveRaw(
  password: string,
  saltBytes: Uint8Array,
  iterations: number,
  prf: Pbkdf2Prf,
  outBits: number,
  passwordEncoding: PasswordMaterialEncoding = "utf8"
): Promise<Uint8Array | null> {
  if (iterations > WEBCRYPTO_PBKDF2_MAX_ITERATIONS || prf === "SHA-512") {
    return tryDeriveRawNoble(password, saltBytes, iterations, prf, outBits, passwordEncoding);
  }
  try {
    const pw = passwordMaterialBytes(password, passwordEncoding);
    const keyMaterial = await crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations, hash: prf },
      keyMaterial,
      outBits
    );
    return new Uint8Array(bits);
  } catch {
    return null;
  }
}

export async function deriveCanonicalPasswordHash(password: string, saltB64url: string): Promise<string> {
  const salt = tryB64urlToBytes(saltB64url);
  if (!salt) throw new Error("invalid salt");
  const raw = await tryDeriveRaw(password, salt, LICENSE_PBKDF2_ITERATIONS, "SHA-256", 256, "utf8");
  if (!raw) throw new Error("derive failed");
  return b64url(raw);
}

export async function hashNewAccountCredentials(password: string): Promise<{ salt: string; password_hash: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = b64url(saltBytes);
  const password_hash = await deriveCanonicalPasswordHash(password, salt);
  return { salt, password_hash };
}

export type VerifyLicensePasswordResult =
  | { ok: true; needsUpgrade: boolean; password_hash: string; salt: string }
  | { ok: false };

/**
 * Returns whether the password matches the stored row; if so, `password_hash` + `salt` are the
 * canonical form to persist when `needsUpgrade` is true (any legacy PRF/iter/encoding/salt shape).
 */
function passwordCandidatesForVerify(password: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (!s || out.includes(s)) return;
    out.push(s);
  };
  add(password);
  add(password.trim());
  add(password.replace(/\r\n/g, "\n"));
  add(password.replace(/\r\n/g, "\n").trimEnd());
  try {
    if (typeof password.normalize === "function") {
      add(password.normalize("NFC"));
      add(password.normalize("NFD"));
    }
  } catch {
    /* ignore */
  }
  return out.length ? out : [password];
}

/** Modern rows: 16-byte salt + 32-byte hash as base64url (see LICENSE_PBKDF2_ITERATIONS). */
function looksLikeCanonicalCredentialRow(storedHash: string, saltRaw: string): boolean {
  const hashBytes = tryB64urlToBytes(storedHash);
  const saltBytes = tryB64urlToBytes(saltRaw);
  return hashBytes != null && hashBytes.byteLength === 32 && saltBytes != null && saltBytes.byteLength === 16;
}

async function tryCanonicalMatch(tryPw: string, saltBytes: Uint8Array, storedHash: string): Promise<boolean> {
  const raw = await tryDeriveRaw(tryPw, saltBytes, LICENSE_PBKDF2_ITERATIONS, "SHA-256", 256, "utf8");
  return raw != null && storedEqualsStoredHash(storedHash, raw);
}

export async function verifyLicenseAccountPassword(
  password: string,
  saltRaw: string,
  storedHashRaw: string
): Promise<VerifyLicensePasswordResult> {
  const storedHash = String(storedHashRaw || "").trim();
  const saltStr = String(saltRaw || "").trim();
  if (!storedHash || !saltStr) return { ok: false };

  const salts = saltVariants(saltStr);
  if (!salts.length) return { ok: false };

  const canonicalRow = looksLikeCanonicalCredentialRow(storedHash, saltStr);
  let matchedSalt: Uint8Array | null = null;
  let matchedPassword = "";

  outer: for (const tryPw of passwordCandidatesForVerify(password)) {
    for (const saltBytes of salts) {
      if (await tryCanonicalMatch(tryPw, saltBytes, storedHash)) {
        matchedSalt = saltBytes;
        matchedPassword = tryPw;
        break outer;
      }
    }
  }

  if (!matchedSalt && canonicalRow) {
    return { ok: false };
  }

  const legacyBudget = { left: 28 };

  const tryMatchLegacy = async (tryPw: string, saltBytes: Uint8Array): Promise<boolean> => {
    for (const pwEnc of PASSWORD_MATERIAL_ENCODINGS) {
      for (const iter of PBKDF2_ITERATIONS_SHA256) {
        for (const bits of OUTPUT_BITS_SHA256_SHA1) {
          if (legacyBudget.left-- <= 0) return false;
          const raw = await tryDeriveRaw(tryPw, saltBytes, iter, "SHA-256", bits, pwEnc);
          if (raw && storedEqualsStoredHash(storedHash, raw)) return true;
        }
      }
      for (const iter of PBKDF2_ITERATIONS_SHA1) {
        for (const bits of OUTPUT_BITS_SHA256_SHA1) {
          if (legacyBudget.left-- <= 0) return false;
          const raw = await tryDeriveRaw(tryPw, saltBytes, iter, "SHA-1", bits, pwEnc);
          if (raw && storedEqualsStoredHash(storedHash, raw)) return true;
        }
      }
      for (const iter of PBKDF2_ITERATIONS_SHA512) {
        for (const bits of OUTPUT_BITS_SHA512) {
          if (legacyBudget.left-- <= 0) return false;
          const raw = await tryDeriveRaw(tryPw, saltBytes, iter, "SHA-512", bits, pwEnc);
          if (raw && storedEqualsStoredHash(storedHash, raw)) return true;
        }
      }
    }
    return false;
  };

  if (!matchedSalt) {
    outerLegacy: for (const tryPw of passwordCandidatesForVerify(password)) {
      for (const saltBytes of salts) {
        if (await tryMatchLegacy(tryPw, saltBytes)) {
          matchedSalt = saltBytes;
          matchedPassword = tryPw;
          break outerLegacy;
        }
        if (legacyBudget.left <= 0) break outerLegacy;
      }
    }
  }

  if (!matchedSalt || !matchedPassword) return { ok: false };

  const canonicalSalt = b64url(matchedSalt);
  let canonicalHash: string;
  try {
    canonicalHash = await deriveCanonicalPasswordHash(matchedPassword, canonicalSalt);
  } catch {
    return { ok: false };
  }

  const needsUpgrade = canonicalHash !== storedHash || canonicalSalt !== saltStr;
  return { ok: true, needsUpgrade, password_hash: canonicalHash, salt: canonicalSalt };
}
