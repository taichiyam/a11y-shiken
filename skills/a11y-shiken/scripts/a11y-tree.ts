#!/usr/bin/env bun
/**
 * アクセシビリティツリー取得スクリプト
 * Playwright の locator.ariaSnapshot() を使ってレンダリング済みの
 * アクセシビリティツリーをテキスト形式で出力する。
 *
 * SPA/動的コンテンツも JS 実行後の状態を正しく取得できる。
 *
 * 使い方:
 *   bun a11y-tree.ts <URL> [--output <file>]
 *   bun a11y-tree.ts https://example.com > data/a11y-tree.txt
 */

import { writeFile } from "fs/promises";
import { launchStableBrowser, gotoStable } from "./lib/stable-browser";

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0].startsWith("--")) {
    console.error("Usage: bun a11y-tree.ts <URL> [--output <file>]");
    process.exit(1);
  }
  const url = args[0];
  let output: string | null = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      output = args[i + 1];
      i++;
    }
  }
  return { url, output };
}

async function getAccessibilityTree(url: string): Promise<string> {
  const { browser, page } = await launchStableBrowser();

  try {
    // 決定的な読み込み手順（load 待ち → lazy-load 発火 → フォント待ち → アニメ凍結）
    await gotoStable(page, url);

    const snapshot = await page.locator("body").ariaSnapshot();

    if (!snapshot) {
      return "# アクセシビリティツリー\n\n(取得できませんでした)\n";
    }

    const header = [
      `# アクセシビリティツリー`,
      `URL: ${url}`,
      `取得日時: ${new Date().toISOString()}`,
      ``,
    ].join("\n");

    return `${header}${snapshot}\n`;
  } finally {
    await browser.close();
  }
}

const args = parseArgs();

getAccessibilityTree(args.url)
  .then(async (tree) => {
    if (args.output) {
      await writeFile(args.output, tree, "utf-8");
      console.error(`✅ アクセシビリティツリーを保存: ${args.output}`);
    } else {
      process.stdout.write(tree);
    }
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
