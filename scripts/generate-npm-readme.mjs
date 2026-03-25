#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// In ESM there is no __dirname by default. We derive it from import.meta.url
// via fileURLToPath so that paths work correctly on both POSIX and Windows.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const srcPath = path.join(repoRoot, "README.md");
const destPath = path.join(repoRoot, "README.npm.md");

const diagramDirRelative = "docs/diagrams";
const diagramDir = path.join(repoRoot, diagramDirRelative);

// npm 公開後に unpkg から参照するためのベース URL
const pkgJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const npmCdnBase = `https://unpkg.com/${pkgJson.name}@${pkgJson.version}`;

const src = fs.readFileSync(srcPath, "utf8");
const lines = src.split(/\r?\n/);

// バッククォート 3 つは直接書かず動的に生成する
const FENCE = "`".repeat(3);
const MERMAID_FENCE = FENCE + "mermaid";

/** @typedef {{ index: number; code: string; imageRelPath?: string | null; imageUrl?: string | null }} MermaidBlock */

/** @type {MermaidBlock[]} */
const mermaidBlocks = [];

// 1 パス目: README.md から mermaid コードブロックを抽出
let collectingMermaid = false;
let currentMermaidLines = [];
let currentIndex = 0;

for (const line of lines) {
  const trimmed = line.trim();

  if (trimmed === MERMAID_FENCE) {
    collectingMermaid = true;
    currentMermaidLines = [];
    continue;
  }

  if (collectingMermaid) {
    if (trimmed === FENCE) {
      collectingMermaid = false;
      mermaidBlocks.push({
        index: currentIndex++,
        code: currentMermaidLines.join("\n"),
        imageRelPath: null,
      });
      continue;
    }
    currentMermaidLines.push(line);
    continue;
  }
}

function findMmdcPath() {
  const binDir = path.join(repoRoot, "node_modules", ".bin");
  const fullPath = path.join(binDir, "mmdc");
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }
  return null;
}

function renderMermaidBlocks(blocks) {
  if (blocks.length === 0) {
    return;
  }

  const mmdcPath = findMmdcPath();
  if (!mmdcPath) {
    console.warn(
      "[build:readme] mmdc (Mermaid CLI) が見つからなかったため、Mermaid 図のレンダリングをスキップしました。",
    );
    return;
  }

  fs.mkdirSync(diagramDir, { recursive: true });

  for (const block of blocks) {
    const relPath = `${diagramDirRelative}/readme-mermaid-${block.index + 1}.svg`;
    const absPath = path.join(repoRoot, relPath);
    const tmpMmdPath = path.join(
      diagramDir,
      `readme-mermaid-${block.index + 1}.mmd`,
    );

    fs.writeFileSync(tmpMmdPath, block.code, "utf8");

    let cmd = mmdcPath;
    let args = ["-i", tmpMmdPath, "-o", absPath];

    if (process.platform === "win32") {
      // On Windows, use cmd.exe to execute the script. We intentionally avoid
      // additional quoting here because cmd /c will handle simple paths and
      // arguments without spaces correctly, and our generated paths are
      // under the repo root.
      cmd = "cmd";
      args = ["/c", mmdcPath, "-i", tmpMmdPath, "-o", absPath];
    }

    const result = spawnSync(cmd, args, {
      stdio: "inherit",
    });

    if (result.error || result.status !== 0) {
      console.warn(
        "[build:readme] Mermaid 図 (index=" +
          String(block.index) +
          ") のレンダリングに失敗しました。",
      );
      if (result.error) {
        console.error("[build:readme] mmdc spawn error:", result.error);
      } else {
        console.error(
          "[build:readme] mmdc exited with status=",
          result.status,
          "signal=",
          result.signal,
        );
      }
      block.imageRelPath = null;
      block.imageUrl = null;
      continue;
    }

    block.imageRelPath = relPath.replace(/\\/g, "/");
    block.imageUrl = npmCdnBase + "/" + block.imageRelPath;
  }
}

renderMermaidBlocks(mermaidBlocks);

// 2 パス目: npm 用 README を生成
const out = [];
let inMermaid = false;
let mermaidOutIndex = 0;

for (const rawLine of lines) {
  const line = rawLine;
  const trimmed = line.trim();
  // > [!NOTE] スタイルのメモを削る
  if (/^> \[![A-Z]+\]/.test(line)) {
    continue;
  }

  // mermaid ブロック検出
  if (trimmed === MERMAID_FENCE) {
    inMermaid = true;
    const block = mermaidBlocks[mermaidOutIndex++];
    if (block && block.imageUrl) {
      out.push(`![Mermaid diagram ${block.index + 1}](${block.imageUrl})`);
      out.push("");
    }
    continue;
  }

  if (inMermaid) {
    if (trimmed === FENCE) {
      inMermaid = false;
    }
    continue;
  }

  out.push(line);
}

fs.writeFileSync(destPath, out.join("\n"), "utf8");
