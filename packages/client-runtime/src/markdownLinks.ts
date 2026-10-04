import { isWindowsAbsolutePath } from "@t3tools/shared/path";

const SLASH_PREFIXED_WINDOWS_DRIVE_PATTERN = /^\/[A-Za-z]:[\\/]/;
const RELATIVE_PATH_PREFIX_PATTERN = /^(~\/|\.{1,2}\/)/;
const RELATIVE_FILE_PATH_PATTERN =
  /^(?:[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*\/)+[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*(?::\d+){0,2}$/;
const RELATIVE_FILE_NAME_PATTERN =
  /^[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*\.[A-Za-z0-9_-]+(?::\d+){0,2}$/;
const EXTERNAL_SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/;
const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;
const POSITION_SUFFIX_CAPTURE_PATTERN = /:(\d+)(?::(\d+))?$/;
const POSITION_HASH_PATTERN = /^#L(\d+)(?:C(\d+))?$/i;
const POSITION_ONLY_PATTERN = /^\d+(?::\d+)?$/;
const INLINE_CODE_DISQUALIFIER_PATTERN = /[\s`]/;
const PATH_SEPARATOR_PATTERN = /[\\/]/;
const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9_-]+$/;
// A final dot between digits marks a version or model id (`glm-5.3`,
// `Qwen2.5-Coder`), not an extension. `ls.1` and `libfoo.so.1` stay files.
const VERSION_SUFFIX_PATTERN = /\d\.\d[^.]*$/;
const NUMERIC_DOTTED_PATTERN = /^\d+(?:\.\d+)+$/;
// Standard OS and dev-container roots; deliberately excludes app-route-ish
// prefixes like /app/ or /chat/ so SPA routes never read as files.
const POSIX_FILE_ROOT_PREFIXES = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/var/",
  "/etc/",
  "/opt/",
  "/mnt/",
  "/Volumes/",
  "/private/",
  "/root/",
  "/usr/",
  "/bin/",
  "/sbin/",
  "/lib/",
  "/lib64/",
  "/srv/",
  "/dev/",
  "/proc/",
  "/sys/",
  "/run/",
  "/boot/",
  "/media/",
  "/workspace/",
  "/workspaces/",
] as const;
// `Name:digits` also matches `error:1`, `port:3000`, and `TODO:12`.
const EXTENSIONLESS_FILE_NAMES = new Set([
  "Makefile",
  "makefile",
  "GNUmakefile",
  "Dockerfile",
  "Containerfile",
  "Justfile",
  "justfile",
  "Rakefile",
  "Gemfile",
  "Procfile",
  "Brewfile",
  "Caddyfile",
  "Vagrantfile",
  "Jenkinsfile",
  "Podfile",
  "Fastfile",
  "BUILD",
  "WORKSPACE",
  "LICENSE",
  "LICENCE",
  "COPYING",
  "NOTICE",
  "AUTHORS",
  "CONTRIBUTORS",
  "CHANGELOG",
  "README",
  "CODEOWNERS",
]);
const SINGLE_LABEL_HOSTNAMES = new Set(["localhost"]);
// These allowlists avoid classifying dotted directories such as `conf.d/`
// or filenames such as `Makefile.in:12` as hosts.
const GENERIC_HOSTNAME_TLDS = new Set([
  "com",
  "net",
  "org",
  "io",
  "dev",
  "app",
  "ai",
  "co",
  "edu",
  "gov",
  "mil",
  "info",
  "biz",
  "xyz",
  "me",
  "tv",
  "cc",
  "gg",
  "chat",
  "cloud",
  "site",
  "online",
  "tech",
  "store",
  "link",
]);
// Country codes also name file extensions. A :line suffix makes `.pl`
// and `.pt` files more likely than hostnames.
const COUNTRY_HOSTNAME_TLDS = new Set([
  "uk",
  "de",
  "fr",
  "nl",
  "se",
  "no",
  "fi",
  "dk",
  "pl",
  "ch",
  "at",
  "be",
  "es",
  "it",
  "pt",
  "eu",
  "us",
  "ca",
  "au",
  "nz",
  "jp",
  "kr",
  "cn",
  "br",
  "ru",
  "mx",
  "ie",
  "cz",
  "tr",
  "sg",
  "hk",
]);

function looksLikeHostname(segment: string, hasPosition: boolean): boolean {
  if (segment.startsWith(".")) return false;
  const lowered = segment.toLowerCase();
  if (SINGLE_LABEL_HOSTNAMES.has(lowered)) return true;
  if (NUMERIC_DOTTED_PATTERN.test(segment)) return true;
  const labels = lowered.split(".");
  const lastLabel = labels.at(-1);
  if (labels.length < 2 || lastLabel === undefined) return false;
  if (GENERIC_HOSTNAME_TLDS.has(lastLabel)) return true;
  return !hasPosition && COUNTRY_HOSTNAME_TLDS.has(lastLabel);
}

/**
 * Picks path-shaped inline code for the client's markdown file-link resolver.
 * It does not resolve paths or turn plain prose and fenced code into links.
 */
export function inlineCodeFilePathCandidate(codeText: string): string | null {
  const trimmed = codeText.trim();
  if (trimmed.length === 0 || INLINE_CODE_DISQUALIFIER_PATTERN.test(trimmed)) return null;

  const candidate = isWindowsAbsolutePath(trimmed) ? trimmed : trimmed.replaceAll("\\", "/");
  const hasPosition = POSITION_SUFFIX_PATTERN.test(candidate);
  if (!hasPosition && !PATH_SEPARATOR_PATTERN.test(candidate)) return null;

  const hasExplicitPathShape =
    RELATIVE_PATH_PREFIX_PATTERN.test(candidate) ||
    candidate.startsWith("/") ||
    isWindowsAbsolutePath(candidate);
  if (!hasExplicitPathShape) {
    const withoutPosition = candidate.replace(POSITION_SUFFIX_PATTERN, "");
    const firstSegment = withoutPosition.split("/")[0] ?? withoutPosition;
    if (looksLikeHostname(firstSegment, hasPosition)) return null;
    const basename =
      withoutPosition
        .replace(/[/\\]+$/, "")
        .split(/[\\/]/)
        .at(-1) ?? "";
    if (VERSION_SUFFIX_PATTERN.test(basename)) return null;
    if (!hasPosition && !FILE_EXTENSION_PATTERN.test(basename)) return null;
  }
  return candidate;
}

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeMarkdownLinkDestination(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
}

/** Browser URL parsers write `C:/foo` as `/C:/foo` for file URLs. */
export function stripSlashPrefixedWindowsDrive(path: string): string {
  return SLASH_PREFIXED_WINDOWS_DRIVE_PATTERN.test(path) ? path.slice(1) : path;
}

export function splitMarkdownLinkSearchAndHash(value: string): {
  readonly path: string;
  readonly hash: string;
} {
  const hashIndex = value.indexOf("#");
  const pathWithSearch = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  const queryIndex = pathWithSearch.indexOf("?");
  return {
    path: queryIndex >= 0 ? pathWithSearch.slice(0, queryIndex) : pathWithSearch,
    hash,
  };
}

/**
 * Turns a `file:` URL into a host path, still percent-encoded so callers that
 * decode every destination in one place do not decode file URLs twice. A
 * non-localhost authority becomes a UNC share.
 */
export function parseFileUrlHref(
  href: string,
): { readonly path: string; readonly hash: string } | null {
  try {
    const parsed = new URL(href);
    if (parsed.protocol.toLowerCase() !== "file:") return null;

    const uncHostname = parsed.hostname.toLowerCase() === "localhost" ? "" : parsed.hostname;
    const path = uncHostname
      ? `\\\\${uncHostname}${parsed.pathname.replaceAll("/", "\\")}`
      : parsed.pathname;
    if (path.length === 0) return null;
    return { path: stripSlashPrefixedWindowsDrive(path), hash: parsed.hash };
  } catch {
    return null;
  }
}

export interface FilePathPosition {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}

export function splitFilePathPosition(path: string, hash = ""): FilePathPosition {
  const suffixMatch = path.match(POSITION_SUFFIX_CAPTURE_PATTERN);
  const match = suffixMatch ?? hash.match(POSITION_HASH_PATTERN);
  if (!match?.[1]) return { path };

  const line = Number.parseInt(match[1], 10);
  const column = match[2] === undefined ? undefined : Number.parseInt(match[2], 10);
  return {
    path: suffixMatch ? path.slice(0, -suffixMatch[0].length) : path,
    ...(line > 0 ? { line } : {}),
    ...(column !== undefined && column > 0 ? { column } : {}),
  };
}

export function formatFilePathPosition(position: FilePathPosition): string {
  if (!position.line) return position.path;
  return `${position.path}:${position.line}${position.column ? `:${position.column}` : ""}`;
}

export function isRelativeFilePath(path: string): boolean {
  return (
    RELATIVE_PATH_PREFIX_PATTERN.test(path) ||
    (!path.startsWith("/") && !isWindowsAbsolutePath(path))
  );
}

function looksLikePosixFilesystemPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (POSIX_FILE_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (POSITION_SUFFIX_PATTERN.test(path)) return true;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return EXTENSIONLESS_FILE_NAMES.has(basename) || FILE_EXTENSION_PATTERN.test(basename);
}

/**
 * Decides whether a decoded link destination is a file path rather than a route
 * or prose. Only a `:line` suffix the author wrote counts as evidence; a `#L`
 * anchor never turns `/chat/settings` into a file.
 */
function looksLikeFilePath(path: string, authoredPath: string): boolean {
  if (isWindowsAbsolutePath(path) || RELATIVE_PATH_PREFIX_PATTERN.test(path)) return true;
  if (path.startsWith("/")) return looksLikePosixFilesystemPath(authoredPath);
  if (EXTENSIONLESS_FILE_NAMES.has(path)) return true;
  return RELATIVE_FILE_PATH_PATTERN.test(authoredPath) || RELATIVE_FILE_NAME_PATTERN.test(path);
}

function hasExternalScheme(path: string): boolean {
  if (isWindowsAbsolutePath(path)) return false;
  const match = path.match(EXTERNAL_SCHEME_PATTERN);
  if (!match) return false;
  const rest = match[2] ?? "";
  if (rest.startsWith("//")) return true;
  return !POSITION_ONLY_PATTERN.test(rest);
}

export function parseMarkdownFileLink(href: string): FilePathPosition | null {
  const normalized = normalizeMarkdownLinkDestination(href);
  if (normalized.length === 0 || normalized.startsWith("#") || normalized.startsWith("//")) {
    return null;
  }

  const source =
    (normalized.toLowerCase().startsWith("file:") ? parseFileUrlHref(normalized) : null) ??
    splitMarkdownLinkSearchAndHash(normalized);
  // A percent-encoded drive colon (`/c%3A/`) only becomes strippable once decoded.
  const path = stripSlashPrefixedWindowsDrive(safeDecodeURIComponent(source.path.trim()));
  const hash = safeDecodeURIComponent(source.hash.trim());
  if (path.length === 0 || hasExternalScheme(path)) return null;

  const position = splitFilePathPosition(path, hash);
  return looksLikeFilePath(position.path, path) ? position : null;
}

export function fileBasename(path: string): string {
  // A trailing separator is a valid way to write a directory. Trim it before
  // taking the final segment so the label is never empty.
  const trimmed = path.replace(/[/\\]+$/, "");
  if (trimmed.length === 0) return path;
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : trimmed;
}

export function workspaceRelativeFilePath(
  path: string,
  workspaceRoot: string | null | undefined,
): string | null {
  if (!workspaceRoot) return null;
  const normalizedPath = stripSlashPrefixedWindowsDrive(path.replaceAll("\\", "/"));
  const normalizedRoot = stripSlashPrefixedWindowsDrive(
    workspaceRoot.replaceAll("\\", "/"),
  ).replace(/\/+$/, "");
  const caseInsensitive = isWindowsAbsolutePath(stripSlashPrefixedWindowsDrive(workspaceRoot));
  const pathForCompare = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
  const rootForCompare = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  if (pathForCompare.replace(/\/+$/, "") === rootForCompare) return ".";
  if (!pathForCompare.startsWith(`${rootForCompare}/`)) return null;
  return normalizedPath.slice(normalizedRoot.length + 1);
}

const UNCLOSED_ANGLE_LINK_PATTERN = /\[([^\]\n]*)\]\(\s*<([^<>\n]+?)\s*\)/g;
const FENCE_OPENER_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_CODE_PATTERN = /^(?: {4}|\t)/;
const BLANK_LINE_PATTERN = /^\s*$/;

export interface UnclosedAngleLinkRepair {
  readonly text: string;
  /** Repaired-string offsets of each inserted `>`, ascending. */
  readonly insertedOffsets: readonly number[];
}

interface FenceMarker {
  readonly char: "`" | "~";
  readonly length: number;
}

function fenceOpener(line: string): FenceMarker | null {
  const match = FENCE_OPENER_PATTERN.exec(line);
  const marker = match?.[1];
  if (!marker) return null;
  // An info string on a backtick fence cannot itself contain backticks.
  if (marker.startsWith("`") && line.slice(match[0].length).includes("`")) return null;
  return { char: marker.startsWith("`") ? "`" : "~", length: marker.length };
}

function isFenceCloser(line: string, fence: FenceMarker): boolean {
  let index = 0;
  while (index < 3 && line[index] === " ") index += 1;
  if (line[index] !== fence.char) return false;
  let end = index;
  while (line[end] === fence.char) end += 1;
  if (end - index < fence.length) return false;
  return line.slice(end).trim() === "";
}

/** End offset (exclusive) of a backtick run of exactly `length`, or -1. */
function closingBacktickRunEnd(line: string, from: number, length: number): number {
  for (let index = from; index <= line.length - length; index += 1) {
    if (line[index] !== "`") continue;
    let end = index;
    while (line[end] === "`") end += 1;
    if (end - index === length) return end;
    index = end - 1;
  }
  return -1;
}

/**
 * Maps an offset in repaired text back to the source. Each repair inserts
 * exactly one `>`, so every earlier insertion shifts the offset down by one.
 */
export function mapRepairedOffsetToOriginal(
  insertedOffsets: readonly number[],
  repairedOffset: number,
): number {
  let shift = 0;
  for (const inserted of insertedOffsets) {
    if (inserted > repairedOffset) break;
    shift += 1;
  }
  return repairedOffset - shift;
}

/**
 * Closes Codex's unclosed angle-bracket destinations (`[label](<path)`) so
 * they parse as the same file link the well-formed shape produces. Only
 * destinations that already read as file paths are repaired. Fenced code
 * (backtick and tilde), indented code, and inline code spans — including
 * spans continued across lines — stay exactly as written, as does every
 * other malformed shape.
 */
export function repairUnclosedAngleLinkDestinationsDetailed(
  markdown: string,
): UnclosedAngleLinkRepair {
  const unchanged: UnclosedAngleLinkRepair = { text: markdown, insertedOffsets: [] };
  if (!markdown.includes("](<")) return unchanged;

  const insertedOffsets: number[] = [];
  const repairChunk = (chunk: string, chunkBase: number): string =>
    chunk.replace(
      UNCLOSED_ANGLE_LINK_PATTERN,
      (match: string, label: string, destination: string, offset: number) => {
        const path = destination.trim();
        if (parseMarkdownFileLink(path) === null) return match;
        insertedOffsets.push(chunkBase + offset + match.length);
        return `[${label}](<${path}>)`;
      },
    );
  const repairProseLine = (
    line: string,
    lineBase: number,
  ): { text: string; continuedSpan: number } => {
    let result = "";
    let cursor = 0;
    let continuedSpan = 0;
    while (cursor < line.length) {
      const runStart = line.indexOf("`", cursor);
      if (runStart === -1) {
        result += repairChunk(line.slice(cursor), lineBase + result.length);
        break;
      }
      let runEnd = runStart;
      while (line[runEnd] === "`") runEnd += 1;
      const closeEnd = closingBacktickRunEnd(line, runEnd, runEnd - runStart);
      result += repairChunk(line.slice(cursor, runStart), lineBase + result.length);
      if (closeEnd === -1) {
        result += line.slice(runStart);
        continuedSpan = runEnd - runStart;
        break;
      }
      result += line.slice(runStart, closeEnd);
      cursor = closeEnd;
    }
    return { text: result, continuedSpan };
  };

  const lines = markdown.split("\n");
  const repairedLines: string[] = [];
  let fence: FenceMarker | null = null;
  let spanLength = 0;
  let prevBlank = true;
  let prevCodeBlock = false;
  let base = 0;
  for (const line of lines) {
    let repairedLine: string;
    if (fence !== null) {
      if (isFenceCloser(line, fence)) fence = null;
      repairedLine = line;
      prevBlank = false;
      prevCodeBlock = true;
    } else if (spanLength > 0) {
      const end = closingBacktickRunEnd(line, 0, spanLength);
      if (end === -1) {
        repairedLine = line;
        prevBlank = false;
        prevCodeBlock = false;
      } else {
        spanLength = 0;
        repairedLine = line.slice(0, end) + repairChunk(line.slice(end), base + end);
        prevBlank = BLANK_LINE_PATTERN.test(line);
        prevCodeBlock = false;
      }
    } else {
      const opener = fenceOpener(line);
      if (opener !== null) {
        fence = opener;
        repairedLine = line;
        prevBlank = false;
        prevCodeBlock = true;
      } else if (INDENTED_CODE_PATTERN.test(line) && (prevBlank || prevCodeBlock)) {
        repairedLine = line;
        prevBlank = false;
        prevCodeBlock = true;
      } else {
        const repaired = repairProseLine(line, base);
        repairedLine = repaired.text;
        spanLength = repaired.continuedSpan;
        prevBlank = BLANK_LINE_PATTERN.test(line);
        prevCodeBlock = false;
      }
    }
    repairedLines.push(repairedLine);
    base += repairedLine.length + 1;
  }
  return { text: repairedLines.join("\n"), insertedOffsets };
}

export function repairUnclosedAngleLinkDestinations(markdown: string): string {
  return repairUnclosedAngleLinkDestinationsDetailed(markdown).text;
}
