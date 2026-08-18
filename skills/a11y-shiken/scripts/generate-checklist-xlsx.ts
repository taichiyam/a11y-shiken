#!/usr/bin/env bun

import ExcelJS from "exceljs";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, isAbsolute } from "path";

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

interface AxeNode {
  html: string;
  target: string[];
  failureSummary?: string;
}

interface AxeRule {
  id: string;
  impact?: string;
  description: string;
  help?: string;
  helpUrl?: string;
  tags: string[];
  nodes?: AxeNode[];
}

interface AxeResult {
  url: string;
  timestamp: string;
  violations: AxeRule[];
  incomplete: AxeRule[];
  passes: AxeRule[];
}

// --- Visual テスト JSON 型定義 ---

interface VisualCheckResult {
  id: string;
  criterion: string;
  name: string;
  result: "pass" | "fail" | "warning";
  details: string;
  elements: { selector: string; issue: string }[];
}

interface VisualTestOutput {
  url: string;
  timestamp: string;
  summary: { pass: number; fail: number; warning: number };
  checks: VisualCheckResult[];
}

// --- Interactive テスト JSON 型定義 ---

interface InteractiveTestResult {
  criterion: string;
  name: string;
  status: "pass" | "fail" | "warning";
  source: string;
  details: string;
  screenshots?: string[];
}

interface InteractiveTestOutput {
  url: string;
  timestamp: string;
  results: InteractiveTestResult[];
}

// --- Claude 分析オーバーライド JSON 型定義 ---

interface ClaudeOverride {
  criterion: string;
  status: "pass" | "fail" | "warning" | "not-applicable";
  details: string;
}

interface ClaudeOverridesResult {
  overrides: ClaudeOverride[];
}

// --- マニフェスト JSON 型定義 ---

interface ManifestEntry {
  label: string;
  url: string;
  axeJson: string;
  visualJson?: string;
  interactiveJson?: string;
  overridesJson?: string;
}

interface Manifest {
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

interface WcagCriterion {
  id: string; // e.g. "1.1.1"
  name: string;
  category: string; // 原則
  level: "A" | "AA";
  description: string; // 確認内容
  axeTags: string[]; // マッチ対象の axe-core タグ (e.g. ["wcag111"])
}

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
  },
  {
    id: "1.2.1",
    name: "音声のみ及び映像のみ（収録済）",
    category: "知覚可能",
    level: "A",
    description:
      "音声のみ/映像のみのコンテンツに代替テキストまたは代替メディアが提供されているか",
    axeTags: ["wcag121"],
  },
  {
    id: "1.2.2",
    name: "キャプション（収録済）",
    category: "知覚可能",
    level: "A",
    description: "収録済み映像に正確なキャプション（字幕）が付与されているか",
    axeTags: ["wcag122"],
  },
  {
    id: "1.2.3",
    name: "音声解説又はメディアに対する代替（収録済）",
    category: "知覚可能",
    level: "A",
    description:
      "映像コンテンツに音声解説またはテキストによる代替が提供されているか",
    axeTags: ["wcag123"],
  },
  {
    id: "1.2.4",
    name: "キャプション（ライブ）",
    category: "知覚可能",
    level: "AA",
    description: "ライブ映像にリアルタイムのキャプションが提供されているか",
    axeTags: ["wcag124"],
  },
  {
    id: "1.2.5",
    name: "音声解説（収録済）",
    category: "知覚可能",
    level: "AA",
    description: "収録済み映像に音声解説が提供されているか",
    axeTags: ["wcag125"],
  },
  {
    id: "1.3.1",
    name: "情報及び関係性",
    category: "知覚可能",
    level: "A",
    description:
      "見出し構造（h1-h6）の妥当性、フォーム要素のラベル紐付け、テーブルのth/caption",
    axeTags: ["wcag131"],
  },
  {
    id: "1.3.2",
    name: "意味のある順序",
    category: "知覚可能",
    level: "A",
    description:
      "DOMの順序が視覚的な表示順序と一致しているか。CSSで位置変更した場合に読み上げ順序が意味を保つか",
    axeTags: ["wcag132"],
  },
  {
    id: "1.3.3",
    name: "感覚的な特徴",
    category: "知覚可能",
    level: "A",
    description:
      "色・形・位置のみで情報を伝えていないか（例：「赤いボタンを押してください」）",
    axeTags: ["wcag133"],
  },
  {
    id: "1.3.4",
    name: "表示の向き",
    category: "知覚可能",
    level: "AA",
    description:
      "コンテンツが縦向き・横向きの両方で閲覧可能か。特定の向きに固定されていないか",
    axeTags: ["wcag134"],
  },
  {
    id: "1.3.5",
    name: "入力目的の特定",
    category: "知覚可能",
    level: "AA",
    description:
      "フォーム要素に適切なautocomplete属性が設定されているか",
    axeTags: ["wcag135"],
  },
  {
    id: "1.4.1",
    name: "色の使用",
    category: "知覚可能",
    level: "A",
    description:
      "色だけで情報を伝えていないか。色以外の手がかり（テキスト、アイコン、下線等）があるか",
    axeTags: ["wcag141"],
  },
  {
    id: "1.4.2",
    name: "音声の制御",
    category: "知覚可能",
    level: "A",
    description:
      "自動再生される音声が3秒以上の場合、一時停止/停止/音量調整の手段があるか",
    axeTags: ["wcag142"],
  },
  {
    id: "1.4.3",
    name: "コントラスト（最低限）",
    category: "知覚可能",
    level: "AA",
    description:
      "テキストと背景のコントラスト比が4.5:1以上（大文字テキストは3:1以上）",
    axeTags: ["wcag143"],
  },
  {
    id: "1.4.4",
    name: "テキストのサイズ変更",
    category: "知覚可能",
    level: "AA",
    description:
      "テキストを200%まで拡大しても、コンテンツや機能が損なわれないか",
    axeTags: ["wcag144"],
  },
  {
    id: "1.4.5",
    name: "文字画像",
    category: "知覚可能",
    level: "AA",
    description:
      "テキストの代わりに画像化された文字を使用していないか（ロゴ等の例外を除く）",
    axeTags: ["wcag145"],
  },
  {
    id: "1.4.10",
    name: "リフロー",
    category: "知覚可能",
    level: "AA",
    description:
      "幅320px（400%ズーム）まで縮小しても横スクロールなしでコンテンツが閲覧可能か",
    axeTags: ["wcag1410"],
  },
  {
    id: "1.4.11",
    name: "非テキストのコントラスト",
    category: "知覚可能",
    level: "AA",
    description:
      "UIコンポーネントやグラフィックのコントラスト比が3:1以上か",
    axeTags: ["wcag1411"],
  },
  {
    id: "1.4.12",
    name: "テキストの間隔",
    category: "知覚可能",
    level: "AA",
    description:
      "行の高さ1.5倍、段落間隔2倍、文字間隔0.12倍、単語間隔0.16倍に変更しても内容が損なわれないか",
    axeTags: ["wcag1412"],
  },
  {
    id: "1.4.13",
    name: "ホバー又はフォーカスで表示されるコンテンツ",
    category: "知覚可能",
    level: "AA",
    description:
      "ホバー/フォーカスで表示されるコンテンツが、解除可能・ホバー維持可能・自動非表示しないか",
    axeTags: ["wcag1413"],
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
  },
  {
    id: "2.1.2",
    name: "キーボードトラップなし",
    category: "操作可能",
    level: "A",
    description:
      "キーボード操作でフォーカスが特定の要素に閉じ込められないか",
    axeTags: ["wcag212"],
  },
  {
    id: "2.1.4",
    name: "文字キーのショートカット",
    category: "操作可能",
    level: "A",
    description:
      "文字キー単独のショートカットがある場合、無効化/再設定/フォーカス時のみ有効にする手段があるか",
    axeTags: ["wcag214"],
  },
  {
    id: "2.2.1",
    name: "タイミング調整可能",
    category: "操作可能",
    level: "A",
    description:
      "制限時間のあるコンテンツで、延長/解除/事前通知の手段があるか",
    axeTags: ["wcag221"],
  },
  {
    id: "2.2.2",
    name: "一時停止、停止、非表示",
    category: "操作可能",
    level: "A",
    description:
      "自動的に動く/スクロールする/点滅するコンテンツに一時停止/停止の手段があるか",
    axeTags: ["wcag222"],
  },
  {
    id: "2.3.1",
    name: "3回の閃光、又は閾値以下",
    category: "操作可能",
    level: "A",
    description: "1秒間に3回以上の閃光を放つコンテンツがないか",
    axeTags: ["wcag231"],
  },
  {
    id: "2.4.1",
    name: "ブロックスキップ",
    category: "操作可能",
    level: "A",
    description:
      "ページ上部にスキップリンク、またはランドマーク（main, nav等）が設定されているか",
    axeTags: ["wcag241"],
  },
  {
    id: "2.4.2",
    name: "ページタイトル",
    category: "操作可能",
    level: "A",
    description:
      "title要素が存在し、ページ内容を適切に説明しているか",
    axeTags: ["wcag242"],
  },
  {
    id: "2.4.3",
    name: "フォーカス順序",
    category: "操作可能",
    level: "A",
    description:
      "Tabキーでのフォーカス移動順序が論理的で意味のある順序になっているか",
    axeTags: ["wcag243"],
  },
  {
    id: "2.4.4",
    name: "リンクの目的（コンテキスト内）",
    category: "操作可能",
    level: "A",
    description:
      "リンクテキストが単体またはコンテキスト内でリンク先を理解できるか",
    axeTags: ["wcag244"],
  },
  {
    id: "2.4.5",
    name: "複数の手段",
    category: "操作可能",
    level: "AA",
    description:
      "ページへの到達手段が2つ以上あるか（ナビゲーション、サイトマップ、検索等）",
    axeTags: ["wcag245"],
  },
  {
    id: "2.4.6",
    name: "見出し及びラベル",
    category: "操作可能",
    level: "AA",
    description: "見出し・ラベルが内容を適切に説明しているか",
    axeTags: ["wcag246"],
  },
  {
    id: "2.4.7",
    name: "フォーカスの可視化",
    category: "操作可能",
    level: "AA",
    description:
      "キーボードフォーカスが視覚的に確認できるか。outline: noneでフォーカスインジケーターが消されていないか",
    axeTags: ["wcag247"],
  },
  {
    id: "2.4.11",
    name: "フォーカスの不明瞭化防止",
    category: "操作可能",
    level: "AA",
    description:
      "フォーカスされた要素がposition:fixed/sticky等の要素で完全に隠れないか",
    axeTags: ["wcag2411"],
  },
  {
    id: "2.5.1",
    name: "ポインタのジェスチャ",
    category: "操作可能",
    level: "A",
    description:
      "マルチタッチやパス依存のジェスチャが必要な機能に、シングルポインタの代替手段があるか",
    axeTags: ["wcag251"],
  },
  {
    id: "2.5.2",
    name: "ポインタのキャンセル",
    category: "操作可能",
    level: "A",
    description:
      "mousedown/touchstartだけで機能が実行されず、キャンセル手段があるか",
    axeTags: ["wcag252"],
  },
  {
    id: "2.5.3",
    name: "名前（name）のラベル",
    category: "操作可能",
    level: "A",
    description:
      "視覚的なラベルがアクセシブルネーム（aria-label等）に含まれているか",
    axeTags: ["wcag253"],
  },
  {
    id: "2.5.4",
    name: "動きによる起動",
    category: "操作可能",
    level: "A",
    description:
      "デバイスの動き（振る、傾ける等）で起動する機能に、UIによる代替手段があるか",
    axeTags: ["wcag254"],
  },

  {
    id: "2.5.7",
    name: "ドラッグ操作",
    category: "操作可能",
    level: "AA",
    description:
      "ドラッグ操作が必要な機能に、単一ポインタの代替手段があるか",
    axeTags: ["wcag257"],
  },
  {
    id: "2.5.8",
    name: "ターゲットサイズ（最小）",
    category: "操作可能",
    level: "AA",
    description:
      "操作要素のターゲットサイズが最低24x24pxあるか（インラインリンク等の例外を除く）",
    axeTags: ["wcag258"],
  },

  // --- 3. 理解可能 (Understandable) ---
  {
    id: "3.1.1",
    name: "ページの言語",
    category: "理解可能",
    level: "A",
    description: "html要素にlang属性が正しく設定されているか",
    axeTags: ["wcag311"],
  },
  {
    id: "3.1.2",
    name: "一部分の言語",
    category: "理解可能",
    level: "AA",
    description:
      "ページの主言語と異なる言語の部分にlang属性が設定されているか",
    axeTags: ["wcag312"],
  },
  {
    id: "3.2.1",
    name: "フォーカス時",
    category: "理解可能",
    level: "A",
    description:
      "フォーカスを受け取っただけでコンテキストの変化（ページ遷移、ポップアップ等）が起きないか",
    axeTags: ["wcag321"],
  },
  {
    id: "3.2.2",
    name: "入力時",
    category: "理解可能",
    level: "A",
    description:
      "フォーム要素の値を変更しただけで予期しないコンテキストの変化が起きないか",
    axeTags: ["wcag322"],
  },
  {
    id: "3.2.3",
    name: "一貫したナビゲーション",
    category: "理解可能",
    level: "AA",
    description:
      "複数ページ間でナビゲーションの順序と構成が一貫しているか",
    axeTags: ["wcag323"],
  },
  {
    id: "3.2.4",
    name: "一貫した識別性",
    category: "理解可能",
    level: "AA",
    description:
      "同じ機能を持つコンポーネントが一貫して識別されているか（同じアイコン、ラベルを使用）",
    axeTags: ["wcag324"],
  },
  {
    id: "3.2.6",
    name: "一貫したヘルプ",
    category: "理解可能",
    level: "A",
    description:
      "ヘルプ手段（連絡先、チャットbot等）が複数ページ間で一貫した相対的な位置にあるか",
    axeTags: ["wcag326"],
  },
  {
    id: "3.3.1",
    name: "エラーの特定",
    category: "理解可能",
    level: "A",
    description:
      "入力エラーが自動検出された場合、エラー箇所と内容がテキストで説明されているか",
    axeTags: ["wcag331"],
  },
  {
    id: "3.3.2",
    name: "ラベル又は説明",
    category: "理解可能",
    level: "A",
    description:
      "フォーム要素にラベルまたは入力説明があるか。label要素の紐付けと説明の適切さ",
    axeTags: ["wcag332"],
  },
  {
    id: "3.3.3",
    name: "エラー修正の提案",
    category: "理解可能",
    level: "AA",
    description:
      "入力エラーが検出された場合、修正方法の提案が提示されるか",
    axeTags: ["wcag333"],
  },
  {
    id: "3.3.4",
    name: "エラー回避（法的、金融、データ）",
    category: "理解可能",
    level: "AA",
    description:
      "法的/金融的な取引やデータ送信の前に、確認・修正・取消が可能か",
    axeTags: ["wcag334"],
  },

  {
    id: "3.3.7",
    name: "冗長な入力",
    category: "理解可能",
    level: "A",
    description:
      "同一プロセス内で以前に入力された情報の再入力を求めないか（自動入力、選択肢からの選択等の手段があるか）",
    axeTags: ["wcag337"],
  },
  {
    id: "3.3.8",
    name: "アクセシブル認証（最小）",
    category: "理解可能",
    level: "AA",
    description:
      "認証プロセスが認知機能テスト（パスワード記憶、パズル解読等）のみに依存していないか",
    axeTags: ["wcag338"],
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
  },
  {
    id: "4.1.3",
    name: "ステータスメッセージ",
    category: "堅牢",
    level: "AA",
    description:
      "成功/エラー/進行状況等のステータスメッセージがrole=\"status\"やaria-liveで支援技術に伝わるか",
    axeTags: ["wcag413"],
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

interface CriterionResult {
  status: ResultStatus;
  source: string; // "自動判定", "自動判定(Visual)", "自動判定(Interactive)", "自動判定(Claude)", "要目視確認"
  notes: string;
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

  // passes にマッチ → 適合
  const matchedPasses = data.passes.filter(matchesTags);
  if (matchedPasses.length > 0) {
    return { status: "適合", source: "自動判定", notes: "" };
  }

  // いずれにも該当しない → 目視確認
  return { status: "目視確認", source: "要目視確認", notes: "" };
}

// --- 結果統合 ---

function mergeResults(
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
      result = {
        status: (override.status === "pass" || override.status === "not-applicable") ? "適合" : "不適合",
        source: "自動判定(Claude)",
        notes: override.details || result.notes,
      };
    } else if (
      override?.status === "warning" &&
      override.details &&
      (result.status === "目視確認" || result.status === "要確認")
    ) {
      // warning は判定を上書きしないが、Claude が記載した懸念点は備考として引き継ぐ
      result = { ...result, notes: result.notes ? `${result.notes}; ${override.details}` : override.details };
    }
  }

  // 3. Visual テスト結果を適用（Claude より優先）
  if (visualData) {
    const check = visualData.checks.find((c) => c.criterion === criterion.id);
    if (check && check.result !== "warning") {
      result = {
        status: check.result === "pass" ? "適合" : "不適合",
        source: "自動判定(Visual)",
        notes: check.result === "fail" ? check.details : result.notes,
      };
    }
  }

  // 4. Interactive テスト結果を適用（最優先）
  if (interactiveData) {
    const check = interactiveData.results.find(
      (r) => r.criterion === criterion.id
    );
    if (check && check.status !== "warning") {
      result = {
        status: check.status === "pass" ? "適合" : "不適合",
        source: "自動判定(Interactive)",
        notes: check.status === "fail" ? check.details : result.notes,
      };
    }
  }

  return result;
}

// --- merged-result.json 出力 ---

interface MergedResultItem {
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
}

interface MergedResult {
  url: string;
  testDate: string;
  summary: { pass: number; fail: number; unknown: number };
  items: MergedResultItem[];
}

function buildMergedResult(
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

// --- マルチURL Excel 生成 ---

async function generateMultiUrlExcel(manifest: Manifest, outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const dateStr = formatDateStr(manifest.testDate);
  const sheetNames = new Set<string>();

  // 1. 「まとめ」シートをプレースホルダーとして先に追加
  sheetNames.add("まとめ");
  const summarySheet = workbook.addWorksheet("まとめ");

  // 2. 各URLの詳細シートを生成 + merged-result.json 出力
  const summaries: UrlSummary[] = [];

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
      ? loadJson<ClaudeOverridesResult>(entry.overridesJson)
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
  }

  // 3. 「まとめ」シートにサマリーを書き込み
  populateSummarySheet(summarySheet, summaries, dateStr);

  // 4. 保存
  await workbook.xlsx.writeFile(outputPath);

  // 5. コンソール出力
  console.log(`Excel チェックシートを生成しました: ${outputPath}`);
  console.log(`  - ${manifest.entries.length} URL × ${WCAG_CRITERIA.length} 項目`);
  console.log(`  - シート: まとめ + ${summaries.map((s) => s.sheetName).join(", ")}`);

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

  const summary = generateDetailSheet(
    workbook, "チェックシート", axeData.url, dateStr,
    axeData, visualData, interactiveData, claudeOverrides
  );

  await workbook.xlsx.writeFile(outputPath);

  console.log(`Excel チェックシートを生成しました: ${outputPath}`);
  console.log(`  - ${WCAG_CRITERIA.length} 項目`);
  console.log(`  - 確認OK: ${summary.passCount} / 修正あり: ${summary.failCount} / 未確認: ${summary.unknownCount}`);
}

// --- メイン ---

function loadJson<T>(path: string): T {
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content) as T;
}

const args = parseArgs();

if (args.manifestPath) {
  // マルチURL モード
  const manifest = loadJson<Manifest>(args.manifestPath);
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
    ? loadJson<ClaudeOverridesResult>(args.overridesJsonPath)
    : undefined;

  generateSingleUrlExcel(axeData, args.outputPath, visualData, interactiveData, claudeOverrides).catch(
    (err) => {
      console.error("Error:", err.message);
      process.exit(1);
    }
  );
}
