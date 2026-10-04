import { repairUnclosedAngleLinkDestinations } from "@t3tools/client-runtime/markdown-links";
import type { MarkdownNode } from "react-native-nitro-markdown/headless";
import { describe, expect, it } from "vite-plus/test";

import { resolveMarkdownLinkPresentation } from "./markdownLinks";
import { nativeMarkdownTextRuns } from "./nativeMarkdownText";

/**
 * md4c turns well-formed `[file](<local/path/file.md>)` into a link node
 * whose href is the destination between the angle brackets. The native
 * parser never builds a node for the unclosed shape, so this mirrors what
 * it yields once the source is repaired.
 */
function parsedLinkNodeFor(markdown: string): MarkdownNode {
  const repaired = repairUnclosedAngleLinkDestinations(markdown);
  const href = repaired.slice(repaired.indexOf("(<") + 2, repaired.lastIndexOf(">)"));
  const label = repaired.slice(repaired.indexOf("[") + 1, repaired.indexOf("]"));
  const link = { type: "link", href, children: [{ type: "text", content: label }] };
  return { type: "document", children: [{ type: "paragraph", children: [link] }] } as MarkdownNode;
}

describe("unclosed angle-bracket file links", () => {
  it.each([
    ["[file](<local/path/file.md)", "[file](<local/path/file.md>)"],
    [
      "[Receipts](</Users/dara/Downloads/Lime Ride Artifacts/Bike Receipts)",
      "[Receipts](</Users/dara/Downloads/Lime Ride Artifacts/Bike Receipts>)",
    ],
    ["[Open](<C:/Users/shawn/project/src/main.ts)", "[Open](<C:/Users/shawn/project/src/main.ts>)"],
    ["- [file](<local/path/file.md)", "- [file](<local/path/file.md>)"],
  ])("repairs %s before parsing", (source, expected) => {
    expect(repairUnclosedAngleLinkDestinations(source)).toBe(expected);
  });

  it.each([
    "[file](<local/path/file.md>)",
    "[site](<https://example.com/docs)",
    "~~~\n[file](<local/path/file.md)\n~~~",
    "```\n[file](<local/path/file.md)\n```",
  ])("leaves %s alone", (source) => {
    expect(repairUnclosedAngleLinkDestinations(source)).toBe(source);
  });

  it("renders the repaired destination as a file chip run", () => {
    expect(resolveMarkdownLinkPresentation("local/path/file.md")).toMatchObject({
      kind: "file",
      label: "file.md",
    });
    expect(nativeMarkdownTextRuns(parsedLinkNodeFor("[file](<local/path/file.md)"))).toMatchObject([
      { text: "file.md", href: "local/path/file.md", fileIcon: "markdown" },
    ]);
  });

  it("leaves a non-file destination without a chip", () => {
    expect(repairUnclosedAngleLinkDestinations("[site](<https://example.com/docs)")).toBe(
      "[site](<https://example.com/docs)",
    );
    expect(resolveMarkdownLinkPresentation("<https://example.com/docs")).toMatchObject({
      kind: "link",
    });
  });
});
