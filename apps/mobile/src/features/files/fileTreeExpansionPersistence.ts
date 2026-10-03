import * as SecureStore from "expo-secure-store";

const FILE_TREE_EXPANDED_PREFIX = "t3code.fileTreeExpanded:";

/** Workspace-scoped storage key: the tree is rooted at one environment + cwd. */
export function fileTreeExpansionKey(environmentId: string, cwd: string): string {
  return `${FILE_TREE_EXPANDED_PREFIX}${environmentId}:${cwd}`;
}

export function sanitizeExpandedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function treePathDepth(path: string): number {
  return path.split("/").filter((segment) => segment.length > 0).length;
}

/** Shallowest directories first so restore loads from the root down. */
export function sortExpandedPathsParentFirst(paths: readonly string[]): string[] {
  return [...paths].sort((left, right) => {
    const depth = treePathDepth(left) - treePathDepth(right);
    if (depth !== 0) return depth;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Ancestor directory paths of a directory, root-first and including itself, in
 * the bare form the mobile tree uses ("apps/web" -> ["apps", "apps/web"]).
 */
export function expandedPathAncestors(path: string): string[] {
  const ancestors: string[] = [];
  const segments = path.split("/").filter((segment) => segment.length > 0);
  for (let index = 1; index <= segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

// Synchronous read for the initial render: remounts and route changes come
// back expanded without waiting on SecureStore. Writes update this cache first
// and mirror to SecureStore for app restarts.
const memoryCache = new Map<string, string[]>();

export function readCachedExpandedPaths(storageKey: string | null): string[] | null {
  if (storageKey === null) return null;
  return memoryCache.get(storageKey) ?? null;
}

export async function loadPersistedExpandedPaths(storageKey: string): Promise<string[]> {
  const cached = memoryCache.get(storageKey);
  if (cached !== undefined) return cached;
  let stored: string[] = [];
  try {
    const raw = await SecureStore.getItemAsync(storageKey);
    stored = raw === null ? [] : sanitizeExpandedPaths(JSON.parse(raw));
  } catch (error) {
    console.warn("[file-tree] ignored invalid stored expansion", error);
    stored = [];
  }
  memoryCache.set(storageKey, stored);
  return stored;
}

export function savePersistedExpandedPaths(
  storageKey: string | null,
  paths: ReadonlySet<string> | readonly string[],
): void {
  if (storageKey === null) return;
  const next = sortExpandedPathsParentFirst(sanitizeExpandedPaths([...paths]));
  memoryCache.set(storageKey, next);
  // Best effort: a remount already reads the cache above, so a dropped write
  // only loses the restart case.
  SecureStore.setItemAsync(storageKey, JSON.stringify(next)).catch((error: unknown) => {
    console.warn("[file-tree] failed to persist expansion", error);
  });
}
