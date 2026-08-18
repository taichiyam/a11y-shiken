# レポート出力設計ドキュメント

最終的なレポートの構成・ファイル設計に関する設計方針。

---

## 1. 出力ディレクトリ構成

### テスト実行後の全体構成

```
docs/a11y-test/{yyyymmddhhmmss}_{ドメイン名}/
├── report/                              ← 確認用（クライアント・チームに渡すファイル）
│   ├── index.md                        ← 目次 + 全ページ横断サマリー
│   ├── markdown/
│   │   ├── TOP.md
│   │   ├── CAR-LINEUP.md
│   │   └── ...（ページごと）
│   └── a11y-checklist-{ドメイン}-{日付}.xlsx
└── data/                                ← 作業データ（テスト結果・中間ファイル）
    ├── {ラベル}/                        ← ページごとのサブディレクトリ
    │   ├── axe-result.json
    │   ├── visual-result.json
    │   ├── interactive-result.json
    │   ├── claude-overrides.json
    │   └── screenshots/
    └── manifest.json
```

> **注意**: 旧形式のMarkdown中間ファイル（レポート①・レポート③）は生成しない。
> - `a11y-report-{ドメイン}-{日付}.md`（旧レポート①）→ 廃止
> - `a11y-checklist-claude-{ドメイン}-{日付}.md`（旧レポート③）→ 廃止
> - 統合レポートとして `report/markdown/{ラベル}.md` に直接生成する

### 使い分け

| ディレクトリ | 用途 | 対象者 |
|------------|------|--------|
| `report/` | 確認・共有用の最終成果物 | クライアント・開発チーム |
| `data/` | テスト実行時の作業データ・中間ファイル | 担当者のみ |

---

## 2. report/markdown/ の構成

### index.md（目次 + 横断サマリー）

```markdown
# アクセシビリティテスト レポート

## テスト概要
| 対象サイト | テスト日時 | 対象基準 |
...

## ページ別サマリー
| ページ | 修正あり | 未確認 | 確認OK |
|--------|---------|--------|--------|
| TOP    | 9件     | 23件   | 24件   |
| ...    |         |        |        |

## サイト共通の問題
複数ページで共通して検出された問題をここにまとめる。
例: aria-hidden-focus（全ページ共通）、color-contrast（全ページ共通）

## ページ一覧
- [TOP](./TOP.md)
- [CAR LINEUP一覧](./CAR-LINEUP.md)
- ...
```

### 各ページ .md（統合レポート）

フォーマットは以下の順で構成する:

1. **ページ概要**（URL・テスト日時）
2. **サマリー**（修正あり/確認OK/未確認 件数）
3. **チェック項目**（56項目を1つのテーブルに統合）
4. **修正が必要な項目の詳細**（axe-coreのHTMLスニペット・コントラスト比・修正方法）
5. **対応優先度まとめ**

---

## 3. 統合レポートのフォーマット設計

### チェック項目テーブルの方針

- セクション分け（知覚可能/操作可能/理解可能/堅牢）は **しない**
- 56項目を1つのテーブルにまとめる
- `カテゴリ` 列（例: `1.4 判別可能`）でWCAGの分類が分かる

### 詳細セクションの方針

- チェック項目テーブルを先に全出力してから、詳細をまとめて記載する
- 「修正あり」の項目のみ詳細を展開（確認OK・未確認は備考欄の情報で十分）
- 見出しに `No.X — 基準名 + 判定ソース` を付けてテーブルと対応させる

### 判定ソースの表記

| 判定ソース | 表記 |
|-----------|------|
| axe-core | `自動判定` |
| Playwright Visual | `自動判定(Visual)` |
| Playwright Interactive | `自動判定(Interactive)` |
| Claude HTML分析 | `自動判定(Claude)` |
| 人手確認が必要 | `要目視確認` |

---

## 4. ブラウザでの閲覧

### 推奨: Docsify

`report/markdown/` ディレクトリに `index.html` を1枚追加するだけで、ローカルサーバーでmarkdownをサイトとして閲覧できる。

```html
<!-- report/markdown/index.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>アクセシビリティテスト レポート</title>
  <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify/themes/vue.css">
</head>
<body>
  <div id="app"></div>
  <script>
    window.$docsify = { name: 'A11y Report', loadSidebar: true }
  </script>
  <script src="//cdn.jsdelivr.net/npm/docsify/lib/docsify.min.js"></script>
</body>
</html>
```

起動:
```bash
npx serve report/markdown
# または
python3 -m http.server 3000 -d report/markdown
```

### 用途別推奨ツール

| 用途 | ツール |
|------|-------|
| 自分で確認 | VS Code（Cmd+Shift+V）または Obsidian |
| チーム内共有 | Docsify（ローカル）または GitHub |
| クライアント共有 | MkDocs + GitHub Pages |

---

## 5. レポートファイルの命名規則

### 確認用ファイル（report/）

```
report/index.md
report/markdown/{ページラベル}.md          ← ページ名をそのまま使用
report/a11y-checklist-{ドメイン}-{日付}.xlsx
```

### 作業データファイル（data/）

```
data/{ラベル}/axe-result.json
data/{ラベル}/visual-result.json
data/{ラベル}/interactive-result.json
data/{ラベル}/claude-overrides.json
data/{ラベル}/screenshots/
data/manifest.json
```

---

## 6. 変更履歴

- **2026-03-04**: 初版作成（統合レポート設計・ディレクトリ構成の方針策定）
- **2026-03-04**: レポート①③（旧Markdown中間ファイル）を廃止。統合レポートを `report/markdown/{ラベル}.md` に直接生成する方針に変更
