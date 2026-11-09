export const WSL_PRESENCE_WINDOW_MS = 15 * 60_000;

export function validateWslConnection(value, now = Date.now()) {
  if (value == null) return null;
  const instant = input => typeof input === "string" && input.length <= 40 && Number.isFinite(Date.parse(input));
  if (!["connected", "disconnected"].includes(value.reported_state)
    || value.evidence !== "original-wsl-relay" || !instant(value.observed_at)
    || Date.parse(value.observed_at) > now + 60_000
    || (value.last_seen_at !== null && (!instant(value.last_seen_at) || Date.parse(value.last_seen_at) > Date.parse(value.observed_at)))
    || (value.reported_state === "connected" && value.last_seen_at !== value.observed_at)) throw new Error("WSL presence evidence rejected");
  return { reported_state: value.reported_state, observed_at: value.observed_at,
    last_seen_at: value.last_seen_at, evidence: "original-wsl-relay" };
}

export function wslConnectionStatus(value, now = Date.now()) {
  if (!value) return "unconfirmed";
  return value.reported_state === "connected" && value.last_seen_at
    && now - Date.parse(value.last_seen_at) <= WSL_PRESENCE_WINDOW_MS ? "connected" : "disconnected";
}
