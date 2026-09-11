import { DASHBOARD_BUILD_VERSION } from "@/lib/dashboard-version";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// This public endpoint contains only a build fingerprint, never sensor data
// or credentials. It remains available if an upstream sensor service is down.
export function GET() {
  return Response.json({ version: DASHBOARD_BUILD_VERSION }, {
    headers: {
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      "CDN-Cache-Control": "no-store",
    },
  });
}
