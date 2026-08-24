#!/usr/bin/env bun

import ExcelJS from "exceljs";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, isAbsolute } from "path";
import { BASELINE_ITEMS, aggregate } from "./generate-baseline-view";
import type { BaselineStatus } from "./generate-baseline-view";

// --- CLI ---

interface CliArgs {
  // Legacy mode (single URL)
  jsonPath?: string;
  visualJsonPath?: string;
  interactiveJsonPath?: string;
  overridesJsonPath?: string;
  // Multi-URL mode
  manifestPath?: string;
  // Common
  outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let jsonPath: string | undefined;
  let outputPath = "";
  let visualJsonPath: string | undefined;
  let interactiveJsonPath: string | undefined;
  let overridesJsonPath: string | undefined;
  let manifestPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json" && args[i + 1]) {
      jsonPath = args[i + 1];
      i++;
    } else if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === "--visual-json" && args[i + 1]) {
      visualJsonPath = args[i + 1];
      i++;
    } else if (args[i] === "--interactive-json" && args[i + 1]) {
      interactiveJsonPath = args[i + 1];
      i++;
    } else if (args[i] === "--overrides-json" && args[i + 1]) {
      overridesJsonPath = args[i + 1];
      i++;
    } else if (args[i] === "--manifest" && args[i + 1]) {
      manifestPath = args[i + 1];
      i++;
    }
  }

  if (!outputPath || (!jsonPath && !manifestPath)) {
    console.error(
      `Usage:
  単一URL: bun generate-checklist-xlsx.ts --json <axe-core JSON> --output <出力先.xlsx> [--visual-json ...] [--interactive-json ...] [--overrides-json ...]
  複数URL: bun generate-checklist-xlsx.ts --manifest <manifest.json> --output <出力先.xlsx>`
    );
    process.exit(1);
  }

  if (jsonPath && manifestPath) {
    console.error("Error: --json と --manifest は同時に指定できません。");
    process.exit(1);
  }

  return { jsonPath, outputPath, visualJsonPath, interactiveJsonPath, overridesJsonPath, manifestPath };
}

// --- axe-core JSON 型定義 ---

export interface AxeNode {
  html: string;
  target: string[];
  failureSummary?: string;
}

export interface AxeRule {
  id: string;
  impact?: string;
  description: string;
  help?: string;
  helpUrl?: string;
  tags: string[];
  nodes?: AxeNode[];
}

export interface AxeResult {
  url: string;
  timestamp: string;
  violations: AxeRule[];
  incomplete: AxeRule[];
  passes: AxeRule[];
}

// --- Visual テスト JSON 型定義 ---

export interface VisualCheckResult {
  id: string;
  criterion: string;
  name: string;
  result: "pass" | "fail" | "warning";
  details: string;
  elements: { selector: string; issue: string }[];
}

export interface VisualTestOutput {
  url: string;
  timestamp: string;
  summary: { pass: number; fail: number; warning: number };
  checks: VisualCheckResult[];
}

// --- Interactive テスト JSON 型定義 ---

export interface InteractiveTestResult {
  criterion: string;
  name: string;
  status: "pass" | "fail" | "warning";
  source: string;
  details: string;
  screenshots?: string[];
}

export interface InteractiveTestOutput {
  url: string;
  timestamp: string;
  results: InteractiveTestResult[];
}

// --- Claude 分析オーバーライド JSON 型定義 ---

export interface ClaudeOverride {
  criterion: string;
  status: "pass" | "fail" | "warning" | "not-applicable";
  details: string;
  // pass / fail / not-applicable の判定根拠（セレクタ・accessible name・属性値等）。
  // 空・欠落の場合は sanitizeClaudeOverrides() が warning に強制降格する
  evidence: string;
}

export interface ClaudeOverridesResult {
  overrides: ClaudeOverride[];
}

function hasEvidence(text: string | undefined): boolean {
  return typeof text === "string" && text.trim() !== "";
}

// 証拠必須ガード: evidence が空・欠落の pass / fail / not-applicable を warning（未確認）に強制降格する。
// not-applicable も「確認OK」として出力されるため、pass と同様に証拠を要求する
export function sanitizeClaudeOverrides(raw: ClaudeOverridesResult): {
  result: ClaudeOverridesResult;
  demotions: string[];
} {
  const demotions: string[] = [];
  const overrides = raw.overrides.map((o) => {
    if (o.status === "warning" || hasEvidence(o.evidence)) return o;
    demotions.push(`${o.criterion}: 証拠なしの ${o.status} 判定を warning に降格しました`);
    return {
      ...o,
      status: "warning" as const,
      details: `【証拠なしのため未確認に降格（元判定: ${o.status}）】${o.details ?? ""}`.trim(),
    };
  });
  return { result: { overrides }, demotions };
}

// --- マニフェスト JSON 型定義 ---

export interface ManifestEntry {
  label: string;
  url: string;
  axeJson: string;
  visualJson?: string;
  interactiveJson?: string;
  overridesJson?: string;
}

export interface Manifest {
  testDate: string;
  entries: ManifestEntry[];
}

// --- サマリーデータ ---

interface UrlSummary {
  label: string;
  url: string;
  sheetName: string;
  passCount: number;
  failCount: number;
  unknownCount: number;
  total: number;
}

// --- WCAG 達成基準の定義 (references/wcag-checklist.md の順序) ---

export interface WcagCriterion {
  id: string; // e.g. "1.1.1"
  name: string;
  category: string; // 原則
  level: "A" | "AA";
  description: string; // 確認内容
  axeTags: string[]; // マッチ対象の axe-core タグ (e.g. ["wcag111"])
  // axe-core のルール群が、この達成基準の要求をどこまでカバーしているか。
  // - "full":    ルール群が達成基準の要求をほぼ満たして検証している。pass → 適合
  //              **現時点で該当する基準は 1 つもない（55 項目すべて "partial"）**
  // - "partial": 達成基準の一部の条件しか見ていない（特定要素の有無だけ、値の妥当性だけ 等）。
  //              または axe-core に実質的なルールが無い。pass → 要確認（未確認表示）に倒す
  // 「間違った合格は、間違った不合格よりはるかに悪い」ため、判断に迷う場合は "partial" を選ぶ。
  // なお pass の扱いを変えるだけで、violations（不適合）・incomplete（要確認）の扱いは変えない。
  // Visual / Interactive / 生成AI が証拠つきで pass を出した場合は従来どおり「適合」になる。
  axeCoverage: AxeCoverage;
}

export type AxeCoverage = "full" | "partial";

// axeCoverage の判定根拠は docs/how-it-works.md 第5章「各基準が何を検証し、何を検証していないか」に
// 55 項目ぶんまとめてある。
//
// **現時点で "full" は 0 項目。axe-core の pass だけを根拠に適合と判定する基準は存在しない。**
// 唯一の候補だった 1.4.3 も、`color-contrast` が測定できるのは CSS で描画されたテキストだけで、
// 達成基準が対象に含む「画像化されたテキスト」を検証できないため "partial" とした（issue #31 レビュー指摘）。
// 型と分岐は将来に備えて残してある。axe-core 側の改善や新ルールで達成基準の全体を検証できる
// ようになった基準が出たら、根拠を添えて "full" にする。
const WCAG_CRITERIA: WcagCriterion[] = [
  // --- 1. 知覚可能 (Perceivable) ---
  {
    id: "1.1.1",
    name: "非テキストコンテンツ",
    category: "知覚可能",
    level: "A",
    description:
      "img要素のalt属性の有無、alt値が適切か、装飾画像にalt=\"\"が設定されているか",
    axeTags: ["wcag111"],
    axeCoverage: "partial",
  },
  {
    id: "1.2.1",
    name: "音声のみ及び映像のみ（収録済）",
    category: "知覚可能",
    level: "A",
    description:
      "音声のみ/映像のみのコンテンツに代替テキストまたは代替メディアが提供されているか",
    axeTags: ["wcag121"],
    axeCoverage: "partial",
  },
  {
    id: "1.2.2",
    name: "キャプション（収録済）",
    category: "知覚可能",
    level: "A",
    description: "収録済み映像に正確なキャプション（字幕）が付与されているか",
    axeTags: ["wcag122"],
    axeCoverage: "partial",
  },
  {
    id: "1.2.3",
    name: "音声解説又はメディアに対する代替（収録済）",
    category: "知覚可能",
    level: "A",
    description:
      "映像コンテンツに音声解説またはテキストによる代替が提供されているか",
    axeTags: ["wcag123"],
    axeCoverage: "partial",
  },
  {
    id: "1.2.4",
    name: "キャプション（ライブ）",
    category: "知覚可能",
    level: "AA",
    description: "ライブ映像にリアルタイムのキャプションが提供されているか",
    axeTags: ["wcag124"],
    axeCoverage: "partial",
  },
  {
    id: "1.2.5",
    name: "音声解説（収録済）",
    category: "知覚可能",
    level: "AA",
    description: "収録済み映像に音声解説が提供されているか",
    axeTags: ["wcag125"],
    axeCoverage: "partial",
  },
  {
    id: "1.3.1",
    name: "情報及び関係性",
    category: "知覚可能",
    level: "A",
    description:
      "見出し構造（h1-h6）の妥当性、フォーム要素のラベル紐付け、テーブルのth/caption",
    axeTags: ["wcag131"],
    axeCoverage: "partial",
  },
  {
    id: "1.3.2",
    name: "意味のある順序",
    category: "知覚可能",
    level: "A",
    description:
      "DOMの順序が視覚的な表示順序と一致しているか。CSSで位置変更した場合に読み上げ順序が意味を保つか",
    axeTags: ["wcag132"],
    axeCoverage: "partial",
  },
  {
    id: "1.3.3",
    name: "感覚的な特徴",
    category: "知覚可能",
    level: "A",
    description:
      "色・形・位置のみで情報を伝えていないか（例：「赤いボタンを押してください」）",
    axeTags: ["wcag133"],
    axeCoverage: "partial",
  },
  {
    id: "1.3.4",
    name: "表示の向き",
    category: "知覚可能",
    level: "AA",
    description:
      "コンテンツが縦向き・横向きの両方で閲覧可能か。特定の向きに固定されていないか",
    axeTags: ["wcag134"],
    axeCoverage: "partial",
  },
  {
    id: "1.3.5",
    name: "入力目的の特定",
    category: "知覚可能",
    level: "AA",
    description:
      "フォーム要素に適切なautocomplete属性が設定されているか",
    axeTags: ["wcag135"],
    axeCoverage: "partial",
  },
  {
    id: "1.4.1",
    name: "色の使用",
    category: "知覚可能",
    level: "A",
    description:
      "色だけで情報を伝えていないか。色以外の手がかり（テキスト、アイコン、下線等）があるか",
    axeTags: ["wcag141"],
    axeCoverage: "partial",
  },
  {
    id: "1.4.2",
    name: "音声の制御",
    category: "知覚可能",
    level: "A",
    description:
      "自動再生される音声が3秒以上の場合、一時停止/停止/音量調整の手段があるか",
    axeTags: ["wcag142"],
    axeCoverage: "partial",
  },
  {
    id: "1.4.3",
    name: "コントラスト（最低限）",
    category: "知覚可能",
    level: "AA",
    description:
      "テキストと背景のコントラスト比が4.5:1以上（大文字テキストは3:1以上）",
    axeTags: ["wcag143"],
    // color-contrast はコントラスト比そのものを計測するが、対象は CSS で描画されたテキストに限られる。
    // 達成基準は「画像化されたテキスト」も対象に含むため、低コントラストの文字画像が同居していても
    // 通常テキストの pass だけで基準全体が適合になってしまう。よって "partial"
    axeCoverage: "partial",
  },
  {
    id: "1.4.4",
    name: "テキストのサイズ変更",
    category: "知覚可能",
    level: "AA",
    description:
      "テキストを200%まで拡大しても、コンテンツや機能が損なわれないか",
    axeTags: ["wcag144"],
    axeCoverage: "partial",
  },
  {
    id: "1.4.5",
    name: "文字画像",
    category: "知覚可能",
    level: "AA",
    description:
      "テキストの代わりに画像化された文字を使用していないか（ロゴ等の例外を除く）",
    axeTags: ["wcag145"],
    axeCoverage: "partial",
  },
  {
    id: "1.4.10",
    name: "リフロー",
    category: "知覚可能",
    level: "AA",
    description:
      "幅320px（400%ズーム）まで縮小しても横スクロールなしでコンテンツが閲覧可能か",
    axeTags: ["wcag1410"],
    axeCoverage: "partial",
  },
  {
    id: "1.4.11",
    name: "非テキストのコントラスト",
    category: "知覚可能",
    level: "AA",
    description:
      "UIコンポーネントやグラフィックのコントラスト比が3:1以上か",
    axeTags: ["wcag1411"],
    axeCoverage: "partial",
  },
  {
    id: "1.4.12",
    name: "テキストの間隔",
    category: "知覚可能",
    level: "AA",
    description:
      "行の高さ1.5倍、段落間隔2倍、文字間隔0.12倍、単語間隔0.16倍に変更しても内容が損なわれないか",
    axeTags: ["wcag1412"],
    axeCoverage: "partial",
  },
  {
    id: "1.4.13",
    name: "ホバー又はフォーカスで表示されるコンテンツ",
    category: "知覚可能",
    level: "AA",
    description:
      "ホバー/フォーカスで表示されるコンテンツが、解除可能・ホバー維持可能・自動非表示しないか",
    axeTags: ["wcag1413"],
    axeCoverage: "partial",
  },

  // --- 2. 操作可能 (Operable) ---
  {
    id: "2.1.1",
    name: "キーボード",
    category: "操作可能",
    level: "A",
    description:
      "すべての機能がキーボードだけで操作可能か。Tab/Enter/Space/矢印キーで全要素にアクセスできるか",
    axeTags: ["wcag211"],
    axeCoverage: "partial",
  },
  {
    id: "2.1.2",
    name: "キーボードトラップなし",
    category: "操作可能",
    level: "A",
    description:
      "キーボード操作でフォーカスが特定の要素に閉じ込められないか",
    axeTags: ["wcag212"],
    axeCoverage: "partial",
  },
  {
    id: "2.1.4",
    name: "文字キーのショートカット",
    category: "操作可能",
    level: "A",
    description:
      "文字キー単独のショートカットがある場合、無効化/再設定/フォーカス時のみ有効にする手段があるか",
    axeTags: ["wcag214"],
    axeCoverage: "partial",
  },
  {
    id: "2.2.1",
    name: "タイミング調整可能",
    category: "操作可能",
    level: "A",
    description:
      "制限時間のあるコンテンツで、延長/解除/事前通知の手段があるか",
    axeTags: ["wcag221"],
    axeCoverage: "partial",
  },
  {
    id: "2.2.2",
    name: "一時停止、停止、非表示",
    category: "操作可能",
    level: "A",
    description:
      "自動的に動く/スクロールする/点滅するコンテンツに一時停止/停止の手段があるか",
    axeTags: ["wcag222"],
    axeCoverage: "partial",
  },
  {
    id: "2.3.1",
    name: "3回の閃光、又は閾値以下",
    category: "操作可能",
    level: "A",
    description: "1秒間に3回以上の閃光を放つコンテンツがないか",
    axeTags: ["wcag231"],
    axeCoverage: "partial",
  },
  {
    id: "2.4.1",
    name: "ブロックスキップ",
    category: "操作可能",
    level: "A",
    description:
      "ページ上部にスキップリンク、またはランドマーク（main, nav等）が設定されているか",
    axeTags: ["wcag241"],
    axeCoverage: "partial",
  },
  {
    id: "2.4.2",
    name: "ページタイトル",
    category: "操作可能",
    level: "A",
    description:
      "title要素が存在し、ページ内容を適切に説明しているか",
    axeTags: ["wcag242"],
    axeCoverage: "partial",
  },
  {
    id: "2.4.3",
    name: "フォーカス順序",
    category: "操作可能",
    level: "A",
    description:
      "Tabキーでのフォーカス移動順序が論理的で意味のある順序になっているか",
    axeTags: ["wcag243"],
    axeCoverage: "partial",
  },
  {
    id: "2.4.4",
    name: "リンクの目的（コンテキスト内）",
    category: "操作可能",
    level: "A",
    description:
      "リンクテキストが単体またはコンテキスト内でリンク先を理解できるか",
    axeTags: ["wcag244"],
    axeCoverage: "partial",
  },
  {
    id: "2.4.5",
    name: "複数の手段",
    category: "操作可能",
    level: "AA",
    description:
      "ページへの到達手段が2つ以上あるか（ナビゲーション、サイトマップ、検索等）",
    axeTags: ["wcag245"],
    axeCoverage: "partial",
  },
  {
    id: "2.4.6",
    name: "見出し及びラベル",
    category: "操作可能",
    level: "AA",
    description: "見出し・ラベルが内容を適切に説明しているか",
    axeTags: ["wcag246"],
    axeCoverage: "partial",
  },
  {
    id: "2.4.7",
    name: "フォーカスの可視化",
    category: "操作可能",
    level: "AA",
    description:
      "キーボードフォーカスが視覚的に確認できるか。outline: noneでフォーカスインジケーターが消されていないか",
    axeTags: ["wcag247"],
    axeCoverage: "partial",
  },
  {
    id: "2.4.11",
    name: "フォーカスの不明瞭化防止",
    category: "操作可能",
    level: "AA",
    description:
      "フォーカスされた要素がposition:fixed/sticky等の要素で完全に隠れないか",
    axeTags: ["wcag2411"],
    axeCoverage: "partial",
  },
  {
    id: "2.5.1",
    name: "ポインタのジェスチャ",
    category: "操作可能",
    level: "A",
    description:
      "マルチタッチやパス依存のジェスチャが必要な機能に、シングルポインタの代替手段があるか",
    axeTags: ["wcag251"],
    axeCoverage: "partial",
  },
  {
    id: "2.5.2",
    name: "ポインタのキャンセル",
    category: "操作可能",
    level: "A",
    description:
      "mousedown/touchstartだけで機能が実行されず、キャンセル手段があるか",
    axeTags: ["wcag252"],
    axeCoverage: "partial",
  },
  {
    id: "2.5.3",
    name: "名前（name）のラベル",
    category: "操作可能",
    level: "A",
    description:
      "視覚的なラベルがアクセシブルネーム（aria-label等）に含まれているか",
    axeTags: ["wcag253"],
    axeCoverage: "partial",
  },
  {
    id: "2.5.4",
    name: "動きによる起動",
    category: "操作可能",
    level: "A",
    description:
      "デバイスの動き（振る、傾ける等）で起動する機能に、UIによる代替手段があるか",
    axeTags: ["wcag254"],
    axeCoverage: "partial",
  },

  {
    id: "2.5.7",
    name: "ドラッグ操作",
    category: "操作可能",
    level: "AA",
    description:
      "ドラッグ操作が必要な機能に、単一ポインタの代替手段があるか",
    axeTags: ["wcag257"],
    axeCoverage: "partial",
  },
  {
    id: "2.5.8",
    name: "ターゲットサイズ（最小）",
    category: "操作可能",
    level: "AA",
    description:
      "操作要素のターゲットサイズが最低24x24pxあるか（インラインリンク等の例外を除く）",
    axeTags: ["wcag258"],
    axeCoverage: "partial",
  },

  // --- 3. 理解可能 (Understandable) ---
  {
    id: "3.1.1",
    name: "ページの言語",
    category: "理解可能",
    level: "A",
    description: "html要素にlang属性が正しく設定されているか",
    axeTags: ["wcag311"],
    axeCoverage: "partial",
  },
  {
    id: "3.1.2",
    name: "一部分の言語",
    category: "理解可能",
    level: "AA",
    description:
      "ページの主言語と異なる言語の部分にlang属性が設定されているか",
    axeTags: ["wcag312"],
    axeCoverage: "partial",
  },
  {
    id: "3.2.1",
    name: "フォーカス時",
    category: "理解可能",
    level: "A",
    description:
      "フォーカスを受け取っただけでコンテキストの変化（ページ遷移、ポップアップ等）が起きないか",
    axeTags: ["wcag321"],
    axeCoverage: "partial",
  },
  {
    id: "3.2.2",
    name: "入力時",
    category: "理解可能",
    level: "A",
    description:
      "フォーム要素の値を変更しただけで予期しないコンテキストの変化が起きないか",
    axeTags: ["wcag322"],
    axeCoverage: "partial",
  },
  {
    id: "3.2.3",
    name: "一貫したナビゲーション",
    category: "理解可能",
    level: "AA",
    description:
      "複数ページ間でナビゲーションの順序と構成が一貫しているか",
    axeTags: ["wcag323"],
    axeCoverage: "partial",
  },
  {
    id: "3.2.4",
    name: "一貫した識別性",
    category: "理解可能",
    level: "AA",
    description:
      "同じ機能を持つコンポーネントが一貫して識別されているか（同じアイコン、ラベルを使用）",
    axeTags: ["wcag324"],
    axeCoverage: "partial",
  },
  {
    id: "3.2.6",
    name: "一貫したヘルプ",
    category: "理解可能",
    level: "A",
    description:
      "ヘルプ手段（連絡先、チャットbot等）が複数ページ間で一貫した相対的な位置にあるか",
    axeTags: ["wcag326"],
    axeCoverage: "partial",
  },
  {
    id: "3.3.1",
    name: "エラーの特定",
    category: "理解可能",
    level: "A",
    description:
      "入力エラーが自動検出された場合、エラー箇所と内容がテキストで説明されているか",
    axeTags: ["wcag331"],
    axeCoverage: "partial",
  },
  {
    id: "3.3.2",
    name: "ラベル又は説明",
    category: "理解可能",
    level: "A",
    description:
      "フォーム要素にラベルまたは入力説明があるか。label要素の紐付けと説明の適切さ",
    axeTags: ["wcag332"],
    axeCoverage: "partial",
  },
  {
    id: "3.3.3",
    name: "エラー修正の提案",
    category: "理解可能",
    level: "AA",
    description:
      "入力エラーが検出された場合、修正方法の提案が提示されるか",
    axeTags: ["wcag333"],
    axeCoverage: "partial",
  },
  {
    id: "3.3.4",
    name: "エラー回避（法的、金融、データ）",
    category: "理解可能",
    level: "AA",
    description:
      "法的/金融的な取引やデータ送信の前に、確認・修正・取消が可能か",
    axeTags: ["wcag334"],
    axeCoverage: "partial",
  },

  {
    id: "3.3.7",
    name: "冗長な入力",
    category: "理解可能",
    level: "A",
    description:
      "同一プロセス内で以前に入力された情報の再入力を求めないか（自動入力、選択肢からの選択等の手段があるか）",
    axeTags: ["wcag337"],
    axeCoverage: "partial",
  },
  {
    id: "3.3.8",
    name: "アクセシブル認証（最小）",
    category: "理解可能",
    level: "AA",
    description:
      "認証プロセスが認知機能テスト（パスワード記憶、パズル解読等）のみに依存していないか",
    axeTags: ["wcag338"],
    axeCoverage: "partial",
  },

  // --- 4. 堅牢 (Robust) ---
  {
    id: "4.1.2",
    name: "名前（name）、役割（role）及び値（value）",
    category: "堅牢",
    level: "A",
    description:
      "カスタムUIコンポーネントに適切なrole、name、stateがARIAで設定されているか",
    axeTags: ["wcag412"],
    axeCoverage: "partial",
  },
  {
    id: "4.1.3",
    name: "ステータスメッセージ",
    category: "堅牢",
    level: "AA",
    description:
      "成功/エラー/進行状況等のステータスメッセージがrole=\"status\"やaria-liveで支援技術に伝わるか",
    axeTags: ["wcag413"],
    axeCoverage: "partial",
  },
];

// --- 結果判定 ---

type ResultStatus = "適合" | "不適合" | "要確認" | "目視確認";

// 表示用ラベル
function getDisplayLabel(status: ResultStatus): string {
  switch (status) {
    case "適合": return "確認OK";
    case "不適合": return "修正あり";
    case "要確認": return "未確認";
    case "目視確認": return "未確認";
  }
}

export interface CriterionResult {
  status: ResultStatus;
  source: string; // "自動判定", "自動判定(Visual)", "自動判定(Interactive)", "自動判定(Claude)", "要目視確認"
  notes: string;
  // 前段の「不適合」を後段が「適合」で覆そうとした場合に立つ（上書きの成否を問わない）
  conflict?: boolean;
  // 「この判定がまだ確定していない理由」の説明。統合の最後に notes へ合流する。
  // 後段の判定（Visual / Interactive / Claude）が上書きした場合は破棄され、備考には残らない
  // （適合の行に「適合と判定していません」「未確認を維持」を残さないため）。用途は2つ:
  //   - axeCoverage: "partial" の基準で axe-core の pass を「要確認」に倒したときの説明
  //   - 証拠がない「適合」への上書きを却下したときの説明（不適合からの却下は矛盾として notes に残す）
  pendingNote?: string;
}

function evaluateCriterion(
  criterion: WcagCriterion,
  data: AxeResult
): CriterionResult {
  const matchesTags = (rule: AxeRule) =>
    criterion.axeTags.some((tag) => rule.tags.includes(tag));

  // violations にマッチ → 不適合
  const matchedViolations = data.violations.filter(matchesTags);
  if (matchedViolations.length > 0) {
    const summaries = matchedViolations
      .map((v) => {
        const count = v.nodes?.length ?? 0;
        return `${v.help}（${count}件）`;
      })
      .join("; ");
    return { status: "不適合", source: "自動判定", notes: summaries };
  }

  // incomplete にマッチ → 要確認
  const matchedIncomplete = data.incomplete.filter(matchesTags);
  if (matchedIncomplete.length > 0) {
    const summaries = matchedIncomplete.map((v) => v.help).join("; ");
    return { status: "要確認", source: "要目視確認", notes: summaries };
  }

  // passes にマッチ → 適合（ただし axe-core のカバレッジが部分的な基準では「要確認」に倒す）
  const matchedPasses = data.passes.filter(matchesTags);
  if (matchedPasses.length > 0) {
    if (criterion.axeCoverage === "partial") {
      // axe-core のルール群が達成基準の一部しか検証していないため、pass を適合の根拠にできない。
      // Visual / Interactive / 生成AI が証拠つきで pass を出せば、後段の統合で適合に上がる
      const ruleIds = matchedPasses.map((p) => p.id).join(", ");
      return {
        status: "要確認",
        source: "要目視確認",
        notes: "",
        pendingNote: `axe-core は達成基準の一部のみ検証（${ruleIds}）。この pass だけでは適合と判定していません`,
      };
    }
    return { status: "適合", source: "自動判定", notes: "" };
  }

  // いずれにも該当しない → 目視確認
  return { status: "目視確認", source: "要目視確認", notes: "" };
}

// --- 結果統合 ---

function joinNotes(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a}; ${b}`;
}

// 遷移ルール: 「安全側への遷移は自由、危険側への遷移は制限」
// - 適合 → 不適合、任意 → 未確認 は無条件で許可（従来どおり）
// - 任意 → 適合 の上書きは、上書き元の判定に証拠がある場合のみ許可する。
//   証拠がない場合は現在の判定を維持し、備考に却下の経緯を残す。
//   このうち「不適合 → 適合」は、許可・却下のいずれでも矛盾フラグ（conflict）を立てる
function applyOverrideStatus(
  current: CriterionResult,
  proposed: { status: "適合" | "不適合"; source: string; notes: string; evidence?: string }
): CriterionResult {
  if (proposed.status === "不適合") {
    return {
      status: "不適合",
      source: proposed.source,
      // 既に矛盾が起きている場合は「⚠️ 判定矛盾」の経緯を備考から消さない
      notes: current.conflict ? joinNotes(current.notes, proposed.notes) : proposed.notes,
      conflict: current.conflict,
    };
  }

  // ここから先は「適合」への上書き。「不適合 → 適合」は判定元の意見が割れた状態なので矛盾として記録する
  const demotesFailure = current.status === "不適合";

  if (!hasEvidence(proposed.evidence)) {
    // 証拠のない「適合」は通さず、現在の判定を維持する。
    // current をそのまま返すため、確定していない理由の説明（pendingNote）も維持される
    if (demotesFailure) {
      // 不適合を覆そうとした試みは矛盾として恒久的に記録する
      return {
        ...current,
        notes: joinNotes(
          current.notes,
          `⚠️ 判定矛盾: ${proposed.source}は適合と判定したが、証拠がないため${current.source}の不適合を維持`
        ),
        conflict: true,
      };
    }
    if (current.status === "適合") {
      // 既に証拠つきで適合になっている。証拠のない同意は何も足さないので記録しない
      return current;
    }
    // 却下の経緯は pendingNote に置く。後段が証拠つきで適合に上げた場合は破棄され、
    // 「確認OK」の行に「未確認を維持」が残らない
    return {
      ...current,
      pendingNote: joinNotes(
        current.pendingNote ?? "",
        `${proposed.source}は適合と判定したが、証拠がないため「${getDisplayLabel(current.status)}」を維持`
      ),
    };
  }

  return {
    status: "適合",
    source: proposed.source,
    notes: demotesFailure
      ? joinNotes(
          `⚠️ 判定矛盾: ${current.source}の不適合を${proposed.source}が適合で上書き`,
          proposed.notes
        )
      : // 既に矛盾が起きている場合は「⚠️ 判定矛盾」の経緯を備考から消さない
        current.conflict
        ? joinNotes(current.notes, proposed.notes)
        : proposed.notes,
    conflict: demotesFailure || current.conflict,
  };
}

export function mergeResults(
  criterion: WcagCriterion,
  axeData: AxeResult,
  visualData?: VisualTestOutput,
  interactiveData?: InteractiveTestOutput,
  claudeOverrides?: ClaudeOverridesResult
): CriterionResult {
  // 1. axe-core の評価をベースとする
  let result = evaluateCriterion(criterion, axeData);

  // 2. Claude 分析オーバーライドを適用（axe-core より優先）
  if (claudeOverrides) {
    const override = claudeOverrides.overrides.find(
      (o) => o.criterion === criterion.id
    );
    if (override && override.status !== "warning") {
      const notes = joinNotes(
        override.details || "",
        hasEvidence(override.evidence) ? `証拠: ${override.evidence.trim()}` : ""
      );
      result = applyOverrideStatus(result, {
        status: (override.status === "pass" || override.status === "not-applicable") ? "適合" : "不適合",
        source: "自動判定(Claude)",
        notes: notes || result.notes,
        evidence: override.evidence,
      });
    } else if (
      override?.status === "warning" &&
      override.details &&
      (result.status === "目視確認" || result.status === "要確認")
    ) {
      // warning は判定を上書きしないが、Claude が記載した懸念点は備考として引き継ぐ
      result = { ...result, notes: joinNotes(result.notes, override.details) };
    }
  }

  // 3. Visual テスト結果を適用（Claude より優先）
  if (visualData) {
    const check = visualData.checks.find((c) => c.criterion === criterion.id);
    if (check && check.result !== "warning") {
      result = applyOverrideStatus(result, {
        status: check.result === "pass" ? "適合" : "不適合",
        source: "自動判定(Visual)",
        // pass 時も判定根拠の details を「証拠:」として備考に残す（矛盾検証のため）
        notes: check.result === "fail"
          ? check.details
          : hasEvidence(check.details)
            ? joinNotes(result.notes, `証拠: ${check.details.trim()}`)
            : result.notes,
        evidence: check.details,
      });
    }
  }

  // 4. Interactive テスト結果を適用（最優先）
  if (interactiveData) {
    const check = interactiveData.results.find(
      (r) => r.criterion === criterion.id
    );
    if (check && check.status !== "warning") {
      result = applyOverrideStatus(result, {
        status: check.status === "pass" ? "適合" : "不適合",
        source: "自動判定(Interactive)",
        // pass 時も判定根拠の details を「証拠:」として備考に残す（矛盾検証のため）
        notes: check.status === "fail"
          ? check.details
          : hasEvidence(check.details)
            ? joinNotes(result.notes, `証拠: ${check.details.trim()}`)
            : result.notes,
        evidence: check.details,
      });
    }
  }

  // 「確定していない理由」の説明は、後段の判定に上書きされずに残った場合だけ備考へ出す。
  // 上書きされた場合は applyOverrideStatus が新しい結果を組み立てる際に破棄されている
  if (result.pendingNote) {
    const { pendingNote, ...rest } = result;
    return { ...rest, notes: joinNotes(pendingNote, result.notes) };
  }

  return result;
}

// --- merged-result.json 出力 ---

export interface MergedResultItem {
  no: number;
  criterion: string;
  category: string;
  name: string;
  level: string;
  description: string;
  source: string;
  status: ResultStatus;
  displayLabel: string;
  notes: string;
  // 前段の不適合を後段判定が適合で覆そうとした項目（詳細は notes の「⚠️ 判定矛盾」を参照）
  conflict: boolean;
}

export interface MergedResult {
  url: string;
  testDate: string;
  summary: { pass: number; fail: number; unknown: number };
  items: MergedResultItem[];
}

export function buildMergedResult(
  url: string,
  testDate: string,
  axeData: AxeResult,
  visualData?: VisualTestOutput,
  interactiveData?: InteractiveTestOutput,
  claudeOverrides?: ClaudeOverridesResult
): MergedResult {
  const items: MergedResultItem[] = [];
  let pass = 0, fail = 0, unknown = 0;

  for (let i = 0; i < WCAG_CRITERIA.length; i++) {
    const criterion = WCAG_CRITERIA[i];
    const result = mergeResults(criterion, axeData, visualData, interactiveData, claudeOverrides);
    const displayLabel = getDisplayLabel(result.status);

    if (displayLabel === "確認OK") pass++;
    else if (displayLabel === "未確認") unknown++;
    else fail++;

    items.push({
      no: i + 1,
      criterion: criterion.id,
      category: criterion.category,
      name: criterion.name,
      level: criterion.level,
      description: criterion.description,
      source: result.source,
      status: result.status,
      displayLabel,
      notes: result.notes,
      conflict: result.conflict ?? false,
    });
  }

  return { url, testDate, summary: { pass, fail, unknown }, items };
}

function exportMergedResult(mergedResult: MergedResult, outputPath: string): void {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(mergedResult, null, 2), "utf-8");
}

// --- ヘルパー関数 ---

function sanitizeSheetName(label: string, existingNames: Set<string>): string {
  // 1. 禁止文字を除去
  let name = label.replace(/[\[\]:*?/\\]/g, "");

  // 2. 31文字に切り詰め
  if (name.length > 31) {
    name = name.substring(0, 31);
  }

  // 3. 空名対策
  if (name.trim() === "") {
    name = "Sheet";
  }

  // 4. 重複時に (2), (3) ... を付与
  let candidate = name;
  let counter = 2;
  while (existingNames.has(candidate)) {
    const suffix = `(${counter})`;
    const maxBase = 31 - suffix.length;
    candidate = name.substring(0, maxBase) + suffix;
    counter++;
  }

  existingNames.add(candidate);
  return candidate;
}

function deriveLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");

    if (path) {
      const segments = path.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1];
      return path.length > 20 ? `${domain}/${lastSegment}` : `${domain}${path}`;
    }
    return domain;
  } catch {
    return url.substring(0, 31);
  }
}

function formatDateStr(timestamp: string): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// --- Excel スタイル定数 ---

const COLORS = {
  headerBg: "FF2B579A",
  headerFont: "FFFFFFFF",
  pass: "FFC6EFCE",
  passBorder: "FF006100",
  fail: "FFFFC7CE",
  failBorder: "FF9C0006",
  incomplete: "FFFFEB9C",
  incompleteBorder: "FF9C6500",
  manual: "FFD9D9D9",
  manualBorder: "FF808080",
  summaryHeaderBg: "FF1F4E79",
  linkFont: "FF0563C1",
} as const;

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

function getResultFill(status: ResultStatus): ExcelJS.FillPattern {
  switch (status) {
    case "適合":
      return { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.pass } };
    case "不適合":
      return { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.fail } };
    case "要確認":
      return { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.incomplete } };
    case "目視確認":
      return { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.manual } };
  }
}

function getResultFont(status: ResultStatus): Partial<ExcelJS.Font> {
  switch (status) {
    case "適合":
      return { bold: true, color: { argb: COLORS.passBorder } };
    case "不適合":
      return { bold: true, color: { argb: COLORS.failBorder } };
    case "要確認":
      return { bold: true, color: { argb: COLORS.incompleteBorder } };
    case "目視確認":
      return { color: { argb: COLORS.manualBorder } };
  }
}

// --- 詳細シート生成（1URL分） ---

function generateDetailSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  url: string,
  dateStr: string,
  axeData: AxeResult,
  visualData?: VisualTestOutput,
  interactiveData?: InteractiveTestOutput,
  claudeOverrides?: ClaudeOverridesResult
): UrlSummary {
  const sheet = workbook.addWorksheet(sheetName);

  // 使用ツール一覧を構築
  const tools: string[] = ["axe-core + Playwright（自動判定）"];
  if (visualData) tools.push("Playwright Visual テスト（自動判定(Visual)）");
  if (interactiveData) tools.push("Playwright Interactive テスト（自動判定(Interactive)）");
  if (claudeOverrides) tools.push("Claude HTML分析（自動判定(Claude)）");

  // メタ情報
  const metaRows = [
    ["対象URL", url],
    ["テスト日時", dateStr],
    ["対象基準", "WCAG 2.2 Level AA"],
    ["テストツール", tools.join("、")],
  ];
  for (const [label, value] of metaRows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  sheet.addRow([]);

  // 凡例
  const legendRows = [
    "凡例:",
    "  自動判定 = axe-core による自動テスト結果",
    "  自動判定(Visual) = Playwright による視覚的チェック結果",
    "  自動判定(Interactive) = Playwright によるインタラクティブ検証結果",
    "  自動判定(Claude) = Claude がHTMLソースを分析して判定した結果",
    "  要目視確認 = ブラウザ操作が必要なため、人による目視確認が必要",
  ];
  for (const text of legendRows) {
    const row = sheet.addRow([text]);
    row.getCell(1).font = { italic: true, color: { argb: "FF666666" } };
  }
  sheet.addRow([]);

  // ヘッダー行
  const headers = ["No.", "カテゴリ", "チェック項目", "達成基準", "レベル", "確認内容", "担当", "結果", "備考"];
  const headerRow = sheet.addRow(headers);
  const headerRowNumber = headerRow.number;

  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
    cell.font = { bold: true, color: { argb: COLORS.headerFont } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = THIN_BORDER;
  });

  // データ行 + 集計
  let prevCategory = "";
  let passCount = 0;
  let failCount = 0;
  let unknownCount = 0;

  for (let i = 0; i < WCAG_CRITERIA.length; i++) {
    const criterion = WCAG_CRITERIA[i];
    const result = mergeResults(criterion, axeData, visualData, interactiveData, claudeOverrides);

    const displayLabel = getDisplayLabel(result.status);
    if (displayLabel === "確認OK") passCount++;
    else if (displayLabel === "未確認") unknownCount++;
    else failCount++;

    const categoryValue = criterion.category !== prevCategory ? criterion.category : "";
    prevCategory = criterion.category;

    const row = sheet.addRow([
      i + 1, categoryValue, criterion.name, criterion.id,
      criterion.level, criterion.description, result.source,
      displayLabel, result.notes,
    ]);

    row.eachCell((cell, colNumber) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = THIN_BORDER;
      if (colNumber === 8) {
        cell.fill = getResultFill(result.status);
        cell.font = getResultFont(result.status);
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      }
    });
  }

  // 列幅
  sheet.getColumn(1).width = 5;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 30;
  sheet.getColumn(4).width = 10;
  sheet.getColumn(5).width = 8;
  sheet.getColumn(6).width = 50;
  sheet.getColumn(7).width = 22;
  sheet.getColumn(8).width = 12;
  sheet.getColumn(9).width = 40;

  // オートフィルター
  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber + WCAG_CRITERIA.length, column: 9 },
  };

  return {
    label: sheetName,
    url,
    sheetName,
    passCount,
    failCount,
    unknownCount,
    total: WCAG_CRITERIA.length,
  };
}

// --- サマリーシート生成 ---

function populateSummarySheet(
  sheet: ExcelJS.Worksheet,
  summaries: UrlSummary[],
  dateStr: string
): void {
  // メタ情報
  const metaRows = [
    ["テスト日時", dateStr],
    ["対象基準", "WCAG 2.2 Level AA"],
    ["対象URL数", String(summaries.length)],
  ];
  for (const [label, value] of metaRows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  sheet.addRow([]);

  // ヘッダー行
  const headers = ["No.", "ラベル", "URL", "確認OK", "修正あり", "未確認", "合計", "リンク"];
  const headerRow = sheet.addRow(headers);

  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.summaryHeaderBg } };
    cell.font = { bold: true, color: { argb: COLORS.headerFont } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = THIN_BORDER;
  });

  // データ行
  let totalPass = 0;
  let totalFail = 0;
  let totalUnknown = 0;

  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    totalPass += s.passCount;
    totalFail += s.failCount;
    totalUnknown += s.unknownCount;

    const row = sheet.addRow([
      i + 1, s.label, s.url,
      s.passCount, s.failCount, s.unknownCount, s.total,
      "", // リンクセルは後で設定
    ]);

    // 行の色分け
    const rowFill: ExcelJS.FillPattern | undefined =
      s.failCount > 0
        ? { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.fail } }
        : s.unknownCount === 0
          ? { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.pass } }
          : undefined;

    row.eachCell((cell, colNumber) => {
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: "middle", wrapText: true };

      // 数値列はセンタリング
      if (colNumber >= 4 && colNumber <= 7) {
        cell.alignment = { vertical: "middle", horizontal: "center" };
      }

      // 結果に応じた行色
      if (rowFill && colNumber >= 4 && colNumber <= 7) {
        cell.fill = rowFill;
      }
    });

    // ハイパーリンク設定
    const linkCell = row.getCell(8);
    linkCell.value = {
      text: "詳細シートへ",
      hyperlink: `#'${s.sheetName}'!A1`,
    } as ExcelJS.CellHyperlinkValue;
    linkCell.font = { color: { argb: COLORS.linkFont }, underline: true };
    linkCell.alignment = { vertical: "middle", horizontal: "center" };
  }

  // 合計行
  sheet.addRow([]);
  const totalRow = sheet.addRow([
    "", "合計", "",
    totalPass, totalFail, totalUnknown,
    totalPass + totalFail + totalUnknown, "",
  ]);
  totalRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true };
    cell.border = THIN_BORDER;
    if (colNumber >= 4 && colNumber <= 7) {
      cell.alignment = { vertical: "middle", horizontal: "center" };
    }
  });

  // 列幅
  sheet.getColumn(1).width = 5;
  sheet.getColumn(2).width = 24;
  sheet.getColumn(3).width = 50;
  sheet.getColumn(4).width = 10;
  sheet.getColumn(5).width = 10;
  sheet.getColumn(6).width = 10;
  sheet.getColumn(7).width = 8;
  sheet.getColumn(8).width = 16;
}

// --- 基本17項目シート（デジタル庁ガイドブック） ---

const BASELINE_ICON: Record<BaselineStatus, string> = {
  要修正: "❌ 要修正",
  確認OK: "✅ 確認OK",
  一部未確認: "⚠️ 一部未確認",
  判定対象外: "— 判定対象外",
};

function baselineFill(status: BaselineStatus): ExcelJS.FillPattern {
  const bg = {
    要修正: COLORS.fail,
    確認OK: COLORS.pass,
    一部未確認: COLORS.incomplete,
    判定対象外: COLORS.manual,
  }[status];
  return { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
}

function baselineFont(status: BaselineStatus): Partial<ExcelJS.Font> {
  const color = {
    要修正: COLORS.failBorder,
    確認OK: COLORS.passBorder,
    一部未確認: COLORS.incompleteBorder,
    判定対象外: COLORS.manualBorder,
  }[status];
  return { color: { argb: color }, bold: true };
}

/** 「5基準中 確認 3 / 不適合 1 / 未確認 1」形式の内訳文字列を組み立てる。 */
function baselineBreakdown(r: ReturnType<typeof aggregate>): string {
  const inScope = r.confirmed + r.failed + r.unconfirmed;
  if (inScope === 0) return "判定対象の基準なし";

  const parts: string[] = [];
  if (r.confirmed > 0) parts.push(`確認 ${r.confirmed}`);
  if (r.failed > 0) parts.push(`不適合 ${r.failed}`);
  if (r.unconfirmed > 0) parts.push(`未確認 ${r.unconfirmed}`);
  return `${inScope}基準中 ${parts.join(" / ")}`;
}

export interface BaselineSheetEntry {
  label: string;
  merged: MergedResult;
}

/**
 * 55 項目の判定を、デジタル庁『ウェブアクセシビリティ導入ガイドブック』の基本17項目へ集約したシートを書く。
 *
 * 行は常に 17 項目で固定し、ページが増えたときは列方向に伸ばす。横に読むことで
 * 「どのページでも直っていない共通問題」と「特定ページだけの問題」を見分けられる。
 *
 * 集約ロジックは generate-baseline-view.ts の aggregate() をそのまま使う。複製しないことで
 * Excel と Markdown の結果が食い違う余地をなくしている。特に「一部しか確認できていない項目を
 * 確認OK に丸めない」ルールは、間違った合格を生まないための中核なので必ず共有する。
 */
export function populateBaselineSheet(
  sheet: ExcelJS.Worksheet,
  entries: BaselineSheetEntry[],
  dateStr: string
): void {
  if (entries.length === 0) {
    throw new Error("基本17項目シートの生成には 1 件以上のエントリが必要です");
  }
  const isSingle = entries.length === 1;

  // 各ページ × 17項目の集約結果を先に作る
  const aggregated = entries.map((entry) => {
    const byId = new Map(entry.merged.items.map((i) => [i.criterion, i]));
    return { label: entry.label, results: BASELINE_ITEMS.map((item) => aggregate(item, byId)) };
  });

  // メタ情報
  const metaRows = [
    ["テスト日時", dateStr],
    ["集約元", "デジタル庁 ウェブアクセシビリティ導入ガイドブック 2024-03-29版 §3.1・§3.2"],
    ["対象URL数", String(entries.length)],
  ];
  for (const [label, value] of metaRows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }

  // ページごとのサマリー
  for (const page of aggregated) {
    const count = (s: BaselineStatus) => page.results.filter((r) => r.status === s).length;
    const summary = `❌ 要修正 ${count("要修正")} / ⚠️ 一部未確認 ${count("一部未確認")} / ✅ 確認OK ${count("確認OK")}`;
    const row = sheet.addRow([isSingle ? "サマリー" : page.label, summary]);
    row.getCell(1).font = { bold: true };
  }

  const noteRow = sheet.addRow([
    "この結果は正式なアクセシビリティ試験（JIS X 8341-3:2016）の代替にはなりません。",
  ]);
  noteRow.getCell(1).font = { italic: true, color: { argb: "FF666666" } };
  sheet.addRow([]);

  // ヘッダー行
  const pageHeaders = aggregated.map((p) => p.label);
  const headers = isSingle
    ? ["No.", "区分", "項目", pageHeaders[0], "内訳", "対応する達成基準"]
    : ["No.", "区分", "項目", ...pageHeaders, "対応する達成基準"];

  const headerRow = sheet.addRow(headers);
  const headerRowNumber = headerRow.number;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.summaryHeaderBg } };
    cell.font = { bold: true, color: { argb: COLORS.headerFont } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = THIN_BORDER;
  });

  // データ行（17項目固定）
  for (let i = 0; i < BASELINE_ITEMS.length; i++) {
    const item = BASELINE_ITEMS[i];
    const perPage = aggregated.map((p) => p.results[i]);

    // 判定対象内の基準は全ページで同じなので先頭ページから引く
    const criteriaIds = perPage[0].criteria.filter((c) => c.inScope).map((c) => c.id);

    const values = isSingle
      ? [
          item.no, item.severity, item.title,
          BASELINE_ICON[perPage[0].status],
          baselineBreakdown(perPage[0]),
          criteriaIds.join(", "),
        ]
      : [
          item.no, item.severity, item.title,
          ...perPage.map((r) => BASELINE_ICON[r.status]),
          criteriaIds.join(", "),
        ];

    const row = sheet.addRow(values);
    const statusColumns = isSingle ? [4] : perPage.map((_, idx) => 4 + idx);

    row.eachCell((cell, colNumber) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = THIN_BORDER;

      const statusIndex = statusColumns.indexOf(colNumber);
      if (statusIndex >= 0) {
        const status = perPage[statusIndex].status;
        cell.fill = baselineFill(status);
        cell.font = baselineFont(status);
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      }
    });
  }

  // 列幅（ページ列はアイコン中心なので詰める）
  sheet.getColumn(1).width = 5;
  sheet.getColumn(2).width = 8;
  sheet.getColumn(3).width = 38;
  if (isSingle) {
    sheet.getColumn(4).width = 16;
    sheet.getColumn(5).width = 30;
    sheet.getColumn(6).width = 34;
  } else {
    for (let i = 0; i < aggregated.length; i++) sheet.getColumn(4 + i).width = 14;
    sheet.getColumn(4 + aggregated.length).width = 34;
  }

  // ページ数が増えても何の項目を見ているか分かるよう、No./区分/項目を固定する
  sheet.views = [{ state: "frozen", xSplit: 3, ySplit: headerRowNumber }];

  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber + BASELINE_ITEMS.length, column: headers.length },
  };
}

// --- マルチURL Excel 生成 ---

export async function generateMultiUrlExcel(manifest: Manifest, outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const dateStr = formatDateStr(manifest.testDate);
  const sheetNames = new Set<string>();

  // 1. 「まとめ」「基本17項目」シートをプレースホルダーとして先に追加
  //    （ExcelJS はシートを追加順に並べるため、中身を埋めるより先に場所を確保する）
  sheetNames.add("まとめ");
  const summarySheet = workbook.addWorksheet("まとめ");
  sheetNames.add("基本17項目");
  const baselineSheet = workbook.addWorksheet("基本17項目");

  // 2. 各URLの詳細シートを生成 + merged-result.json 出力
  const summaries: UrlSummary[] = [];
  const baselineEntries: BaselineSheetEntry[] = [];

  for (const entry of manifest.entries) {
    const sheetName = sanitizeSheetName(entry.label, sheetNames);
    const axeData = loadJson<AxeResult>(entry.axeJson);

    const visualData = entry.visualJson && existsSync(entry.visualJson)
      ? loadJson<VisualTestOutput>(entry.visualJson)
      : undefined;
    const interactiveData = entry.interactiveJson && existsSync(entry.interactiveJson)
      ? loadJson<InteractiveTestOutput>(entry.interactiveJson)
      : undefined;
    const claudeOverrides = entry.overridesJson && existsSync(entry.overridesJson)
      ? loadClaudeOverrides(entry.overridesJson, entry.label)
      : undefined;

    const summary = generateDetailSheet(
      workbook, sheetName, entry.url, dateStr,
      axeData, visualData, interactiveData, claudeOverrides
    );
    summary.label = entry.label;
    summaries.push(summary);

    // merged-result.json を axeJson と同じディレクトリに出力
    const mergedResult = buildMergedResult(entry.url, dateStr, axeData, visualData, interactiveData, claudeOverrides);
    const mergedOutputPath = resolve(dirname(entry.axeJson), "merged-result.json");
    exportMergedResult(mergedResult, mergedOutputPath);
    baselineEntries.push({ label: entry.label, merged: mergedResult });
  }

  // 3. 「まとめ」「基本17項目」シートに書き込み
  populateSummarySheet(summarySheet, summaries, dateStr);
  populateBaselineSheet(baselineSheet, baselineEntries, dateStr);

  // 4. 保存
  await workbook.xlsx.writeFile(outputPath);

  // 5. コンソール出力
  console.log(`Excel チェックシートを生成しました: ${outputPath}`);
  console.log(`  - ${manifest.entries.length} URL × ${WCAG_CRITERIA.length} 項目`);
  console.log(`  - シート: まとめ + 基本17項目 + ${summaries.map((s) => s.sheetName).join(", ")}`);

  const totalPass = summaries.reduce((a, s) => a + s.passCount, 0);
  const totalFail = summaries.reduce((a, s) => a + s.failCount, 0);
  const totalUnknown = summaries.reduce((a, s) => a + s.unknownCount, 0);
  console.log(`  - 合計: 確認OK ${totalPass} / 修正あり ${totalFail} / 未確認 ${totalUnknown}`);
}

// --- レガシー単一URL Excel 生成（後方互換） ---

async function generateSingleUrlExcel(
  axeData: AxeResult,
  outputPath: string,
  visualData?: VisualTestOutput,
  interactiveData?: InteractiveTestOutput,
  claudeOverrides?: ClaudeOverridesResult
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const dateStr = formatDateStr(axeData.timestamp);

  // マニフェスト経路と同じく、基本17項目シートを詳細シートより前に置く
  const baselineSheet = workbook.addWorksheet("基本17項目");
  const summary = generateDetailSheet(
    workbook, "チェックシート", axeData.url, dateStr,
    axeData, visualData, interactiveData, claudeOverrides
  );

  const merged = buildMergedResult(axeData.url, dateStr, axeData, visualData, interactiveData, claudeOverrides);
  populateBaselineSheet(baselineSheet, [{ label: "結果", merged }], dateStr);

  await workbook.xlsx.writeFile(outputPath);

  console.log(`Excel チェックシートを生成しました: ${outputPath}`);
  console.log(`  - ${WCAG_CRITERIA.length} 項目`);
  console.log(`  - シート: 基本17項目 + チェックシート`);
  console.log(`  - 確認OK: ${summary.passCount} / 修正あり: ${summary.failCount} / 未確認: ${summary.unknownCount}`);
}

// --- メイン ---

function loadJson<T>(path: string): T {
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content) as T;
}

// claude-overrides.json を読み込み、証拠必須ガードを適用して降格ログを出力する
function loadClaudeOverrides(path: string, label?: string): ClaudeOverridesResult {
  const raw = loadJson<ClaudeOverridesResult>(path);
  const { result, demotions } = sanitizeClaudeOverrides(raw);
  for (const d of demotions) {
    console.log(`  [証拠ガード]${label ? ` ${label}:` : ""} ${d}`);
  }
  return result;
}

function main(): void {
  const args = parseArgs();

  if (args.manifestPath) {
    // マルチURL モード
    const manifest = loadJson<Manifest>(args.manifestPath);
    if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
      console.error("Error: manifest の entries が空です。1 件以上のエントリを指定してください。");
      process.exit(1);
    }
    // manifest.json 内の相対パスを manifest.json の場所基準で解決する
    const manifestDir = dirname(resolve(args.manifestPath));
    for (const entry of manifest.entries) {
      const resolvePath = (p: string) => isAbsolute(p) ? p : resolve(manifestDir, p);
      entry.axeJson = resolvePath(entry.axeJson);
      if (entry.visualJson) entry.visualJson = resolvePath(entry.visualJson);
      if (entry.interactiveJson) entry.interactiveJson = resolvePath(entry.interactiveJson);
      if (entry.overridesJson) entry.overridesJson = resolvePath(entry.overridesJson);
    }
    generateMultiUrlExcel(manifest, args.outputPath).catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
  } else if (args.jsonPath) {
    // レガシー単一URL モード
    const axeData = loadJson<AxeResult>(args.jsonPath);

    const visualData = args.visualJsonPath && existsSync(args.visualJsonPath)
      ? loadJson<VisualTestOutput>(args.visualJsonPath)
      : undefined;

    const interactiveData = args.interactiveJsonPath && existsSync(args.interactiveJsonPath)
      ? loadJson<InteractiveTestOutput>(args.interactiveJsonPath)
      : undefined;

    const claudeOverrides = args.overridesJsonPath && existsSync(args.overridesJsonPath)
      ? loadClaudeOverrides(args.overridesJsonPath)
      : undefined;

    generateSingleUrlExcel(axeData, args.outputPath, visualData, interactiveData, claudeOverrides).catch(
      (err) => {
        console.error("Error:", err.message);
        process.exit(1);
      }
    );
  }
}

if (import.meta.main) main();
