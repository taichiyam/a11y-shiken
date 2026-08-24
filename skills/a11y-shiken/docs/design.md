# a11y-shiken スキル 設計ドキュメント

> **このドキュメントの役割**
>
> スキルの内部構成（ファイル・スクリプトの責務・CLI 契約）と、実装上の設計判断を記録します。
>
> **判定ロジック・統合ルール・各基準が何を検証しているかの動作仕様は [how-it-works.md](../../../docs/how-it-works.md) を正とします。** ここでは重複させず、参照にとどめます。記述が食い違った場合は how-it-works.md と実装が正です。
>
> 統合方式（スクリプト統合を選んだ経緯と却下した代替案）は [integration-design.md](integration-design.md) を参照。

## 1. 概要

WCAG 2.2 Level A + AA の全 55 達成基準について、機械検査・生成 AI 判定・人の目視確認を組み合わせてチェックシートを生成するスキル。

```
        機械検査                  生成AI判定              目視確認
┌──────────────────────┐   ┌────────────────┐   ┌──────────────┐
│ axe-core             │   │ Claude が       │   │ 残った項目を   │
│ Visual 検査          │ → │ a11y ツリー／   │ → │ チェックシート │
│ Interactive 検査     │   │ HTML を分析     │   │ として出力     │
└──────────────────────┘   └────────────────┘   └──────────────┘
              ↓                     ↓                    ↓
        すべて generate-checklist-xlsx.ts が統合し、merged-result.json に落とす
```

### 背景と目的

- Web サイトのアクセシビリティ準拠状況を、なるべく自動で評価したい
- WCAG 2.2 Level A + AA の全 55 達成基準を対象とする
- axe-core だけでは全項目を網羅できない。加えて、axe-core の pass はどの基準でも達成基準の一部しか検証していないため、単独では「確認OK」の根拠にしない（`axeCoverage`、how-it-works.md 第 2 章）
- Visual / Interactive 検査と生成 AI 判定で埋められる範囲を広げ、人手の目視確認を減らす。ただし**証拠のない合格は通さない**方針を優先する

各基準について「自動検査だけでは確認OKにならないのはどれか」は how-it-works.md 第 5 章に 55 項目ぶんまとめてある。

## 2. アーキテクチャ

### ファイル構成

```
skills/a11y-shiken/
├── SKILL.md                              # スキル定義（ワークフロー）
├── README.md
├── scripts/
│   ├── package.json                      # 依存: playwright, @axe-core/playwright, exceljs
│   ├── lib/stable-browser.ts             # 決定的なブラウザ起動・読み込み手順（全検査で共通）
│   ├── a11y-test.ts                      # axe-core テスト実行
│   ├── a11y-visual-test.ts               # Visual 検査（DOM 読み取り・CDP）
│   ├── a11y-interactive-test.ts          # Interactive 検査（キーボード操作・viewport 変更）
│   ├── a11y-tree.ts                      # アクセシビリティツリー取得
│   ├── generate-checklist-xlsx.ts        # 結果統合 + merged-result.json / Excel 生成
│   ├── generate-baseline-view.ts         # デジタル庁 基本17項目ビュー生成
│   ├── generate-report-html.ts           # HTML ビューア生成（Markdown・ライブラリを埋め込み単一ファイル化）
│   ├── generate-checklist-xlsx.test.ts   # 統合ロジックのテスト
│   ├── generate-baseline-view.test.ts    # 17項目集約のテスト
│   └── generate-report-html.test.ts      # HTML 埋め込み・エスケープのテスト
├── references/
│   ├── wcag-checklist.md                 # WCAG 2.2 A+AA 全達成基準リスト
│   ├── digital-agency-baseline.md        # 基本17項目の対応表と出典
│   ├── report-output-design.md           # Markdown レポートのフォーマット
│   ├── google-sheets.md                  # Google Sheets 連携手順
│   └── index-html-template.html          # HTML ビューアのテンプレート（generate-report-html.ts が埋める）
└── docs/
    ├── design.md                         # 本ドキュメント
    ├── integration-design.md             # 統合方式の設計判断の記録
    └── roadmap/roadmap.md
```

### 技術スタック

| コンポーネント | 技術 | 役割 |
|-------------|------|------|
| ランタイム | Bun | TypeScript の直接実行 |
| ブラウザ自動化 | Playwright (Chromium) | ページ読み込み + 各検査の実行 |
| a11y テスト | @axe-core/playwright | WCAG 準拠の自動チェック |
| Excel 生成 | ExcelJS | .xlsx ファイル生成（色分け・フィルター付き） |
| 生成 AI 判定 | Claude（アクセシビリティツリー / WebFetch） | 機械検査で埋まらない項目の判定 |
| スプレッドシート | gog CLI | Google Sheets への結果書き込み |

### データフロー

SKILL.md のステップ番号との対応。工程ごとの入出力の詳細は how-it-works.md 第 1 章の表を参照。

```
URL入力
  │
  ├── [ステップ2]   a11y-test.ts             → data/{ラベル}/axe-result.json
  ├── [ステップ2.5] a11y-visual-test.ts      → data/{ラベル}/visual-result.json
  ├── [ステップ2.7] a11y-interactive-test.ts → data/{ラベル}/interactive-result.json
  ├── [ステップ2.9] a11y-tree.ts             → data/{ラベル}/a11y-tree.txt
  │
  ├── [ステップ5]   Claude 分析              → data/{ラベル}/claude-overrides.json
  │
  ├── [ステップ5.5] generate-checklist-xlsx.ts
  │                   → data/{ラベル}/merged-result.json（55項目の最終判定・唯一の正）
  │                   → report/a11y-checklist-{サイト名}-{日付}.xlsx
  │
  ├── [ステップ5.5b] generate-baseline-view.ts
  │                   → report/markdown/{ラベル}-baseline-17.md / data/{ラベル}/baseline-17.json
  │
  ├── [ステップ5.6] Google Sheets 書き込み（オプション）
  ├── [ステップ5.7] Markdown レポート生成（merged-result.json を表示形式に変換）
  ├── [ステップ5.9] report/ のインデックス生成（index.md / index.html / markdown/_index.md）
  └── [ステップ6]   完了通知
```

## 3. 主要コンポーネント詳細

### 3.1 a11y-test.ts（axe-core テスト実行）

**入力**: `<URL>`（必須）、`--tags`、`--exclude`（オプション）
**出力**: JSON（stdout）

```
1. Playwright で Chromium 起動（headless、scripts/lib/stable-browser.ts の共通設定）
2. ページ読み込み（stable-browser の決定的手順: load 待ち → networkidle best-effort →
   全ページスクロールで lazy-load 発火 → 先頭へ戻す → フォント待ち → アニメーション凍結CSS注入 →
   固定1秒待機）
3. AxeBuilder でテスト実行
   デフォルトタグ: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22a, wcag22aa
4. 結果を整形して JSON 出力
```

**出力 JSON 構造**:
```json
{
  "url": "https://example.com",
  "timestamp": "2026-02-27T04:03:00.000Z",
  "summary": { "violations": 3, "passes": 23, "incomplete": 3, "inapplicable": 40 },
  "violations": [{ "id": "color-contrast", "impact": "serious", "description": "...", "help": "...", "helpUrl": "...", "tags": ["wcag143"], "nodes": [...] }],
  "incomplete": [...],
  "passes": [{ "id": "html-lang-valid", "description": "...", "tags": ["wcag311"] }]
}
```

`violations` / `incomplete` は `nodes`（該当要素の HTML・セレクタ・失敗理由）を含むが、`passes` は含まない。

### 3.2 generate-checklist-xlsx.ts（結果統合 + Excel 生成）

**入力**:

| 引数 | 必須 | 内容 |
|------|------|------|
| `--json <path>` | 単一URLモードで必須 | axe-core 結果 JSON |
| `--visual-json <path>` | 任意 | Visual 検査結果 JSON |
| `--interactive-json <path>` | 任意 | Interactive 検査結果 JSON |
| `--overrides-json <path>` | 任意 | Claude 判定 JSON（`claude-overrides.json`） |
| `--manifest <path>` | 複数URLモードで必須 | URL ごとの入力ファイルを列挙したマニフェスト |
| `--output <path>` | 必須 | 出力先 .xlsx |

`--json` と `--manifest` は排他。複数URLモードでは URL ごとにシートを分け、サマリーシートを追加する。

**出力**: Excel（`--output`）。`merged-result.json`（axe-core JSON と同じディレクトリ）は `--manifest` モードのみ生成する（単一 URL モードは Excel のみ）。

**設計ポイント**

1. **WCAG 55項目をハードコード**: `WCAG_CRITERIA` 配列として定数定義。順序は `references/wcag-checklist.md` に準拠。各項目は照合用の `axeTags` と、axe-core のカバレッジを示す `axeCoverage`（`"full"` / `"partial"`）を持つ

2. **axe-core タグで照合**: ルールIDのマッピング表ではなく、axe-core が各ルールに持つ WCAG タグ（例: `wcag143` → 1.4.3）で violations / incomplete / passes を引き当てる

3. **判定と統合**: `evaluateCriterion()` が axe-core の土台を作り、`mergeResults()` が生成AI → Visual → Interactive の順で重ねる。証拠必須ガード（`sanitizeClaudeOverrides()`）・カバレッジガード（`axeCoverage`）・遷移ルール（`applyOverrideStatus()`）はすべてここで機械的に適用される。**ルールの詳細は [how-it-works.md](../../../docs/how-it-works.md) 第 2 章・第 3 章を正とする**

4. **`merged-result.json` が唯一の正**: Excel も Markdown レポートも、このファイルを表示形式に変換したもの。Claude が判定を組み立て直すことはない

5. **Excel フォーマット**:
   - メタ情報（対象URL / テスト日時 / 対象基準 / 使用したテストツール）と凡例をヘッダー行の前に出力
   - ヘッダー: 青背景(#2B579A)・白文字・太字
   - 結果セルの色分け: 緑(適合) / 赤(不適合) / 黄(要確認) / 灰(目視確認)
   - オートフィルター対応
   - 列: No. / カテゴリ / チェック項目 / 達成基準 / レベル / 確認内容 / 担当 / 結果 / 備考

6. **シート構成**: 「まとめ」→「基本17項目」→ 各ページの詳細シート。「基本17項目」は URL がいくつあっても 1 枚で、行は 17 項目固定・ページごとに列が増える（`populateBaselineSheet()`）。集約は `generate-baseline-view.ts` の `aggregate()` を import して使う。ロジックを複製しないことで、Excel と Markdown（`{ラベル}-baseline-17.md`）の結果が食い違う余地をなくしている

### 3.3 a11y-visual-test.ts（Visual 検査）

**入力**: `<URL>`（必須）
**出力**: JSON（stdout）

ページを読み込んだ状態の DOM・computed style・CDP のイベントリスナー情報だけで判定できる項目をチェックする。**すべて読み取り専用**で、viewport 変更やフォーカス操作は行わないため、後続チェックへの影響やリロードが不要。viewport 変更・キーボード操作を伴う検査は `a11y-interactive-test.ts` に分離してある。

**実装チェック一覧（15 チェック）**

| ID | 基準 | チェック名 | 手法 |
|-----|------|-----------|------|
| `target-size` | 2.5.8 | ターゲットサイズ（最小） | `getBoundingClientRect()` で 24x24px 未満の操作要素を検出 |
| `label-in-name` | 2.5.3 | 名前のラベル | 表示テキストが `aria-label` / `aria-labelledby` の accessible name に含まれるか |
| `non-text-contrast` | 1.4.11 | 非テキストコントラスト | ボタン/入力欄の `border-color` と `background-color` のコントラスト比を計算 |
| `heading-structure` | 1.3.1 | 見出し構造 | h1 の個数と h1-h6 の階層スキップを検出 |
| `aria-live` | 4.1.3 | ステータスメッセージ（aria-live） | `[aria-live]` / `role="status"` / `"alert"` / `"log"` の有無を検出 |
| `autoplay-media` | 1.4.2 | 音声の制御（自動再生） | `audio[autoplay]` / `video[autoplay]` を検出 |
| `char-key-shortcuts` | 2.1.4 | 文字キーのショートカット | `accesskey` 属性と document レベルのキーリスナーを検出 |
| `motion-actuation` | 2.5.4 | 動きによる起動 | `devicemotion` / `deviceorientation` リスナーを検出 |
| `dragging-movements` | 2.5.7 | ドラッグ操作 | `draggable` 属性と drag 系イベントリスナー（CDP）を検出 |
| `input-purpose` | 1.3.5 | 入力目的の特定 | フォーム要素の有無だけを判定（あれば warning） |
| `error-identification` | 3.3.1 | エラーの特定 | 同上 |
| `labels-or-instructions` | 3.3.2 | ラベル又は説明 | 同上 |
| `error-suggestion` | 3.3.3 | エラー修正の提案 | 同上 |
| `redundant-entry` | 3.3.7 | 冗長な入力 | 同上 |
| `accessible-authentication` | 3.3.8 | アクセシブル認証（最小） | `input[type=password]` の有無だけを判定（あれば warning） |

下 6 つのフォーム関連チェックは、該当コンテンツの**有無しか判定していない**。要素があれば内容の適切さは判定できないため warning（未確認）を返し、要素がなければ「該当コンテンツなし」として pass を返す。

`heading-structure` は 1.3.1 のうち見出し階層しか検証していないため、問題が見つからなくても pass を出さず warning に倒す（テーブル・リスト等の構造は未検証のまま合格にしない）。

**設計ポイント**
- 各チェック関数は `Page` を受け取り `CheckResult` を返す独立した関数
- 新規依存なし（Playwright は既存 package.json に含まれる）
- 「検証が浅いのに合格を出す」ことを避け、カバーしきれない基準では pass ではなく warning を返す（issue #10）

**出力 JSON 構造**:
```json
{
  "url": "https://example.com",
  "timestamp": "2026-02-27T04:03:00.000Z",
  "summary": { "pass": 5, "fail": 2, "warning": 8 },
  "checks": [
    { "id": "autoplay-media", "criterion": "1.4.2", "name": "音声の制御（自動再生）",
      "result": "pass", "details": "自動再生メディア要素なし", "elements": [] }
  ]
}
```

**統合時の扱い**: `pass` → 適合（表示: 確認OK、担当: 自動判定(Visual)）、`fail` → 不適合（表示: 修正あり）、`warning` → **判定を上書きしない**（下位の判定を維持し、`details` は統合結果に残らない）。詳細は how-it-works.md 第 3 章 (a)。

### 3.4 a11y-interactive-test.ts（Interactive 検査）

**入力**: `<URL>`（必須）、`--screenshot-dir <dir>`（オプション）
**出力**: JSON（stdout）＋スクリーンショット

キーボード送出・viewport 変更・ズームなど、**実際に操作しないと分からない**項目をチェックする。9 チェック。

| 基準 | チェック名 | 手法 |
|------|-----------|------|
| 2.4.7 | フォーカス可視化 | Tab を一度押してキーボードモダリティを確立した後、対象要素ごとに `element.focus()` でフォーカスし、前後の computed style 差分を確認（最大10要素） |
| 2.4.3 | フォーカス順序 | Tab は送出せず、DOM 順に並べたフォーカス可能要素の座標が逆行していないかを比較 |
| 2.1.2 | キーボードトラップ | Tab を繰り返し送出して `document.activeElement` の遷移を追跡し、循環の閉じ方でトラップを検出（Shift+Tab による逆方向は未検証） |
| 2.4.11 | フォーカス不明瞭化防止 | `fixed` / `sticky` 要素でフォーカス要素が隠れないか確認 |
| 1.4.10 | リフロー | viewport を 320x256px に変更し、横スクロールが発生しないか確認 |
| 1.3.4 | 表示の向き | portrait / landscape 両方でスクリーンショットを取得 |
| 1.4.4 | テキストサイズ変更 | 200% ズームでテキストの切れ・重なりを確認 |
| 3.2.1 | フォーカス時の挙動 | フォーカス前後で URL / DOM を比較し、予期しない変化を検出 |
| 3.2.2 | 入力時の挙動 | フォーム値を入力・変更し、URL / DOM を比較して自動送信等を検出 |

キーボードトラップは巡回率が閾値（`TRAP_COVERAGE_THRESHOLD = 0.5`）を下回ったまま終了した場合、pass を出さず warning に倒す。

**統合時の扱い**: Visual と同じ（`pass` → 適合、`fail` → 不適合、`warning` → 上書きしない）。統合順では Visual より優先される。

### 3.5 a11y-tree.ts（アクセシビリティツリー取得）

**入力**: `<URL>`（必須）、`--output <path>`
**出力**: `ariaSnapshot()` による YAML 形式のテキスト

`page.locator("body").ariaSnapshot()` で **JS 実行後のレンダリング済みツリー**を取得する。SPA でも正しくレンダリング後のツリーが取れるため、WebFetch（JS 実行前の静的 HTML）では判定できないケースをカバーする。生成 AI 判定（ステップ5）の第一入力になる。

### 3.6 生成 AI 判定（SKILL.md ステップ5）

スクリプト化せず、Claude 自身がページの内容を分析して判定し、`claude-overrides.json` を出力する。

**入力ソースの優先順位**

| 優先度 | ソース | 条件 |
|--------|--------|------|
| 1位 | `a11y-tree.txt`（アクセシビリティツリー） | ステップ2.9 が成功している場合 |
| 2位 | WebFetch（HTML 抽出） | `a11y-tree.txt` が空、またはステップ2.9 が失敗した場合 |

ツリーで直接判定できるのはリンクテキストの品質（2.4.4）・ランドマークの有無（2.4.1）・見出し階層（1.3.1）・フォーム要素の accessible name（1.3.1 / 4.1.2）など。lang 属性（3.1.1 / 3.1.2）、`<img>` の文字画像（1.4.5）、音声・映像要素（1.2.x）、時間制限（2.2.1）などツリーに現れない項目は WebFetch で補う。ツリー使用時は、この「ツリーに現れない項目」の分だけ WebFetch を追加実行する。

**証拠必須ガード**: pass / fail / not-applicable の判定には、ツリーまたは HTML 上の具体的な証拠（セレクタ・accessible name・属性値）を `evidence` に書くことが必須。空・欠落の場合は `sanitizeClaudeOverrides()` が warning（未確認）へ**機械的に降格**する。プロンプト頼みではなくコードで担保している。詳細は how-it-works.md 第 4 章。

**出力 JSON 構造**:
```json
{
  "overrides": [
    { "criterion": "2.4.4", "status": "pass",
      "details": "リンクテキストはすべて目的が判別できる",
      "evidence": "- link \"サービス紹介ページを見る\": /url: /service" }
  ]
}
```

`status` は `pass` / `fail` / `warning` / `not-applicable` の 4 値。`not-applicable`（該当コンテンツなし）は pass と同じく適合として扱われるため、pass と同様に証拠を要求する。

### 3.7 generate-baseline-view.ts（基本17項目ビュー）

**入力**: `--merged <merged-result.json>`、`--output <.md>`、`--output-json <.json>`

デジタル庁『ウェブアクセシビリティ導入ガイドブック』の基本 17 項目（重大4＋必須13）へ 55 項目の判定を集約する。

**集約ルール**: 対応する達成基準に 1 つでも不適合があれば「要修正」、不適合はないが要確認/目視確認が残れば「一部未確認」、すべて適合なら「確認OK」。**一部しか確認できていない項目を「確認OK」に丸めない**ことがこのスクリプトの設計上の約束。

判定対象外の達成基準（`OUT_OF_SCOPE`）は明示的に列挙する（2.4.10 は Level AAA のため対象外、4.1.1 は WCAG 2.2 で廃止）。「結果に無い」ことを対象外と解釈しない。

### 3.8 Google Sheets 連携（ステップ5.6）

**前提**: `gog` CLI がインストール・認証済み、対象ファイルが Google Sheets 形式（xlsx のままでは不可）

```
1. gog sheets metadata <ID>     → シート名・構造を取得
2. 対象シートのヘッダー行・データ範囲を確認
3. 各達成基準に結果をマッピング
4. gog sheets update <ID> '<範囲>' --values-json '[...]'  → 担当列・チェック欄を一括更新
```

**注意**: スプレッドシートの列構成はプロジェクトにより異なるため、書き込み前にヘッダー行を確認すること。手順の詳細は `references/google-sheets.md`。

> **未解決の不整合**: `references/google-sheets.md` の手順3は、`merged-result.json` ではなく axe-core の結果を直接マッピングする表（`passes` にマッチ → 確認OK）のままになっている。これは `merged-result.json` を唯一の正とする現在の設計、およびカバレッジガード（`axeCoverage: "partial"` の pass は適合にしない）と食い違う。この連携の是正は本ドキュメントの範囲外。

## 4. 結果ラベル体系

### 内部ステータス → 表示ラベル

`getDisplayLabel()` による変換。内部ステータスは 4 値、表示ラベルは 3 値。

| 内部ステータス | 表示ラベル（結果列） | 由来 |
|-------------|-------------------|--------|
| 適合 | 確認OK | 証拠つきの pass（Visual / Interactive / 生成AI）、または `axeCoverage: "full"` の基準での axe-core pass |
| 不適合 | 修正あり | axe-core の violations、または Visual / Interactive / 生成AI の fail |
| 要確認 | 未確認 | axe-core の incomplete、または `axeCoverage: "partial"` の基準での axe-core pass |
| 目視確認 | 未確認 | どの検査も判定に至らなかった |

「要確認」と「目視確認」は由来が違うだけで、**表示はどちらも「未確認」**。incomplete を「修正あり」と読ませない。

### 判定主体（担当列）

`CriterionResult.source` に入る値。

```
自動判定               → axe-core による機械的テスト結果
自動判定(Visual)       → a11y-visual-test.ts の判定
自動判定(Interactive)  → a11y-interactive-test.ts の判定
自動判定(Claude)       → Claude がアクセシビリティツリー / HTML を分析した判定
要目視確認             → 人間によるブラウザ操作での確認が必要
```

## 5. 出力ファイル

単一URL・複数URL 共通。ステップ1.5 で確認するレポート形式（`REPORT_FORMAT`: `markdown` / `excel` / `both`）に応じて、生成されないファイルがある。

```
{OUTPUT_DIR}/
├── report/                                          ← 確認・共有用
│   ├── index.md                                     ← 目次（リンク一覧のみ）
│   ├── index.html                                   ← HTML ビューア（サイドバー付き）
│   ├── markdown/
│   │   ├── _index.md                                ← 概要 + ページ別サマリー
│   │   ├── {ラベル}.md                               ← 統合レポート（ページごと）
│   │   └── {ラベル}-baseline-17.md                   ← 基本17項目ビュー
│   └── a11y-checklist-{サイト名}-{日付}.xlsx          ← Excel チェックシート
└── data/                                            ← 作業データ
    ├── manifest.json
    └── {ラベル}/
        ├── axe-result.json
        ├── visual-result.json
        ├── interactive-result.json
        ├── a11y-tree.txt
        ├── claude-overrides.json
        ├── merged-result.json                       ← 55項目の最終判定（唯一の正）
        ├── baseline-17.json
        └── screenshots/
```

`REPORT_FORMAT` が `markdown` の場合でも `merged-result.json` は必ず生成する（Markdown レポートが参照するため）。

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

1 つのルールが複数の WCAG タグを持つ場合（例: `link-name` は `wcag244` と `wcag412`）、該当するすべての基準に同じ結果が反映される。ただし pass の扱いだけは基準ごとの `axeCoverage` に従う。

## 7. 設計判断の記録

### なぜ結果を JSON 中間ファイル経由で扱うか

- 各検査は Playwright のブラウザ起動が必要で実行コストが高い
- JSON を保存しておくことで、再検査なしに Excel / Markdown を再生成できる
- `merged-result.json` を唯一の正とすることで、Excel と Markdown の結果が食い違わない

### なぜ WCAG 基準を TypeScript にハードコードするか

- `references/wcag-checklist.md` は Claude が参照する用（Markdown 形式）
- TypeScript スクリプトで正確にマッピングするには、構造化データとしてコード内に定義する方が確実
- 55項目は WCAG 2.2 で固定されており、頻繁な更新は不要

### なぜ生成 AI 判定をスクリプト化しないか

- HTML やアクセシビリティツリーの意味的分析は LLM の得意分野であり、ルールベースのスクリプト化は困難
- 「該当コンテンツなし」の判断や文脈依存の判定は生成 AI の柔軟性が必要
- 一方で判定の信頼性はガード側（証拠必須ガード）で担保し、証拠のない判定は最終結果に通さない

### なぜ統合はスクリプトで行うか

判定の決定性と、ガードのコードによる担保のため。検討した代替案（Claude が統合する方式）と却下理由は [integration-design.md](integration-design.md) に記録している。

### 結果ラベルの変更経緯

初期実装では技術的なラベル（適合/不適合/要確認/目視確認）をそのまま表示していたが、チェックシートの利用者（非技術者を含む）に分かりやすいよう表示ラベルを変更した。内部ステータスは 4 値のまま保持している。

```
適合     → 確認OK
不適合   → 修正あり
要確認   → 未確認
目視確認 → 未確認
```

## 8. 今後の展望

### 8.1 複数URL一括処理（実装済み）

URL のスペース区切り指定・CSV ファイル・JSON ファイルのいずれでも複数 URL を渡せる（拡張子で自動判定）。

```bash
/a11y-shiken https://example.com https://example.com/about
/a11y-shiken urls.csv
```

出力側は次のようになっている。

- Markdown レポート: URL ごとに `report/markdown/{ラベル}.md` を生成し、`_index.md` にページ別サマリーをまとめる
- Excel: `--manifest` で URL ごとにシートを分割し、サマリーシートを追加する
- Google Sheets: URL ごとに別シートに書き込む

**未実装の検討事項**

- 検査の並列実行（Playwright の同時起動数制限との兼ね合い）
- 共通ナビゲーション部分の重複検出（同一サイト内の共通ヘッダー/フッター）
- サイト全体のサマリーレポート（URL 横断の集計）
- 生成 AI 判定の効率化（共通部分は 1 回の分析で済ませる）

### 8.2 その他の検討事項

- **`--light` モード（未実装）**: 生成 AI 判定の出力を「結果ラベル + 1行サマリー」に絞り、API コストを削減する
- **差分レポート**: 前回検査結果との比較で改善/劣化を可視化する
- **CI/CD 統合**: GitHub Actions 等でのパイプライン組み込み
- 残っている限界の一覧は how-it-works.md の「既知の限界」を参照
