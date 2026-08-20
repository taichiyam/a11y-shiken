# アクセシビリティテスト結果統合の設計ドキュメント

## 概要

accessibility-test スキルは、3つの異なるテストツールで WCAG 2.2 Level AA の達成基準を検証します：

1. **axe-core テスト** (`a11y-test.ts`) - DOM構造の静的解析
2. **Visual テスト** (`a11y-visual-test.ts`) - Playwright による視覚的・構造的検証
3. **Interactive テスト** (`a11y-interactive-test.ts`) - Playwright によるインタラクティブ検証

これらの結果を統合して、最終的なアクセシビリティレポートを生成する必要があります。

---

## 現在の実装（この節が正）

**採用したのは後述のオプションB（スクリプトによる決定的な統合）です。** 生成 AI 判定を 4 つ目のソースとして加えたうえで、`scripts/generate-checklist-xlsx.ts` が 55 項目の最終判定を機械的に決定し、`merged-result.json` と Excel を出力します。Markdown レポートも `merged-result.json` を表示形式に変換したもので、Claude が判定を組み立て直すことはありません。

- 実体は `integrate-results.ts` ではなく **`generate-checklist-xlsx.ts`**（Excel 生成と統合を兼ねる）
- axe-core の引き当ては**ルールIDのマッピング表ではなく WCAG タグ**（`wcag111` 等）で行う。1 ルールが複数タグを持つ場合は該当するすべての基準に反映される
- 17項目ビューは `generate-baseline-view.ts` が `merged-result.json` から生成する

**重ねる順**: axe-core（土台） → Claude 判定 → Visual → Interactive（最優先）

**判定ロジック（実装済み）**:

1. axe-core の violations に一致 → **修正あり**（担当: 自動判定）
2. axe-core の incomplete に一致 → **未確認**（担当: 要目視確認）
3. axe-core の passes に一致 → その基準の `axeCoverage` が `"full"` なら **確認OK**（担当: 自動判定）、`"partial"`（達成基準の一部しか検証していない）なら **未確認**（担当: 要目視確認、issue #31）。**現時点で `"full"` は0件なので、実際には常に未確認になる**
4. いずれにも一致しない → **未確認**（担当: 要目視確認）
5. Claude / Visual / Interactive の pass → **確認OK**、fail → **修正あり**（担当: それぞれの判定ソース）
6. Claude / Visual / Interactive の **warning は判定を上書きしない**（下位の判定を維持する。未確認の項目には懸念点だけを備考へ引き継ぐ）
7. Claude の `not-applicable`（該当コンテンツなし）は pass と同じく **確認OK** として扱う

**ガード（すべてスクリプト側で機械的に適用）**:

- **証拠必須ガード**: Claude 判定の `evidence` が空・欠落なら warning へ強制降格する
- **axe-core カバレッジガード**: 上の 3 のとおり。`partial` の pass は適合の根拠にしない
- **遷移ルール**: 「適合」への上書きは、上書き元に証拠（Claude は `evidence`、Visual / Interactive は `details`）がある場合のみ許可する。「不適合 → 適合」を試みた項目は成否を問わず `conflict: true` を立て、備考に「⚠️ 判定矛盾」を残す

詳細は `docs/how-it-works.md` の第2章・第3章を参照。以下は 2026-02-27 に方式を比較したときの記録で、**現在の実装の説明ではありません。**

---

## オプションA: Claude による手動統合（2026-02-27 当時の実装・現在は不採用）

### 概要

SKILL.md の指示に従って、Claude がスキル実行時に3つのテスト結果を解釈し、統合してレポートを生成する方式です。決定性が確保できないため、現在は採用していません。

### ワークフロー

```
ステップ2: axe-core テスト実行
  ↓ JSON出力
ステップ2.5: Visual テスト実行
  ↓ JSON出力
ステップ2.7: Interactive テスト実行
  ↓ JSON出力
ステップ3: Claude が結果を分析
  ↓
ステップ5.6: Claude が結果を統合してチェックシート生成
```

### 当時の統合ルール（現在の実装は上の「現在の実装」を参照）

**優先順位**: Interactive テスト結果 > Visual テスト結果 > Claude判定 の順で上書き

**判定ロジック**:
1. axe-core の passes に含まれる項目 → **確認OK**（担当: 自動判定）※現在はカバレッジガードにより未確認
2. axe-core の violations に含まれる項目 → **修正あり**（担当: 自動判定）
3. axe-core の incomplete に含まれる項目 → **未確認**（担当: 要目視確認）
4. Visual テストで pass → **確認OK**（担当: 自動判定(Visual)）※現在は証拠がある場合のみ
5. Visual テストで fail → **修正あり**（担当: 自動判定(Visual)）
6. Visual テストで warning → 判定を上書きしない（下位の判定を維持）
7. Interactive テストで pass → **確認OK**（担当: 自動判定(Interactive)）※現在は証拠がある場合のみ
8. Interactive テストで fail → **修正あり**（担当: 自動判定(Interactive)）
9. Interactive テストで warning → 判定を上書きしない（下位の判定を維持）
10. Claude が HTML 分析で判定 → **確認OK** or **修正あり** or **未確認**（担当: 自動判定(Claude)）※現在は証拠必須ガードあり
11. 上記いずれにも該当しない → **未確認**（担当: 要目視確認）

### メリット

- ✅ **追加実装不要**: 既存の SKILL.md の指示だけで動作
- ✅ **柔軟性が高い**: Claude が状況に応じて判断できる
- ✅ **保守が容易**: スクリプトではなく自然言語の指示なので、修正が簡単
- ✅ **例外処理が優秀**: 予期しないケースにも Claude が対応できる

### デメリット

- ⚠️ **トークン消費**: Claude が毎回結果を解釈するため、トークンを消費する
- ⚠️ **実行時間**: 統合処理に若干の時間がかかる
- ⚠️ **わずかなブレ**: 同じ入力でも、出力が若干異なる可能性がある（軽微）

### 適用シーン

- スキルとして手動実行する場合（現在の主な用途）
- Claude が結果を解釈して追加の洞察を提供する場合
- テスト結果の統合ロジックが頻繁に変更される可能性がある場合

---

## オプションB: 統合スクリプトによる自動統合（採用・実装済み）

> **実装との差分**: 実際に作られたのは `integrate-results.ts` ではなく `generate-checklist-xlsx.ts` で、
> Markdown ではなく `merged-result.json` と Excel を出力します。達成基準の引き当ては、以下の設計案にある
> ルールIDのマッピング表ではなく **WCAG タグ**で行っています。生成 AI 判定（`claude-overrides.json`）も
> 4 つ目のソースとして統合されます。以下は当時の設計案であり、現在の仕様は上の「現在の実装」が正です。

### 概要

専用の統合スクリプトを作成し、テスト結果を機械的に統合して、最終的なチェックシートを生成します。

### ワークフロー

```
ステップ2: axe-core テスト実行
  ↓ JSON出力 → /tmp/axe-result.json
ステップ2.5: Visual テスト実行
  ↓ JSON出力 → /tmp/visual-result.json
ステップ2.7: Interactive テスト実行
  ↓ JSON出力 → /tmp/interactive-result.json
ステップ2.8: 統合スクリプト実行
  ↓
bun scripts/integrate-results.ts \
  --axe /tmp/axe-result.json \
  --visual /tmp/visual-result.json \
  --interactive /tmp/interactive-result.json \
  --output a11y-checklist-{domain}-{date}.md
  ↓
最終チェックシート（Markdown）
```

### 統合スクリプトの仕様

#### 入力

- `--axe <path>`: axe-core テスト結果のJSONファイル
- `--visual <path>`: Visual テスト結果のJSONファイル
- `--interactive <path>`: Interactive テスト結果のJSONファイル
- `--output <path>`: 出力するMarkdownファイルのパス
- `--format <type>`: 出力フォーマット（`markdown` | `xlsx` | `json`、デフォルト: `markdown`）

#### 出力

- Markdown形式のチェックシート（オプションAと同じフォーマット）
- 各達成基準ごとに、担当・結果・備考を記載

#### データ構造

```typescript
// WCAG 達成基準のマスターデータ
interface WCAGCriterion {
  number: string;        // 例: "1.1.1"
  name: string;          // 例: "非テキストコンテンツ"
  level: "A" | "AA";
  category: "知覚可能" | "操作可能" | "理解可能" | "堅牢";
  description: string;   // 確認ポイント
}

// テスト結果の統合データ
interface IntegratedResult {
  criterion: string;     // 達成基準番号
  担当: string;          // 例: "自動判定(Interactive)"
  結果: "確認OK" | "修正あり" | "未確認";
  備考: string;
  screenshots?: string[];
}

// 統合ロジック
function integrate(
  axeResults: AxeResult,
  visualResults: VisualResult,
  interactiveResults: InteractiveResult
): IntegratedResult[] {
  const results: Map<string, IntegratedResult> = new Map();

  // WCAG 全55項目をループ
  for (const criterion of WCAG_CRITERIA) {
    const result = {
      criterion: criterion.number,
      担当: "要目視確認",
      結果: "未確認" as const,
      備考: "",
      screenshots: []
    };

    // 1. axe-core 結果を適用
    const axeMatch = findAxeResult(axeResults, criterion);
    if (axeMatch) {
      applyAxeResult(result, axeMatch);
    }

    // 2. Visual テスト結果で上書き（優先度が高い）
    const visualMatch = findVisualResult(visualResults, criterion);
    if (visualMatch) {
      applyVisualResult(result, visualMatch);
    }

    // 3. Interactive テスト結果で上書き（最優先）
    const interactiveMatch = findInteractiveResult(interactiveResults, criterion);
    if (interactiveMatch) {
      applyInteractiveResult(result, interactiveMatch);
    }

    results.set(criterion.number, result);
  }

  return Array.from(results.values());
}
```

#### 達成基準とテスト結果のマッピング

```typescript
// axe-core のルールIDから WCAG 達成基準へのマッピング
const AXE_TO_WCAG: Record<string, string[]> = {
  "aria-hidden-body": ["1.1.1", "4.1.2"],
  "bypass": ["2.4.1"],
  "color-contrast": ["1.4.3"],
  "document-title": ["2.4.2"],
  "html-has-lang": ["3.1.1"],
  "html-lang-valid": ["3.1.1"],
  "link-name": ["2.4.4", "4.1.2"],
  "meta-viewport": ["1.4.4"],
  "target-size": ["2.5.8"],
  // ... その他のマッピング
};

// Visual テストのチェックIDから WCAG 達成基準へのマッピング
const VISUAL_TO_WCAG: Record<string, string> = {
  "reflow": "1.4.10",
  "orientation": "1.3.4",
  "target-size": "2.5.8",
  "focus-visible": "2.4.7",
  "label-in-name": "2.5.3",
  "keyboard-trap": "2.1.2",
  "focus-order": "2.4.3",
  "text-resize": "1.4.4",
  "non-text-contrast": "1.4.11",
  "heading-structure": "1.3.1",
  "aria-live": "4.1.3",
  "autoplay-media": "1.4.2",
  "char-key-shortcuts": "2.1.4",
  "motion-actuation": "2.5.4",
  "focus-not-obscured": "2.4.11",
  "dragging-movements": "2.5.7",
};

// Interactive テストの criterion から直接マッピング
const INTERACTIVE_TO_WCAG: Record<string, string> = {
  "2.4.7": "2.4.7",
  "2.4.3": "2.4.3",
  "2.1.2": "2.1.2",
  "2.4.11": "2.4.11",
  "1.4.10": "1.4.10",
  "1.3.4": "1.3.4",
  "1.4.4": "1.4.4",
  "3.2.1": "3.2.1",
  "3.2.2": "3.2.2",
};
```

### メリット

- ✅ **高速**: 機械的な処理のため、統合が瞬時に完了
- ✅ **一貫性**: 同じ入力に対して常に同じ出力が得られる
- ✅ **CIパイプライン対応**: 自動化されたテストワークフローに組み込みやすい
- ✅ **トークン消費なし**: Claude を使わないため、トークンを消費しない
- ✅ **バッチ処理可能**: 複数のURLを一括で処理できる

### デメリット

- ❌ **実装コスト**: 統合スクリプトの開発が必要（約200〜300行）
- ❌ **保守コスト**: マッピングテーブルの更新が必要（WCAG基準が変更された場合）
- ❌ **柔軟性が低い**: 予期しないケースへの対応が困難
- ❌ **洞察の欠如**: 機械的な統合のみで、Claude による追加の分析がない

### 適用シーン

- CIパイプラインで自動実行する場合
- 大量のURLを一括でテストする場合
- トークン消費を最小化したい場合
- 一貫性と再現性が重要な場合

---

## 実装ガイド（オプションB・当時の設計案）

> 実際には WCAG 55項目のマスターデータは JSON ファイルではなく、`generate-checklist-xlsx.ts` 内の
> `WCAG_CRITERIA` 定数（`axeTags` と `axeCoverage` を持つ）として実装されています。

### ステップ1: WCAG マスターデータの作成

`references/wcag-criteria.json` を作成：

```json
[
  {
    "number": "1.1.1",
    "name": "非テキストコンテンツ",
    "level": "A",
    "category": "知覚可能",
    "description": "すべての非テキストコンテンツに代替テキストがあるか"
  },
  {
    "number": "1.2.1",
    "name": "音声のみ及び映像のみ（収録済）",
    "level": "A",
    "category": "知覚可能",
    "description": "音声/映像のみのコンテンツに代替テキストがあるか"
  },
  // ... 全55項目
]
```

### ステップ2: 統合スクリプトの作成

`scripts/integrate-results.ts` を作成：

```typescript
#!/usr/bin/env bun

import { readFile } from "fs/promises";
import { WCAG_CRITERIA } from "./wcag-criteria";
import { AXE_TO_WCAG, VISUAL_TO_WCAG, INTERACTIVE_TO_WCAG } from "./mappings";

interface CliArgs {
  axe: string;
  visual: string;
  interactive: string;
  output: string;
  format: "markdown" | "xlsx" | "json";
}

function parseArgs(): CliArgs {
  // 引数パース処理
}

async function integrate(args: CliArgs): Promise<void> {
  // JSONファイルを読み込み
  const axeResults = JSON.parse(await readFile(args.axe, "utf-8"));
  const visualResults = JSON.parse(await readFile(args.visual, "utf-8"));
  const interactiveResults = JSON.parse(await readFile(args.interactive, "utf-8"));

  // 統合処理
  const integratedResults = integrateResults(axeResults, visualResults, interactiveResults);

  // 出力
  if (args.format === "markdown") {
    await generateMarkdown(integratedResults, args.output);
  } else if (args.format === "xlsx") {
    await generateExcel(integratedResults, args.output);
  } else {
    await generateJSON(integratedResults, args.output);
  }
}

const args = parseArgs();
integrate(args).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
```

### ステップ3: SKILL.md の更新

ステップ2.8を追加：

```markdown
### ステップ2.8: 結果統合（自動）

3つのテスト結果を統合して、最終チェックシートを生成する:

\`\`\`bash
bun scripts/integrate-results.ts \
  --axe /tmp/axe-result-{domain}.json \
  --visual /tmp/visual-result-{domain}.json \
  --interactive /tmp/interactive-result-{domain}.json \
  --output a11y-checklist-{domain}-{YYYY-MM-DD}.md
\`\`\`

統合ルール:
- 優先順位: Interactive > Visual > axe-core
- 同じ達成基準に複数の結果がある場合、優先度の高い方を採用
- 判定: pass → 確認OK、fail → 修正あり、warning → 未確認
```

> 実装では、この統合はステップ2.8 ではなくステップ5.6（`generate-checklist-xlsx.ts` の実行）で行われ、
> warning は「未確認にする」のではなく「上書きしない」挙動になっています。

---

## 比較表

| 項目 | オプションA（Claude統合） | オプションB（スクリプト統合） |
|------|-------------------------|----------------------------|
| **実装コスト** | なし | 約200〜300行のコード |
| **実行速度** | 普通（数秒） | 高速（瞬時） |
| **一貫性** | 中（わずかなブレあり） | 高（常に同じ結果） |
| **柔軟性** | 高（Claude が判断） | 低（ルールベース） |
| **トークン消費** | あり | なし |
| **保守コスト** | 低（自然言語の指示） | 中（マッピング更新） |
| **CI対応** | 可能（要Claude API） | 容易 |
| **洞察提供** | あり（Claude分析） | なし |
| **適用シーン** | 手動実行、柔軟な判断が必要 | CI、バッチ処理、一貫性重視 |

---

## 推奨事項

### 現在の運用

**オプションB（スクリプト統合）を採用。** 判定は `generate-checklist-xlsx.ts` が決定的に行い、Claude は判定ソースの1つ（HTML / アクセシビリティツリーの分析）としてのみ関与します。

当初はオプションA（Claude が統合する）を採っていましたが、次の理由で移行しました。

- 同じ入力に対して同じ判定を返せない（統合ロジックが自然言語の指示だったため）
- 「証拠のない合格を通さない」「部分的な検査結果を合格にしない」といったガードを、指示ではなくコードで担保する必要があった
- 複数URLの一括処理と Excel 出力が必要になった

Claude 判定の再現性は依然として決定的ではありません（`docs/how-it-works.md` 第6章）。ガードで「証拠のない判定を通さない」ことは担保していますが、毎回同じ判定を出させる仕組みではありません。

---

## 変更履歴

- **2026-02-27**: 初版作成（オプションA実装完了、オプションB設計のみ）
- **2026-08-20**: 実装がオプションB（`generate-checklist-xlsx.ts` による決定的な統合）に移行済みであることを反映。証拠必須ガード・カバレッジガード・遷移ルールを追記し、オプションAの記述を過去の記録として明示（issue #31）
