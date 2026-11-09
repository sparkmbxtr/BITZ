// Workers Builds supplies its linked Worker name. Select that Worker's source
// config without changing the provider's name or tag safety checks.
export function workerConfigPath(environment = process.env) {
  const linked = environment.WRANGLER_CI_OVERRIDE_NAME;
  const explicit = environment.BITZ_WORKER_TARGET;
  if (linked && explicit && linked !== explicit) throw new Error("The requested build target differs from the linked Cloudflare Worker");
  const target = linked || explicit || "bitz";
  if (!["spark", "bitz"].includes(target)) throw new Error("Only the existing spark and bitz Workers are supported");
  return target === "spark" ? "wrangler.jsonc" : "wrangler.bitz.jsonc";
}
