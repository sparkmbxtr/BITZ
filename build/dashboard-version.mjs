import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Hash application inputs, so edits produce a new version even in an
// uncommitted checkout. Credentials and runtime state are outside these paths.
export function dashboardBuildVersion(root) {
  const hash = createHash("sha256");
  function add(path) {
    const absolute = join(root, path);
    const info = statSync(absolute, { throwIfNoEntry: false });
    if (!info) return;
    if (info.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (!name.startsWith(".")) add(join(path, name));
      }
    } else if (info.isFile()) {
      hash.update(path.replaceAll("\\", "/"));
      hash.update("\0");
      hash.update(readFileSync(absolute));
      hash.update("\0");
    }
  }
  for (const path of ["app", "lib", "public", "worker", "build", "vite.config.ts", "next.config.ts", "next.config.js", "wrangler.jsonc", "package.json", "package-lock.json"]) add(path);
  return hash.digest("hex").slice(0, 24);
}
