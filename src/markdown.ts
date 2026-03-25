import * as fs from "node:fs";

// Helper to load a markdown file and strip YAML frontmatter if present.
// This is used internally by the orchestrator plugin but is exported from
// a separate module so that the main plugin entrypoint only exposes the
// OrchestratorPlugin function to the OpenCode runtime.
export function loadMarkdownBody(fullPath: string): string {
  const text = fs.readFileSync(fullPath, "utf8");
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end !== -1) {
      return text.slice(end + 4).trimStart();
    }
  }
  return text;
}
