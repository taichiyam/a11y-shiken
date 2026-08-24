#!/usr/bin/env bun
/**
 * report/index.html（HTML ビューア）を単一ファイルとして生成する。
 *
 * Markdown 本文と marked.js / DOMPurify の本体をすべて HTML に埋め込むため、
 * 生成された index.html はローカルサーバーなしで file:// から直接開ける。
 *
 * 使い方:
 *   bun scripts/generate-report-html.ts \
 *     --report-dir {OUTPUT_DIR}/report \
 *     --page "概要・サマリー=./markdown/_index.md" \
 *     --page "TOP=./markdown/TOP.md"
 *
 *   --pages-json でまとめて渡すこともできる:
 *     --pages-json '[{"label":"TOP","file":"./markdown/TOP.md"}]'
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(SCRIPT_DIR, "../references/index-html-template.html");
const MARKED_PATH = resolve(SCRIPT_DIR, "node_modules/marked/lib/marked.umd.js");
const PURIFY_PATH = resolve(SCRIPT_DIR, "node_modules/dompurify/dist/purify.min.js");

export interface PageEntry {
  label: string;
  file: string;
}

/**
 * `</script>` を含む文字列を <script> 要素の中に置くと、そこで要素が閉じてしまう。
 * 対象サイトの HTML スニペットを引用したレポートで実際に起こりうるため必ず通す。
 */
export function escapeForScriptTag(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

/**
 * ライブラリ末尾の sourceMappingURL コメントを取り除く。
 * 残したまま file:// で開くと、存在しない .map を探しに行って
 * コンソールに ERR_FILE_NOT_FOUND が出る（描画自体には影響しない）。
 */
export function stripSourceMappingUrl(source: string): string {
  return source.replace(/^\s*\/\/[#@]\s*sourceMappingURL=.*$/gm, "");
}

export interface BuildOptions {
  template: string;
  libraries: string[];
  pages: PageEntry[];
  contents: Record<string, string>;
}

export function buildHtml({ template, libraries, pages, contents }: BuildOptions): string {
  const libTags = libraries
    .map((lib) => `<script>\n${escapeForScriptTag(stripSourceMappingUrl(lib))}\n</script>`)
    .join("\n  ");

  const data = [
    `const pages = ${escapeForScriptTag(JSON.stringify(pages, null, 2))};`,
    `  const pageContents = ${escapeForScriptTag(JSON.stringify(contents))};`,
  ].join("\n");

  let html = template;

  if (!html.includes("<!-- __LIBS_PLACEHOLDER__ -->")) {
    throw new Error("テンプレートに <!-- __LIBS_PLACEHOLDER__ --> が見つかりません");
  }
  if (!html.includes("// __DATA_PLACEHOLDER__")) {
    throw new Error("テンプレートに // __DATA_PLACEHOLDER__ が見つかりません");
  }

  html = html.replace("<!-- __LIBS_PLACEHOLDER__ -->", libTags);
  html = html.replace("  // __DATA_PLACEHOLDER__", `  ${data}`);

  return html;
}

/** "ラベル=パス" 形式を分解する。ラベル側に = が含まれてもよいよう最後の = で切る。 */
export function parsePageArg(arg: string): PageEntry {
  const sep = arg.lastIndexOf("=");
  if (sep <= 0 || sep === arg.length - 1) {
    throw new Error(`--page の形式が不正です（"ラベル=パス" で指定してください）: ${arg}`);
  }
  return { label: arg.slice(0, sep), file: arg.slice(sep + 1) };
}

interface CliArgs {
  reportDir: string;
  pages: PageEntry[];
  output?: string;
}

function parseArgs(argv: string[]): CliArgs {
  let reportDir = "";
  let output: string | undefined;
  const pages: PageEntry[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--report-dir") reportDir = argv[++i];
    else if (arg === "--output") output = argv[++i];
    else if (arg === "--page") pages.push(parsePageArg(argv[++i]));
    else if (arg === "--pages-json") {
      const parsed = JSON.parse(argv[++i]);
      if (!Array.isArray(parsed)) throw new Error("--pages-json は配列で指定してください");
      for (const p of parsed) {
        if (!p || typeof p.label !== "string" || typeof p.file !== "string") {
          throw new Error("--pages-json の各要素は { label, file } である必要があります");
        }
        pages.push({ label: p.label, file: p.file });
      }
    } else throw new Error(`不明な引数: ${arg}`);
  }

  if (!reportDir) throw new Error("--report-dir は必須です");
  if (pages.length === 0) throw new Error("--page または --pages-json でページを 1 つ以上指定してください");

  return { reportDir, pages, output };
}

function main(): void {
  const { reportDir, pages, output } = parseArgs(process.argv.slice(2));

  const contents: Record<string, string> = {};
  for (const page of pages) {
    const path = resolve(join(reportDir, page.file));
    if (!existsSync(path)) {
      throw new Error(`Markdown が見つかりません: ${path}`);
    }
    contents[page.file] = readFileSync(path, "utf-8");
  }

  const html = buildHtml({
    template: readFileSync(TEMPLATE_PATH, "utf-8"),
    libraries: [readFileSync(MARKED_PATH, "utf-8"), readFileSync(PURIFY_PATH, "utf-8")],
    pages,
    contents,
  });

  const outputPath = resolve(output ?? join(reportDir, "index.html"));
  writeFileSync(outputPath, html, "utf-8");

  const sizeKb = Math.round(Buffer.byteLength(html, "utf-8") / 1024);
  console.log(`HTML ビューアを生成しました: ${outputPath}`);
  console.log(`  - ${pages.length} ページを埋め込み / ${sizeKb}KB`);
  console.log(`  - ローカルサーバーなしで開けます`);
}

if (import.meta.main) main();
