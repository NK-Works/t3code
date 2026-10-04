// Split chunks are fetched lazily, so a deploy (or desktop server swap)
// between page load and a later fetch can 404 the old hashed assets. One
// reload picks up the fresh index.html. A sessionStorage flag keeps a
// persistent failure from becoming a reload loop, and a successful boot clears
// it so the next stale deploy gets its own single reload.
const CHUNK_RELOAD_GUARD_KEY = "t3code:chunk-load-reloaded";

/**
 * Called from the `vite:preloadError` listener. Reloads at most once per
 * failure streak and returns whether it did, so the caller knows whether to
 * swallow the event or let the error surface through the normal paths.
 */
export function reloadOnceForChunkLoadError(
  getStorage: () => Storage = () => window.sessionStorage,
  reload: () => void = () => window.location.reload(),
): boolean {
  let alreadyReloaded: boolean;
  try {
    const storage = getStorage();
    alreadyReloaded = storage.getItem(CHUNK_RELOAD_GUARD_KEY) === "1";
    if (!alreadyReloaded) storage.setItem(CHUNK_RELOAD_GUARD_KEY, "1");
  } catch {
    // Without storage the guard cannot survive a reload, so a persistent
    // failure would loop forever. Let the error surface instead.
    return false;
  }
  if (alreadyReloaded) return false;
  reload();
  return true;
}

// Vite emits `vite:preloadError` for intent preloads, but the initial
// `router.load()` (and other cold dynamic imports) can reject with a plain
// TypeError that lands in the route error boundary instead:
// "Failed to fetch dynamically imported module: .../assets/settings-….js".
// After a deploy or desktop channel switch the hashed chunk is stale, so one
// guarded reload picks up the fresh index.html just like the preload path.
const CHUNK_LOAD_ERROR_PATTERNS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "Loading chunk",
  "Loading CSS chunk",
];

const MAX_CHUNK_ERROR_CAUSE_DEPTH = 5;

/** Whether the error (or anything in its cause chain) is a stale split-chunk load failure. */
export function isChunkLoadError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CHUNK_ERROR_CAUSE_DEPTH && current != null; depth += 1) {
    const message =
      typeof current === "string" ? current : current instanceof Error ? current.message : null;
    if (
      typeof message === "string" &&
      CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/**
 * Route-error-boundary and boot counterpart to `reloadOnceForChunkLoadError`:
 * reloads at most once per failure streak when the error is a stale chunk,
 * and leaves every other error (without consuming the single reload) to the
 * normal error paths.
 */
export function reloadOnceForRouteChunkError(
  error: unknown,
  getStorage: () => Storage = () => window.sessionStorage,
  reload: () => void = () => window.location.reload(),
): boolean {
  if (!isChunkLoadError(error)) return false;
  return reloadOnceForChunkLoadError(getStorage, reload);
}

/** Clears the guard after a successful boot so a later stale deploy can reload again. */
export function clearChunkReloadGuard(getStorage: () => Storage = () => window.sessionStorage) {
  try {
    getStorage().removeItem(CHUNK_RELOAD_GUARD_KEY);
  } catch {
    // Blocked storage never held the flag.
  }
}
