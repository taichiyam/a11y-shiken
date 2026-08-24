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
 * JSON 文字列を <script> 要素の中に安全に置けるようエスケープする。
 *
 * `</script>` だけを潰しても足りない。HTML の script tokenizer は `<!--` のあとに `<script` が
 * 現れると script data double escaped state に入り、そこから先は本来の `</script>` すら
 * 閉じタグとして扱わなくなる。結果、スクリプト全体が実行されずページが描画されない。
 * アクセシビリティレポートは対象サイトの HTML スニペットをそのまま引用するため、
 * `<!--<script>` は現実に起こりうる入力である（実際に Chromium で再現を確認した）。
 *
 * そこで個別のパターンを潰すのではなく `<` を一律 < に置き換える。JSON 文字列リテラルの
 * 中では < は `<` と等価に解釈されるため、埋め込んだ本文の内容は変わらない。
 *
 * あわせて U+2028 / U+2029 も escape する。これらは JSON では有効な文字だが、
 * ES2019 より前の JavaScript では行終端子として扱われ、古いパーサーで構文エラーになる。
 */
export function escapeJsonForScriptTag(json: string): string {
  return json
    .replace(/</g, "\\u003C")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * ライブラリ本体を <script> に埋め込めるか検査する。
 *
 * JSON と違いライブラリは生の JavaScript なので、`<` を一律置換すると比較演算子まで
 * 壊れてしまう。埋め込めない文字列を含んでいないことを確認したうえでそのまま入れる。
 * npm 由来の信頼できるコードだが、バージョンアップで混入したときに黙って壊れないよう
 * 明示的に落とす。
 */
export function assertEmbeddableScript(source: string, name: string): void {
  if (/<\/script/i.test(source)) {
    throw new Error(`${name} に </script> が含まれるため埋め込めません`);
  }
  // `<!--` は単体なら script data escaped state に入るだけで閉じタグは効く。
  // 危険なのは、そのあとに `<script` が続いて double escaped state へ進む場合で、
  // そこから先は本来の `</script>` すら閉じタグとして扱われなくなる。
  // 厳密な状態機械までは追わず、両方を含むライブラリは埋め込み対象から外す。
  if (/<!--/.test(source) && /<script/i.test(source)) {
    throw new Error(
      `${name} に <!-- と <script が両方含まれるため埋め込めません（script tokenizer が壊れる可能性があります）`
    );
  }
}

/**
 * ライブラリ末尾の sourceMappingURL コメントを取り除く。
 * 残したまま file:// で開くと、存在しない .map を探しに行って
 * コンソールに ERR_FILE_NOT_FOUND が出る（描画自体には影響しない）。
 *
 * 行頭の空白は [ \t] に限定する。`\s` だと改行まで食べて直前の空行を巻き込むため。
 */
export function stripSourceMappingUrl(source: string): string {
  return source
    .replace(/^[ \t]*\/\/[#@][ \t]*sourceMappingURL=.*$/gm, "")
    .replace(/\/\*[#@][ \t]*sourceMappingURL=[\s\S]*?\*\//g, "");
}

export interface BuildOptions {
  template: string;
  libraries: string[];
  pages: PageEntry[];
  contents: Record<string, string>;
}

export function buildHtml({ template, libraries, pages, contents }: BuildOptions): string {
  const libTags = libraries
    .map((lib, i) => {
      const body = stripSourceMappingUrl(lib);
      assertEmbeddableScript(body, `ライブラリ ${i + 1}`);
      return `<script>\n${body}\n</script>`;
    })
    .join("\n  ");

  const data = [
    `const pages = ${escapeJsonForScriptTag(JSON.stringify(pages, null, 2))};`,
    `  const pageContents = ${escapeJsonForScriptTag(JSON.stringify(contents))};`,
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
