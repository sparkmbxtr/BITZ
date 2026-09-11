type Attempt = { version: string; at: number };

type UpdateMonitorOptions = {
  currentVersion: string;
  loadVersion: () => Promise<string | null>;
  canReload: () => boolean;
  prepareReload: () => Promise<boolean>;
  reload: (version: string) => void;
  readAttempt: () => Attempt | null;
  writeAttempt: (attempt: Attempt) => void;
  now?: () => number;
};

export function createDisplayUpdateMonitor(options: UpdateMonitorOptions) {
  const now = options.now ?? Date.now;
  let candidate: Attempt | null = null;
  let running = false;
  let stopped = false;

  return {
    stop() { stopped = true; },
    async check() {
      if (stopped || running) return;
      running = true;
      try {
        const version = await options.loadVersion();
        if (stopped) return;
        if (!version || !/^[a-f0-9]{24}$/.test(version) || version === options.currentVersion) {
          candidate = null;
          return;
        }
        // Confirm a stable deployment twice, with time between observations.
        if (candidate?.version !== version) {
          candidate = { version, at: now() };
          return;
        }
        if (now() - candidate.at < 10_000 || !options.canReload()) return;
        const previous = options.readAttempt();
        if (previous && (now() - previous.at < 60_000 ||
          (previous.version === version && now() - previous.at < 10 * 60_000))) return;
        if (!await options.prepareReload() || stopped || !options.canReload()) return;
        options.writeAttempt({ version, at: now() });
        options.reload(version);
        stopped = true;
      } catch {
        // Failed checks leave the displayed data and login untouched.
        candidate = null;
      } finally {
        running = false;
      }
    },
  };
}

export const DISPLAY_UPDATE_ATTEMPT_KEY = "bitz-display-update-attempt";
export const DISPLAY_UPDATE_VIEW_KEY = "bitz-display-update-view";

export function readDisplayUpdateValue<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.sessionStorage.getItem(key) ?? "null") as T | null; }
  catch { return null; }
}

export function writeDisplayUpdateValue(key: string, value: unknown) {
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { /* Some signage browsers restrict storage. */ }
}

export type DisplayUpdateView = { presentationMode: boolean; x: number; y: number };
