const COOKIE_NAME = "airq_wallboard_session";
const API_COOKIE_NAME = "airq_api_credential";
const SESSION_DAYS = 30;
const API_KEY_DAYS = 120;

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function signature(secret: string, expires: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`airq-wallboard:${expires}`)));
}

function cookieValue(request: Request, cookieName = COOKIE_NAME) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) return rest.join("=");
  }
  return null;
}

function base64UrlEncode(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function apiEncryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`airq-api:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function passwordHashFromSecret(value: string) {
  // Accept a valid SHA-256 verifier even if a control panel pasted harmless
  // surrounding quotes, backticks, labels or Markdown formatting.
  return value.match(/[a-f0-9]{64}/i)?.[0].toLowerCase() ?? null;
}

export function passwordVerifierReady(expectedHash: string) {
  return passwordHashFromSecret(expectedHash) !== null;
}

export async function verifyPassword(password: string, expectedHash: string) {
  const verifier = passwordHashFromSecret(expectedHash);
  return verifier !== null && safeEqual(await sha256(password), verifier);
}

export async function isAuthorized(request: Request, sessionSecret: string) {
  const value = cookieValue(request);
  if (!value) return false;
  const [expires, suppliedSignature, extra] = value.split(".");
  if (!expires || !suppliedSignature || extra || !/^\d+$/.test(expires)) return false;
  if (Number(expires) <= Date.now()) return false;
  return safeEqual(suppliedSignature, await signature(sessionSecret, expires));
}

export async function sessionCookie(sessionSecret: string) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const expires = String(Date.now() + maxAge * 1000);
  const value = `${expires}.${await signature(sessionSecret, expires)}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function expiredSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function encryptApiKey(apiKey: string, sessionSecret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await apiEncryptionKey(sessionSecret),
    new TextEncoder().encode(apiKey),
  );
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptApiKey(value: string, sessionSecret: string) {
  const [ivValue, cipherValue, extra] = value.split(".");
  if (!ivValue || !cipherValue || extra) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(ivValue) },
      await apiEncryptionKey(sessionSecret),
      base64UrlDecode(cipherValue),
    );
    const apiKey = new TextDecoder().decode(decrypted);
    return apiKey.length >= 8 && apiKey.length <= 256 ? apiKey : null;
  } catch {
    return null;
  }
}

export async function encryptedApiKeyCookie(apiKey: string, sessionSecret: string) {
  const value = await encryptApiKey(apiKey, sessionSecret);
  const maxAge = API_KEY_DAYS * 24 * 60 * 60;
  return `${API_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function apiKeyFromRequest(request: Request, sessionSecret: string) {
  const value = cookieValue(request, API_COOKIE_NAME);
  if (!value) return null;
  return decryptApiKey(value, sessionSecret);
}

export function expiredApiKeyCookie() {
  return `${API_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
