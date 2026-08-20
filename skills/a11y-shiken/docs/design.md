# accessibility-test スキル 設計ドキュメント

## 1. 概要

WCAG 2.2 Level AA 準拠のアクセシビリティチェックを、3段階の自動化で効率化するスキル。

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│  axe-core   │ →   │  Claude HTML    │ →   │  目視確認     │
│  自動判定    │     │  分析判定       │     │  チェックシート │
│  (5+10項目)  │     │  (~20項目)      │     │  (~15項目)    │
└─────────────┘     └─────────────────┘     └──────────────┘
        ↓                    ↓                      ↓
  violations/          WebFetch で            ブラウザ操作が
  passes/incomplete    HTML 静的分析           必要な項目
  をタグでマッピング     で判定可能な項目
```

### 背景と目的

- Webサイトのアクセシビリティ準拠状況を、なるべく自動で評価したい
- WCAG 2.2 Level A + AA の全55達成基準を対象
- axe-core だけでは全項目を網羅できない（自動検出可能は約15項目）
- Claude の HTML 分析で追加 ~20 項目をカバーし、人手の目視確認を ~15 項目まで削減

## 2. アーキテクチャ

### ファイル構成

```
accessibility-test/
├── SKILL.md                              # スキル定義（ワークフロー）
├── scripts/
│   ├── package.json                      # 依存: playwright, @axe-core/playwright, exceljs
│   ├── a11y-test.ts                      # axe-core テスト実行スクリプト
│   ├── a11y-visual-test.ts               # Playwright 目視確認自動化スクリプト
│   └── generate-checklist-xlsx.ts        # Excel チェックシート生成スクリプト
└── references/
    ├── wcag-checklist.md                 # WCAG 2.2 A+AA 全達成基準リスト
    └── design.md                         # 本ドキュメント
```

### 技術スタック

| コンポーネント | 技術 | 役割 |
|-------------|------|------|
| ランタイム | Bun | TypeScript の直接実行 |
| ブラウザ自動化 | Playwright (Chromium) | ページ読み込み + axe-core 実行 |
| a11y テスト | @axe-core/playwright | WCAG 準拠の自動チェック |
| Excel 生成 | ExcelJS | .xlsx ファイル生成（色分け・フィルター付き） |
| HTML 分析 | Claude (WebFetch) | 目視確認項目のHTML静的分析 |
| スプレッドシート | gog CLI | Google Sheets への結果書き込み |

### データフロー

```
URL入力
  │
  ├── [Step 2] Playwright + axe-core
  │     └── JSON結果 (violations / incomplete / passes)
  │
  ├── [Step 2.5] Playwright visual-test
  │     └── JSON結果 (15チェック: target-size/label-in-name/フォーム関連 等)
  │
  ├── [Step 3] 結果分析
  │     └── WCAG タグマッピング (wcag143 → 1.4.3 等)
  │
  ├── [Step 4] レポート① 詳細レポート (.md)
  │     └── violations/incomplete/passes の詳細表示
  │
  ├── [Step 5] レポート② チェックシート (.md)
  │     └── 55項目フラット一覧 + axe-core 結果マッピング
  │
  ├── [Step 5.5] レポート③ Excel チェックシート (.xlsx)
  │     └── generate-checklist-xlsx.ts で生成
  │
  ├── [Step 5.6] レポート④ Claude検証版 (.md)
  │     └── WebFetch → HTML分析 → 目視確認項目の追加判定
  │
  ├── [Step 5.7] Google Sheets 書き込み (オプション)
  │     └── gog sheets update で既存シートに結果反映
  │
  └── [Step 6] ファイル保存
```

## 3. 主要コンポーネント詳細

### 3.1 a11y-test.ts（axe-core テスト実行）

**入力**: URL（必須）、--tags、--exclude（オプション）
**出力**: JSON（stdout）

```typescript
// 主要な処理フロー
1. Playwright で Chromium 起動（headless、scripts/lib/stable-browser.ts の共通設定）
2. ページ読み込み（stable-browser の決定的手順: load 待ち → networkidle best-effort →
   全ページスクロールで lazy-load 発火 → フォント待ち → アニメーション凍結CSS注入）
3. AxeBuilder でテスト実行（デフォルトタグ: wcag2a, wcag2aa, wcag21a, wcag21aa）
4. 結果を整形して JSON 出力
```

**出力 JSON 構造**:
```json
{
  "url": "https://example.com",
  "timestamp": "2026-02-27T04:03:00.000Z",
  "summary": { "violations": 3, "passes": 23, "incomplete": 3 },
  "violations": [{ "id": "color-contrast", "impact": "serious", "tags": ["wcag143"], "nodes": [...] }],
  "incomplete": [...],
  "passes": [{ "id": "html-lang-valid", "tags": ["wcag311"] }]
}
```

### 3.2 generate-checklist-xlsx.ts（Excel 生成）

**入力**: --json（axe-core JSON ファイル）、--output（出力先 .xlsx）
**出力**: Excel ファイル

**設計ポイント**:

1. **WCAG 55項目をハードコード**: `WCAG_CRITERIA` 配列として定数定義。順序は `references/wcag-checklist.md` に準拠

2. **axe-core タグマッピング**: 各達成基準に対応するタグ（例: `wcag143` → 1.4.3 コントラスト）で violations / incomplete / passes を照合

3. **結果判定の優先順位**:
   ```
   violations にマッチ → 不適合（表示: 修正あり、担当: 自動判定）
   incomplete にマッチ → 要確認（表示: 未確認、担当: 要目視確認）
   passes にマッチ    → axeCoverage が "full"    → 適合  （表示: 確認OK、担当: 自動判定）
                        axeCoverage が "partial" → 要確認（表示: 未確認、担当: 要目視確認）
   いずれにもマッチせず → 目視確認（表示: 未確認、担当: 要目視確認）
   ```

   `axeCoverage` は「axe-core のルール群がその達成基準をどこまでカバーしているか」を示す
   55項目ごとのフラグ（issue #31）。達成基準の一部しか検証していない `partial` の項目では、
   axe-core の pass を適合の根拠にしない。**現時点で `full` は0件（55項目すべて `partial`）**で、
   フラグと分岐は将来 full と判断できる基準が出たときのために残してある

   この axe-core 判定に、Claude → Visual → Interactive の順で結果を重ねる。
   **warning は上書きせず**（下位の判定を維持し、未確認の項目には懸念点だけを備考へ引き継ぐ）、
   **「適合」への上書きは証拠（Claude は `evidence`、Visual / Interactive は `details`）がある場合のみ**通す。
   詳細は `docs/how-it-works.md` 第3章

4. **Excel フォーマット**:
   - ヘッダー: 青背景(#2B579A)・白文字・太字
   - 結果セルの色分け: 緑(適合) / 赤(不適合) / 黄(要確認) / 灰(目視確認)
   - オートフィルター対応
   - 列: No. / カテゴリ / チェック項目 / 達成基準 / レベル / 確認内容 / 担当 / 結果 / 備考

### 3.3 a11y-visual-test.ts（Playwright 目視確認自動化）

**入力**: URL（必須）
**出力**: JSON（stdout）

axe-core では検出できないが、Playwright のブラウザ操作（viewport 変更・フォーカス操作・スタイル変更・CDP）で自動判定可能な項目をチェックする。

```typescript
// 主要な処理フロー
1. Playwright で Chromium 起動（headless、scripts/lib/stable-browser.ts の共通設定）
2. ページ読み込み（stable-browser の決定的手順）
3. 15チェックを順次実行（すべて DOM 読み取り / CDP のみで、リロード不要）
4. 結果を整形して JSON 出力
```

> **注記（現行実装）**: 下表のうち viewport 変更・フォーカス操作を伴う7チェック
> （`reflow` / `orientation` / `focus-visible` / `keyboard-trap` / `focus-order` /
> `text-resize` / `focus-not-obscured`）は `a11y-interactive-test.ts` に統合済み。
> 現在の visual-test は DOM 読み取りのみの 9 チェック + フォーム関連 6 チェック
> （1.3.5 / 3.3.1 / 3.3.2 / 3.3.3 / 3.3.7 / 3.3.8 の該当コンテンツ有無判定）の計15チェック。

**実装チェック一覧**:

| Tier | ID | 基準 | チェック名 | 手法 |
|------|-----|------|-----------|------|
| 1 | `reflow` | 1.4.10 | リフロー | viewport 320px → `scrollWidth > innerWidth` 判定 |
| 1 | `orientation` | 1.3.4 | 表示の向き | meta viewport の orientation ロック検出 |
| 1 | `target-size` | 2.5.8 | ターゲットサイズ（最小） | `getBoundingClientRect()` で 24x24px 未満の操作要素を検出 |
| 1 | `focus-visible` | 2.4.7 | フォーカス可視化 | `focus()` 前後の `outline/box-shadow/border` 差分比較 |
| 1 | `label-in-name` | 2.5.3 | 名前のラベル | `innerText` が `aria-label/aria-labelledby` に含まれるか |
| 2 | `keyboard-trap` | 2.1.2 | キーボードトラップ | Tab 連打でフォーカス循環を検出（2要素間ループ検知） |
| 2 | `focus-order` | 2.4.3 | フォーカス順序 | Tab 巡回で Y 座標逆行（100px超）を検出 |
| 2 | `text-resize` | 1.4.4 | テキスト拡大 | `fontSize=200%` 設定 → `overflow:hidden` でクリップされる要素検出 |
| 2 | `non-text-contrast` | 1.4.11 | 非テキストコントラスト | ボタン/入力欄の `border-color` vs `background-color` のコントラスト比計算（3:1基準） |
| 2 | `focus-not-obscured` | 2.4.11 | フォーカスの不明瞭化防止 | フォーカス要素が `position:fixed/sticky` 要素で完全に隠れないか検出 |
| 2 | `dragging-movements` | 2.5.7 | ドラッグ操作 | `draggable="true"` 属性と drag 系イベントリスナー（CDP）の検出 |

**結果ラベルマッピング**:
- `pass` → 確認OK（担当: 自動判定(Visual)）
- `fail` → 修正あり（担当: 自動判定(Visual)）
- `warning` → 未確認(要確認)（担当: 要目視確認）

**設計ポイント**:
- viewport 変更・フォーカス操作を伴うチェックは interactive-test 側に分離し、visual-test は読み取り専用（後続チェックへの影響なし・リロード不要）
- 各チェック関数は `Page` を受け取り `CheckResult` を返す独立した関数
- 新規依存なし（Playwright は既存 package.json に含まれる）
- Tier 1 は高信頼性（自動判定結果をそのまま採用可能）、Tier 2 は中信頼性（warning 多め、目視確認を推奨）

**出力 JSON 構造**:
```json
{
  "url": "https://example.com",
  "timestamp": "2026-02-27T04:03:00.000Z",
  "summary": { "pass": 5, "fail": 2, "warning": 2 },
  "checks": [
    { "id": "reflow", "criterion": "1.4.10", "name": "リフロー",
      "result": "pass", "details": "320px幅で水平スクロールなし", "elements": [] }
  ]
}
```

### 3.4 Claude HTML 分析検証（SKILL.md ステップ 5.6）

スクリプト化せず、Claude 自身が WebFetch でページを取得して分析する。
なお、a11y-visual-test.ts で判定済みの項目（1.3.4, 1.4.4, 1.4.10, 1.4.11, 2.1.2, 2.4.3, 2.4.7, 2.4.11, 2.5.3, 2.5.7, 2.5.8）は visual-test の結果を優先する。

**判定可能な項目（~20項目）**:

| 分析内容 | 対応する達成基準 |
|---------|--------------|
| 音声・映像要素の有無 | 1.2.1〜1.2.5 |
| 見出し構造の階層 | 1.3.1, 2.4.6 |
| DOM順序の論理性 | 1.3.2 |
| 感覚的特徴への依存 | 1.3.3 |
| 色のみの情報伝達 | 1.4.1 |
| 自動再生音声 | 1.4.2 |
| 文字画像の使用 | 1.4.5 |
| overflow:hidden 等 | 1.4.12 |
| ホバー/フォーカスコンテンツ | 1.4.13 |
| キーボードショートカット | 2.1.4 |
| 時間制限コンテンツ | 2.2.1 |
| CSSアニメーション制御 | 2.2.2 |
| 閃光 | 2.3.1 |
| スキップリンク/ランドマーク | 2.4.1 |
| リンクテキスト品質 | 2.4.4 |
| 複数の到達手段 | 2.4.5 |
| 動きによる起動 | 2.5.4 |
| 言語マークアップ | 3.1.2 |
| ナビゲーション一貫性 | 3.2.3 |
| aria-live 領域 | 4.1.3 |

**判定不可（ブラウザ操作が必要、~15項目）**:
- 表示の向き(1.3.4)、リフロー(1.4.10)、非テキストコントラスト(1.4.11)
- キーボードトラップ(2.1.2)、フォーカス順序(2.4.3)、フォーカス可視化(2.4.7)
- ポインタ操作(2.5.1, 2.5.2)、名前のラベル(2.5.3)
- フォーカス時/入力時の挙動(3.2.1, 3.2.2)、一貫した識別性(3.2.4)
- フォームのエラー処理(3.3.1, 3.3.3, 3.3.4)

### 3.5 Google Sheets 連携（ステップ 5.7）

**前提**: `gog` CLI がインストール・認証済み、対象ファイルが Google Sheets 形式（xlsx のままでは不可）

**連携フロー**:
```
1. gog sheets metadata <ID>     → シート名・構造を取得
2. gog sheets get <ID> '<範囲>'  → ヘッダー行・データ範囲を確認
3. axe-core結果 + Claude結果をマッピング
4. gog sheets update <ID> '<範囲>' --values-json '[...]'  → 担当列・チェック欄を一括更新
```

**注意**: スプレッドシートの列構成はプロジェクトにより異なるため、書き込み前にヘッダー行を確認すること。

## 4. 結果ラベル体系

### 内部ステータス → 表示ラベル

| 内部ステータス | 表示ラベル（結果列） | 担当列 |
|-------------|-------------------|--------|
| 適合 | 確認OK | 自動判定 |
| 不適合 | 修正あり | 自動判定 |
| 要確認 | 未確認 | 要目視確認 |
| 目視確認 | 未確認 | 要目視確認 |
| — | 確認OK / 修正あり | 自動判定(Claude) |

「要確認」（axe-core の incomplete、または axe-core カバレッジガードによる降格）と「目視確認」（どの検査も判定に至らなかった）は由来が違うだけで、**表示はどちらも「未確認」**。incomplete を「修正あり」と読ませない。

### 3段階の判定主体

```
自動判定      → axe-core による機械的テスト結果
自動判定(Claude) → Claude のHTML静的分析による判定
要目視確認    → 人間によるブラウザ操作での確認が必要
```

## 5. 出力ファイル

| # | ファイル名パターン | 形式 | 内容 |
|---|------------------|------|------|
| ① | `a11y-report-{ドメイン}-{日付}.md` | Markdown | 詳細レポート（violations/incomplete/passes + 目視確認チェックシート） |
| ② | `a11y-checklist-{ドメイン}-{日付}.md` | Markdown | フラットチェックシート（55項目、axe-core結果マッピング済） |
| ③ | `a11y-checklist-{ドメイン}-{日付}.xlsx` | Excel | 色分けチェックシート（generate-checklist-xlsx.ts で生成） |
| ④ | `a11y-checklist-claude-{ドメイン}-{日付}.md` | Markdown | Claude検証版チェックシート（axe-core + Claude HTML分析統合） |

## 6. axe-core タグマッピング

axe-core の各ルールは `tags` 配列に WCAG 基準への参照を持つ。このタグを使って結果を達成基準にマッピングする。

```
axe-core タグ    →  WCAG 達成基準
wcag111         →  1.1.1 非テキストコンテンツ
wcag131         →  1.3.1 情報及び関係性
wcag143         →  1.4.3 コントラスト（最低限）
wcag211         →  2.1.1 キーボード
wcag241         →  2.4.1 ブロックスキップ
wcag242         →  2.4.2 ページタイトル
wcag311         →  3.1.1 ページの言語
wcag412         →  4.1.2 名前、役割、値
  ...
```

**タグ命名規則**: `wcag` + 達成基準番号からドットを除去（例: 1.4.3 → `wcag143`、1.4.10 → `wcag1410`）

## 7. 設計判断の記録

### なぜ axe-core の結果を JSON 中間ファイル経由で Excel 生成するか

- axe-core テストは Playwright ブラウザ起動が必要で実行コストが高い
- JSON を一時ファイルに保存することで、再実行なしに Excel 再生成が可能
- Markdown チェックシートは Claude が直接生成するため、スクリプト不要

### なぜ WCAG 基準を TypeScript にハードコードするか

- `references/wcag-checklist.md` はClaude が参照する用（Markdown形式）
- TypeScript スクリプトで正確にマッピングするには、構造化データとしてコード内に定義する方が確実
- 55項目は WCAG 2.2 で固定されており、頻繁な更新は不要

### なぜ Claude 検証をスクリプト化しないか

- HTML の意味的分析は LLM の得意分野であり、ルールベースのスクリプト化は困難
- 「該当コンテンツなし」の判断や文脈依存の判定は Claude の柔軟性が必要
- WebFetch の結果は毎回異なるため、対話的な分析が適している

### 結果ラベルの変更経緯

初期実装では技術的なラベル（適合/不適合/要確認/目視確認）を使用していたが、チェックシートの利用者（非技術者含む）にわかりやすいよう変更:

```
適合     → 確認OK
不適合   → 修正あり
要確認   → 修正あり（内部的には区別を保持）
目視確認 → 未確認
```

## 8. 今後の展望

### 8.1 複数URL一括処理

現在は単一URL指定だが、複数URLを一括で処理する機能を計画中。

**入力方式（検討中）**:

#### A. 引数でスペース区切り（現行拡張）
```bash
/accessibility-test https://example.com https://example.com/about https://example.com/contact
```
- メリット: 現行のインターフェースを維持、少数URL向け
- デメリット: URL数が多い場合に不便

#### B. CSV/テキストファイル指定
```bash
/accessibility-test --urls urls.csv
```

CSVフォーマット案:
```csv
url,label
https://example.com,トップページ
https://example.com/about,会社概要
https://example.com/contact,お問い合わせ
```
- メリット: 大量URL対応、ラベル付けによるレポート可読性向上
- デメリット: ファイル準備の手間

**出力の変更点**:
- レポート①②④: URL ごとにセクション分割、または URL ごとに個別ファイル生成
- レポート③ (Excel): シートをURL ごとに分割、またはサマリーシート追加
- Google Sheets: URL ごとに別シートに書き込み

**実装で検討すべき点**:
- axe-core テストの並列実行（Playwright の同時起動数制限）
- 共通ナビゲーション部分の重複検出（同一サイト内の共通ヘッダー/フッター）
- サイト全体のサマリーレポート（URL横断の集計）
- Claude 検証の効率化（共通部分は1回の分析で済ませる）

### 8.2 その他の検討事項

- **ブラウザ自動操作による目視確認の自動化**: Claude in Chrome MCP が安定すれば、Tab操作・リサイズ等の検証も自動化可能
- **差分レポート**: 前回テスト結果との比較で改善/劣化を可視化
- **CI/CD 統合**: GitHub Actions 等でのパイプライン組み込み
