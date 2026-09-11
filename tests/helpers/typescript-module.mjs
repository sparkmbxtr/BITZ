import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));

export function loadTypeScriptModule(url, { append = "", globals = {} } = {}) {
  const cache = new Map();
  function load(path, suffix = "") {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const source = readFileSync(path, "utf8") + suffix;
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    vm.runInNewContext(compiled.outputText, {
      module, exports: module.exports,
      require: (name) => {
        if (name.startsWith("@/") || name.startsWith(".")) {
          const base = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(path), name);
          const target = [base, `${base}.ts`, `${base}.tsx`].find((file) => existsSync(file));
          if (target) return load(target);
        }
        return nativeRequire(name);
      },
      URL, URLSearchParams, Request, Response, Headers, AbortController, TextEncoder, TextDecoder,
      crypto: globalThis.crypto, setTimeout, clearTimeout, ...globals,
    }, { filename: path });
    return module.exports;
  }
  return load(fileURLToPath(url), append);
}
