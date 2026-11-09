import { progressWriterAuthorized } from "./nucleosome-oidc.mjs";

export function deploymentMetadata(value = {}) {
  return { scope: "website deployment metadata; not the scientific VM", observed_at: value.observed_at ?? null,
    account_id: value.account_id ?? null, worker: "spark", source_revision: value.source_revision ?? null,
    migration_tag: value.migration_tag ?? null,
    script: value.script ? { id: value.script.id, migration_tag: value.script.migration_tag } : null,
    bindings: (value.bindings ?? []).map(({ name, type, namespace_id, class_name, script_name, environment }) =>
      ({ name, type, namespace_id, class_name, script_name, environment })),
    namespaces: (value.namespaces ?? []).map(({ id, class_name, script, use_sqlite }) => ({ id, class_name, script, use_sqlite })),
    errors: (value.errors ?? []).map(({ operation, status }) => ({ operation, status })) };
}

export async function routeDeploymentMetadata(request, value, authorize = progressWriterAuthorized) {
  const url = new URL(request.url);
  if (url.hostname !== "bitz.bioengineering.workers.dev" || url.pathname !== "/api/nucleosome-deployment-metadata") return null;
  const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  if (!await authorize(request)) return Response.json({ error: "Authenticated Git verification required" }, { status: 401, headers });
  return Response.json(deploymentMetadata(value), { headers });
}
