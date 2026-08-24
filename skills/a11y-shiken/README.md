# a11y-shiken（スキル本体のドキュメント）

WCAG 2.2 Level AA 準拠のアクセシビリティチェックスキルです。

## 何ができるか

URLを渡すだけで、WCAG 2.2 Level AA 全55項目のアクセシビリティチェックを自動実行します。
結果は **Excel チェックシート** と **Markdown レポート**（HTMLビューア付き）で出力されるので、クライアントへの報告やチーム内の共有にそのまま活用できます。

**こんなときに便利:**
- 納品前のアクセシビリティチェックを短時間で済ませたい
- チェック漏れを防ぎたい（手動だと55項目を網羅するのが大変）
- 修正箇所をHTMLスニペット付きで開発者に共有したい

## ハンズオン・サンプル

> **初めての方はこちらから！** 同梱のダミーサイトをローカル配信すれば、外部サイトに触らず試せます。

- [検証用ダミーサイト](../../examples/site/) — ok / ng の2バージョン × 3ページ
- [サンプル出力](../../examples/site-report/) — 上記を検査した実測結果・実行手順・サンプルCSV

## 使い方

Claude Code で `/a11y-shiken` に続けてURLを渡します。実行すると、レポート形式（Excel / Markdown / 両方）を選択でき、テスト完了後に `docs/a11y-test/` 配下にレポートが出力されます。

**URLを直接指定:**

```
/a11y-shiken https://example.com
/a11y-shiken https://example.com https://example.com/contact
```

**CSVファイルで指定（ページラベル付き）:**

```
/a11y-shiken urls.csv
```

CSVは「ラベル,URL」の形式です（ヘッダー行なし）。ラベルを省略してURLだけの行もOKです。

```csv
TOP,https://example.com
お問い合わせ,https://example.com/contact
ニュース,https://example.com/news/123
```

<details>
<summary>JSONファイルでも指定できます</summary>

```
/a11y-shiken urls.json
```

```json
[
  {"label": "TOP", "url": "https://example.com"},
  {"label": "お問い合わせ", "url": "https://example.com/contact"}
]
```

URLの配列（`["https://example.com", ...]`）でも指定できます。

</details>

**特定要素をテスト対象から除外したい場合:**

```
/a11y-shiken https://example.com --exclude ".ad-banner,.third-party-widget"
```

## 出力ファイル

```
docs/a11y-test/{yyyymmddhhmmss}_{ドメイン名}/
├── report/                              ← クライアント・チームに渡すファイル
│   ├── index.md                        ← 目次（リンク一覧のみ）
│   ├── index.html                      ← HTMLビューア（サイドバー付き）
│   ├── markdown/
│   │   ├── _index.md                   ← 概要 + ページ別サマリー
│   │   └── {ページラベル}.md            ← 統合レポート（ページごと）
│   └── a11y-checklist-{ドメイン}-{日付}.xlsx
└── data/                                ← テスト結果JSON・スクリーンショット等の作業データ
```

### 統合レポートの構成

各ページの Markdown レポートには以下が含まれます:

1. ページ概要（URL・テスト日時）
2. サマリー（修正あり / 確認OK / 未確認の件数）
3. チェック項目（55項目を1テーブルに統合）
4. 修正が必要な項目の詳細（HTMLスニペット・推奨対応付き）
5. 対応優先度まとめ

### レポートの読み方

#### 結果ラベル

| 結果 | 意味 |
|------|------|
| ✅ 確認OK | 基準に適合、または該当コンテンツなし |
| 🔴 修正あり | 問題を検出。対応が必要です |
| ⚠️ 未確認 | 自動判定できないため、人による目視確認が必要です |

#### 担当列の見方

| 担当 | 内容 |
|------|------|
| 自動判定 | axe-core による自動テスト |
| 自動判定(Visual) | Playwright による視覚的検証（ターゲットサイズ、見出し構造など） |
| 自動判定(Interactive) | Playwright によるキーボード操作検証（フォーカス移動、リフローなど） |
| 自動判定(Claude) | Claude による HTML / アクセシビリティツリー分析 |
| 要目視確認 | ブラウザでの人手による確認が必要 |

---

## 技術詳細

ここから先は開発者・メンテナ向けの情報です。

### 自動判定の仕組み

4段階の自動判定 + 目視確認で、チェック工数を大幅に削減する。

| 段階 | 判定主体 | 対象 | カバー項目数 |
|------|---------|------|------------|
| 1. 自動判定（axe-core） | axe-core | DOM構造の静的解析 | 9項目 |
| 2. 自動判定（Visual） | Playwright | 視覚的・構造的検証 | 15項目 |
| 3. 自動判定（Interactive） | Playwright | インタラクティブ検証 | 9項目 |
| 4. Claude判定 | Claude HTML分析 | HTMLソースから判定可能な項目 | 追加5項目（※） |
| 5. 目視確認 | 人間 | ブラウザ操作が必要な項目 | 残り26項目 |

**自動判定カバレッジ**: 全55項目中29項目（**52.7%**）を自動判定可能

※ Claude は18項目以上を分析可能だが、axe-core/Visual/Interactive と重複する項目を除いた純増分が5項目

### セットアップ

スキル実行時に依存関係は自動チェック・インストールされるため、手動セットアップは通常不要。

```bash
cd skills/a11y-shiken/scripts
bun install
bunx playwright install chromium
```

### 技術スタック

- **Bun** — TypeScript 実行ランタイム
- **Playwright** — ブラウザ自動化（Chromium headless）
- **@axe-core/playwright** — WCAG 自動テストエンジン
- **ExcelJS** — Excel ファイル生成

### ファイル構成

```
a11y-shiken/
├── SKILL.md                          # スキル定義
├── README.md                         # 本ファイル
├── scripts/                          # スキル用 - 実行可能コード
│   ├── package.json                  # 依存パッケージ
│   ├── a11y-test.ts                  # axe-core テスト実行
│   ├── a11y-visual-test.ts           # Visual テスト実行
│   ├── a11y-interactive-test.ts      # Interactive テスト実行
│   ├── a11y-tree.ts                  # アクセシビリティツリー取得
│   ├── generate-checklist-xlsx.ts    # Excel 生成
│   ├── tsconfig.json                 # 型チェック設定（bunx tsc で実行）
│   └── lib/
│       └── stable-browser.ts         # 共通ブラウザセットアップ（結果の決定性担保）
├── references/                       # スキル用 - 参照ドキュメント
│   ├── wcag-checklist.md             # WCAG 2.2 A+AA 全基準リスト
│   ├── index-html-template.html      # HTMLビューアテンプレート
│   ├── report-output-design.md       # レポート出力設計
│   └── google-sheets.md             # Google Sheets 連携手順
└── docs/                             # 人間用 - 設計・チュートリアル等
    ├── design.md                     # 全体設計
    ├── integration-design.md         # 結果統合の設計
    │   └── sample-report/            # サンプルレポート一式
    └── roadmap/
        └── roadmap.md                # ロードマップ
```

### 設計ドキュメント

- [references/report-output-design.md](references/report-output-design.md) — レポート出力設計（ディレクトリ構成・フォーマット方針）
- [docs/design.md](docs/design.md) — 全体設計
- [docs/integration-design.md](docs/integration-design.md) — 結果統合の設計

### 将来機能（ロードマップ）

→ [roadmap/roadmap.md](docs/roadmap/roadmap.md)

主な項目:
- WCAGレベルプリセット（`--preset wcag21-aa` 等）
- 成果物の選択出力フラグ（`--no-claude-analysis` 等）
- Google Sheets 連携（`gog` CLI による結果書き込み。実装済み・正式公開前）
- Lighthouse / html-validate / Pa11y 統合
- Claude Vision による視覚的判定

### 更新履歴

#### 2026-08-13
- 結果の決定性改善: `scripts/lib/stable-browser.ts` を新設し、全テストスクリプトを共通の決定的な読み込み手順（lazy-load 発火・フォント待ち・アニメーション凍結）に統一。同一URLへの再実行で結果が変わるブレを解消
- Claude 分析の判定決定性ルールを SKILL.md に明文化（証拠引用必須・迷ったら warning）
- ドキュメント整合性修正: Visual テストのチェック数（17→15）、リンク切れ等

#### 2026-03-09
- HTMLビューア追加: `report/index.html` でサイドバー付きレポート閲覧に対応（marked.js + DOMPurify）
- 出力構成を統一: 単一URL・複数URLで同じディレクトリ構成（`data/{ラベル}/`）に統一
- サンプル追加: `examples/` にサンプルCSV・サンプルレポート・手順を追加
- index.md / _index.md 分離: 目次（index.md）と概要・サマリー（markdown/_index.md）を分離

#### 2026-03-04
- 出力ディレクトリ構造を刷新: `report/`（確認用）と `data/`（作業データ）に分離
- 統合レポート形式に変更: `report/markdown/{ラベル}.md` に統合レポートとして直接生成
- ロードマップ追加: `roadmap/` ディレクトリに将来機能を文書化

#### 2026-02-27
- Interactive テスト追加: Playwright によるインタラクティブ検証を実装（9項目）
- 自動判定カバレッジ向上: 52.7%（29/55項目）を自動判定可能に
