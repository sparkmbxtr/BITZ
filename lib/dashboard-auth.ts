const COOKIE_NAME = "airq_wallboard_session";
const SESSION_DAYS = 30;

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

function cookieValue(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

export async function verifyPassword(password: string, expectedHash: string) {
  return safeEqual(await sha256(password), expectedHash.toLowerCase());
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
