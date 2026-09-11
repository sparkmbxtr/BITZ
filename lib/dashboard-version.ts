declare const __BITZ_BUILD_VERSION__: string;

// Vite injects the same application fingerprint into the browser and Worker.
export const DASHBOARD_BUILD_VERSION = typeof __BITZ_BUILD_VERSION__ === "string"
  ? __BITZ_BUILD_VERSION__
  : "development";
