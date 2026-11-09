import { passwordVerifierReady, scopedDashboardSession, verifyPassword } from "../lib/dashboard-auth.ts";

export const monitorSession = scopedDashboardSession("__Host-spark_nucleosome_week", "spark-nucleosome-week-v1", 7);
const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };
export const monitorPasswordCasePolicy = "saved-lowercase-or-uppercase-v1";

export async function verifyMonitorPassword(supplied, hash) {
  if (typeof supplied !== "string") return false;
  const password = supplied.normalize("NFKC").replace(/[\p{Cf}\p{Z}\s]/gu, "");
  if (!password || password.length > 256) return false;
  // The existing verifier may have been saved from either keyboard case.
  // Keep the verifier private and check each spelling instead of forcing an
  // uppercase input against a possibly lowercase saved verifier.
  const variants = [...new Set([password, password.toUpperCase(), password.toLowerCase()])];
  const matches = await Promise.all(variants.map(value => verifyPassword(value, hash)));
  return matches.some(Boolean);
}

function configuration(env) {
  const hash = env.NUCLEOSOME_PASSWORD_HASH || env.DASHBOARD_PASSWORD_HASH || "";
  const secret = env.DASHBOARD_SESSION_SECRET || "";
  // Reuse the existing framework's verifier and signing key. The monitor must
  // not add a new key-length policy that rejects an already configured device.
  const verifierReady = typeof hash === "string" && passwordVerifierReady(hash);
  const signingReady = typeof secret === "string" && secret.length > 0;
  return { hash, secret, verifierReady, signingReady, configured: verifierReady && signingReady };
}

export async function monitorAuthorized(request, env) {
  const config = configuration(env);
  return config.configured && await monitorSession.authorized(request, config.secret);
}

export function loginPage(request, configured = true) {
  const incorrect = new URL(request.url).searchParams.get("login") === "incorrect";
  const refresh = new URL(request.url).searchParams.get("login") === "refresh";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="same-origin"><title>SPARK BMC-LMU · Monitor access</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101216;color:#e6e9ee;font:15px ui-monospace,SFMono-Regular,monospace;padding:24px}main{width:min(100%,420px);border:1px solid #343a43;border-radius:12px;padding:32px}h1{font-size:20px;line-height:1.5}p{color:#a8b0bd;line-height:1.6}label{display:block;margin:24px 0 8px}input,button{font:inherit;width:100%;padding:13px;border:1px solid #46505e;border-radius:6px}input{background:#191d24;color:#fff}button{margin-top:16px;background:#86c99a;color:#102018;cursor:pointer}.error{color:#efb38a}small{display:block;color:#a8b0bd;margin-top:20px;line-height:1.6}
  </style></head><body><main><p>SPARK BMC-LMU</p><h1>Nucleosome computation monitor</h1><p>Enter the access password. This browser will remember access for seven days.</p>
  ${!configured ? '<p class="error">Access configuration is unavailable. Please contact the page owner.</p>' : `${incorrect ? '<p class="error" role="alert">Password not accepted. Please try again.</p>' : refresh ? '<p class="error" role="alert">The login page has been refreshed. Please enter the password again.</p>' : ''}<form action="/api/nucleosome-auth" method="post"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" autofocus><button type="submit">Open monitor</button></form>`}
  <small>Access is remembered on this device and browser. Private browsing or clearing cookies removes it.</small></main></body></html>`;
}

export async function routeMonitorAuth(request, env) {
  const config = configuration(env);
  const reply = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });
  if (request.method === "GET") return reply({ configured: config.configured, authorized: await monitorAuthorized(request, env), session_days: 7,
    password_verifier_ready: config.verifierReady, session_signing_ready: config.signingReady,
    password_case_policy: monitorPasswordCasePolicy,
    password_verifier_scope: env.NUCLEOSOME_PASSWORD_HASH ? "monitor" : "dashboard_legacy",
    form_referrer_policy: "same-origin" });
  if (!["POST", "DELETE"].includes(request.method)) return reply({ error: "Method not allowed" }, 405, { Allow: "GET, POST, DELETE" });
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim();
  // Preserve the strict origin check. Old pages sent no-referrer, which makes
  // browser form navigations serialize Origin as null. Refresh those forms
  // onto the corrected same-origin page without granting any session.
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    if (request.method === "POST" && type === "application/x-www-form-urlencoded") {
      return new Response(null, { status: 303, headers: { ...headers, Location: "/?login=refresh" } });
    }
    return reply({ error: "Origin rejected" }, 403);
  }
  if (request.method === "DELETE") return reply({ locked: true }, 200, { "Set-Cookie": monitorSession.expiredCookie() });
  if (!config.configured) return reply({ error: "Access configuration unavailable" }, 503);
  if (Number(request.headers.get("content-length")) > 2048) return reply({ error: "Request too large" }, 413);
  if (!["application/json", "application/x-www-form-urlencoded"].includes(type)) return reply({ error: "Form or JSON required" }, 415);
  let password;
  try {
    const reader = request.body?.getReader();
    let length = 0;
    const chunks = [];
    if (!reader) throw new Error("Missing body");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2048) { await reader.cancel(); return reply({ error: "Request too large" }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const raw = new TextDecoder().decode(bytes);
    password = type === "application/json" ? JSON.parse(raw).password : new URLSearchParams(raw).get("password");
  } catch { return reply({ error: "Invalid request" }, 400); }
  if (!await verifyMonitorPassword(password, config.hash)) {
    return type === "application/json" ? reply({ error: "Password not accepted" }, 401)
      : new Response(null, { status: 303, headers: { ...headers, Location: "/?login=incorrect" } });
  }
  const cookie = await monitorSession.grant(config.secret);
  return type === "application/json" ? reply({ authorized: true, session_days: 7 }, 200, { "Set-Cookie": cookie })
    : new Response(null, { status: 303, headers: { ...headers, "Set-Cookie": cookie, Location: "/" } });
}
