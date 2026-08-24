---
name: a11y-shiken
description: axe-core + Playwrightでウェブサイトのアクセシビリティテストを実行し、WCAG 2.2 Level AA準拠のチェックレポートを生成する。自動テスト結果に加え、ClaudeによるHTML分析で目視確認項目も可能な限り判定。Markdown・Excel(.xlsx)チェックシートを出力。/a11y-shiken で呼び出す。「アクセシビリティテストして」「a11yチェック」「WCAGチェック」「アクセシビリティレポート作って」などのリクエスト時に使用。Do NOT use for パフォーマンステストやSEOチェック。
---

# アクセシビリティテスト

axe-core + Playwright を使ってウェブサイトのアクセシビリティを自動テストし、WCAG 2.2 Level AA 準拠の統合レポートを生成するスキル。

> **パス解決**: 本ドキュメント内の `<skill_dir>` は、Claude Code がスキルロード時に提供する "Base directory for this skill:" の値に置き換えて実行すること。

- **自動チェック**: axe-core で機械的に検出可能な項目はテスト結果をそのまま反映
- **🤖 Claude検証**: axe-coreで検出できない目視確認項目について、ClaudeがHTMLソースを分析して可能な限り判定
- **目視確認チェックシート**: Claude検証でも判定できない項目（ブラウザ操作が必要なもの）をチェックリストとして出力

## 結果の決定性（実行ごとのブレ防止）

同じURLに対して実行するたびに結果が変わらないよう、以下の対策を実装している:

- **スクリプト側**（`scripts/lib/stable-browser.ts` に集約。全テストスクリプトが共通利用）:
  - 決定的な読み込み手順: `load` 待ち → networkidle（best-effort 10秒）→ 全ページスクロールで lazy-load 発火 → 先頭へ戻す → Web フォントロード待ち → アニメーション凍結CSS注入 → 固定1秒待機
  - `prefers-reduced-motion: reduce` + アニメーション/トランジションの duration を 0s に固定（カルーセル・フェード途中の状態を計測してしまうブレを排除）
  - タイムゾーン・デバイススケール・配色（light）をコンテキストで固定
- **Claude 分析側**（ステップ5）: 後述の「判定の決定性ルール」に従う。証拠がなければ warning に倒す

それでも対象サイト自体が実行ごとに違うコンテンツを返す場合（ランダム表示のバナー・A/Bテスト・広告等）は結果が変わりうる。レポートに差分が出た場合はまずその可能性を疑い、`--exclude` で該当要素を除外することを検討する。

## 前提環境

| ツール | 必須 | 備考 |
|--------|------|------|
| **bun** | ✅ 必須（導入済み前提） | [bun.sh/docs/installation](https://bun.sh/docs/installation) |
| **Playwright Chromium** | ✅ 必須 | 初回実行時に自動インストール |
| **Node.js** | ❌ 不要 | bun に内包 |

**動作確認済み環境**: macOS 14+（Sonoma / Sequoia）、Ubuntu 22.04+

> **bun が導入済みであれば、他の依存関係は初回実行時に自動セットアップされる。**

## 引数

$ARGUMENTS

URLを指定する。複数URLをスペース区切りで指定可能。

| 引数 | 説明 | 例 |
|------|------|-----|
| `<URL>` | テスト対象URL（スペース区切りで複数指定可） | `https://example.com` |
| `<CSVファイルパス>` | URLをCSVファイルから読み込む（.csv拡張子で自動判定） | `urls.csv` |
| `<JSONファイルパス>` | URLをJSONファイルから読み込む（.json拡張子で自動判定） | `urls.json` |
| `--setup` | 環境セットアップのみ実行して終了 | `--setup` |

## ワークフロー

### ステップ0: 環境チェック（自動）

ユーザーに意識させずに依存関係を自動解決する。以下を順番にチェックし、問題があれば対処する。
`--setup` のみが指定された場合はステップ0完了後に終了する。

**① bun の確認**

```bash
bun --version
```

- 成功 → 次へ
- 失敗（command not found）→ 以下を表示して **処理を中断**:

```
❌ bun が見つかりません。
bun の導入については[bun.sh/docs/installation](https://bun.sh/docs/installation)してください。
インストール後、ターミナルを再起動してから再度お試しください。
```

**② node_modules の確認**

`<skill_dir>/scripts/node_modules/exceljs` が存在するか確認する。

- 存在する → 次へ
- 存在しない → ユーザーへの断りなく自動インストール（初回のみ数秒かかる旨を一言添える）:

```bash
cd <skill_dir>/scripts && bun install
```

**③ Playwright Chromium の確認・インストール**

`bunx playwright install chromium` は冪等（インストール済みなら何もしない）なため、チェックなしで毎回実行する。`node` コマンド非依存でどの環境でも確実に動作する。

```bash
cd <skill_dir>/scripts && bunx playwright install chromium
```

インストール先: `~/Library/Caches/ms-playwright/`（Mac）/ `~/.cache/ms-playwright/`（Linux）

3つすべて通過したらステップ0.5へ進む。

### ステップ0.5: 出力ディレクトリの作成

カレントディレクトリの `docs/a11y-test/` 配下に `yyyymmddhhmmss_{ドメイン名}` 形式のディレクトリを作成する。レポート・一時ファイル・スクリーンショットはすべてこのディレクトリに出力する。

ドメイン名はURLから `www.` を除去し、`.` を `-` に置換して導出する（例: `example.com` → `example-com`）。複数URLの場合は最初のURLのドメインを使用する。

```bash
OUTPUT_DIR="docs/a11y-test/$(date +%Y%m%d%H%M%S)_example-com"
mkdir -p "$OUTPUT_DIR/report/markdown"
mkdir -p "$OUTPUT_DIR/data"
```

以降のステップでは `{OUTPUT_DIR}` をこのパスとして参照する。

**複数URL の場合**: 各URLごとに `data/` 配下にサブディレクトリを作成する。サブディレクトリ名はラベル（指定がなければURLから自動導出）を使用する。

```bash
# 例: 2つのURLの場合
mkdir -p "$OUTPUT_DIR/data/TOP"
mkdir -p "$OUTPUT_DIR/data/お問い合わせ"
```

### ステップ1: テスト対象の確認

$ARGUMENTS を解析する。`--setup` のみの場合はステップ0完了後に終了済みのため、ここには到達しない。

以下の3つの入力方法をサポートする。

**方法1: スペース区切り（既存互換）**
```
/a11y-shiken https://example.com https://example.com/contact
```
ラベルなし。URLのドメイン/パスからラベルを自動導出する。

**方法2: CSVファイル指定**
```
/a11y-shiken urls.csv
```
CSVフォーマット（ヘッダーなし）:
- 1列（URLのみ）: `https://example.com` → ラベル自動導出
- 2列（ラベル,URL）: `TOP,https://example.com`

1列目が `http://` または `https://` で始まる場合はラベルなしとして扱う。

**方法3: JSONファイル指定**
```
/a11y-shiken urls.json
```
JSONフォーマット:
- 文字列配列: `["https://example.com", "https://example.com/contact"]` → ラベル自動導出
- オブジェクト配列: `[{"label":"TOP","url":"https://example.com"}, {"label":"お問い合わせ","url":"https://example.com/contact"}]`

**ラベル自動導出ルール:**
1. `www.` を除去したドメイン名 + パス
2. パスが `/` のみの場合はドメイン名のみ
3. パスが長い場合は最後のセグメントのみ使用
4. 例: `https://www.example.com/contact` → `example.com/contact`
5. 例: `https://example.com/` → `example.com`

**URLが未指定の場合** → AskUserQuestion ツールでURLを確認する:
```
question: "テスト対象のURLを入力してください（複数の場合はスペース区切り、またはCSV/JSONファイルパスを指定）"
```

**単一URL の場合** → 複数URLと同じくサブディレクトリを作成する（ラベルを自動導出）。出力構成を統一することで、index.md / index.html / _index.md も常に生成する。

### ステップ1.5: レポート形式の確認

AskUserQuestion ツールで出力するレポート形式を質問する:

```
question: "出力するレポート形式を選択してください"
options: [
  "Excel（.xlsx）のみ — ディレクター・PM向け。一覧表で全体の対応状況を把握",
  "Markdownレポートのみ — 開発者向け。修正箇所の詳細・コードスニペット付き",
  "両方（デフォルト）— Excel + Markdown"
]
```

選択結果を以降のステップで参照する（変数名: `REPORT_FORMAT`）:
- Excel → `excel`
- Markdown → `markdown`
- 両方 → `both`

### ステップ2: 自動テスト実行

以下のコマンドでaxe-coreによる自動テストを実行する:

```bash
cd <skill_dir> && bun scripts/a11y-test.ts <URL>
```

オプション:
- `--tags wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22a,wcag22aa` （デフォルト: WCAG 2.2 Level A + AA）
- `--exclude <CSSセレクタ>` （特定要素を除外する場合）

結果はJSON形式でstdoutに出力される。

各URLに対して順次実行する。各URLのテスト結果JSONは `{OUTPUT_DIR}/data/{ラベル}/axe-result.json` に保存する。

### ステップ2.5: Visual テスト実行（Playwright 目視確認自動化）

axe-core では検出できないが、Playwright のブラウザ操作で自動判定可能な項目をチェックする:

```bash
cd <skill_dir> && bun scripts/a11y-visual-test.ts <URL>
```

結果はJSON形式でstdoutに出力される（15チェック: target-size, label-in-name, non-text-contrast, heading-structure, aria-live, autoplay-media, char-key-shortcuts, motion-actuation, dragging-movements, input-purpose, error-identification, labels-or-instructions, error-suggestion, redundant-entry, accessible-authentication）。

> **pass を出さないチェック**: non-text-contrast（境界線のみ検証）/ heading-structure（1.3.1 のうち見出し階層のみ検証）/ aria-live（属性の存在しか検証できない）は、検査範囲が達成基準の一部にとどまるため、問題未検出でも pass を出さず warning（要目視確認）を返す。また char-key-shortcuts / motion-actuation / dragging-movements は、CDP によるイベントリスナー検査に失敗した場合は pass を出さず warning を返す。

> **対象要素の有無しか見ないチェック**: input-purpose(1.3.5) / error-identification(3.3.1) / labels-or-instructions(3.3.2) / error-suggestion(3.3.3) / redundant-entry(3.3.7) はフォーム要素の有無、accessible-authentication(3.3.8) は `input[type="password"]` の有無だけを判定する。**該当要素が無ければ「該当コンテンツなし」で pass、有れば必ず warning** を返す（fail は返さない）。フォーム送信・バリデーション発火は行わないため、エラー表示や修正提案の実在は検証していない。

> reflow, orientation, focus-visible, keyboard-trap, focus-order, text-resize, focus-not-obscured の7チェックはステップ2.7の Interactive テストに統合済み。

**結果ラベル**: pass → 確認OK（自動判定(Visual)）、fail → 修正あり（自動判定(Visual)）、warning → 未確認(要確認)（要目視確認）

各URLに対して順次実行する。各URLのテスト結果JSONは `{OUTPUT_DIR}/data/{ラベル}/visual-result.json` に保存する。

### ステップ2.7: Interactive テスト実行（Playwright インタラクティブ検証）

Playwright の headless Chromium を使って、キーボード操作・フォーカス挙動など動的な確認が必要な項目を自動テストする:

```bash
cd <skill_dir> && bun scripts/a11y-interactive-test.ts <URL>
```

**検証項目（9チェック）:**

1. **フォーカス可視化（2.4.7）**: フォーカス可能要素に順にフォーカスし、フォーカス前後の computed style 差分（outline / box-shadow / 背景色・枠線色の変化）でインジケータの有無を判定。常時付与されている装飾用 box-shadow 等は差分に現れないため誤カウントしない。インジケータの欠如（outline: none 等）は fail として検出するが、スタイル変化が存在しても実際の視認性（コントラスト・太さ）は自動検証できないため pass は出さず warning（要目視確認）とする
2. **フォーカス順序（2.4.3）**: Tab は送出せず、DOM順に並べたフォーカス可能要素の座標（top/left）が逆行していないかを比較する。逆行率0で pass、0.2以上で fail、その間は warning。正の tabindex が存在する場合は warning
3. **キーボードトラップ（2.1.2）**: 最初の要素にフォーカス後、Tab を繰り返し送出して `document.activeElement` の遷移を追跡する（Shift+Tab による逆方向は未検証）。同一要素に3回連続で留まる／訪問カバレッジ0.5未満で循環が閉じる／最大反復まで循環が閉じない場合に fail
4. **フォーカス不明瞭化防止（2.4.11）**: fixed/sticky要素によってフォーカス要素が隠れないかスクリーンショットで確認。fixed/sticky要素が存在しない場合のみ pass、存在する場合は全スクロール位置を検証できないため隠れ未検出でも warning とする
5. **リフロー（1.4.10）**: ビューポートを320x256pxに変更し、横スクロールバーが発生しないか確認
6. **表示の向き（1.3.4）**: portrait(375x667)/landscape(667x375)両方でスクリーンショットを取得する。**撮影のみで画像比較・崩れ検出は行わないため、pass も fail も返さず常に warning（要目視確認）**
7. **テキストサイズ変更（1.4.4）**: `body` に `zoom: 2.0` を当ててスクリーンショットを取得し、`overflow: hidden` かつ `scrollHeight > clientHeight` の要素があれば fail（縦方向のテキスト切れ）。重なり・横方向のはみ出し・可読性は自動検証できないため pass は出さず warning
8. **フォーカス時の挙動（3.2.1）**: フォーカス前後でURLとDOMスナップショット（innerHTMLハッシュ + 可視要素数）を比較。メインフレームのナビゲーションも監視するため、同一URLへの reload / replace もページ遷移として fail 検出。DOM変化は warning、変化なしを確認できた場合のみ pass
9. **入力時の挙動（3.2.2）**: フォームフィールド（テキスト系 input 全種 + number / textarea / select / checkbox / radio）の値を入力・変更し、前後のURLとDOMスナップショットを比較。同一URLへの再読み込みを含むページ遷移（自動送信・select の onchange 遷移等）は fail、DOM変化は warning、変化なしを確認できた場合のみ pass。自動操作に未対応の入力タイプ（date / range / file 等）が残る場合は pass を出さず warning

結果はJSON形式でstdoutに出力される。スクリーンショットは `{OUTPUT_DIR}/data/{ラベル}/screenshots/` に保存する（`--screenshot-dir {OUTPUT_DIR}/data/{ラベル}/screenshots` を指定）。

**結果ラベル**: pass → 確認OK（自動判定(Interactive)）、fail → 修正あり（自動判定(Interactive)）、warning → 未確認(要確認)

各URLに対して順次実行する。各URLのテスト結果JSONは `{OUTPUT_DIR}/data/{ラベル}/interactive-result.json` に保存する。

### ステップ2.9: アクセシビリティツリー取得

Playwright の `page.locator("body").ariaSnapshot()` を使って、**JS実行後のレンダリング済みアクセシビリティツリー**を取得する。agent-browser の `snapshot` コマンドと同等の YAML 形式の出力を既存の Playwright 環境で実現する。

```bash
cd <skill_dir> && bun scripts/a11y-tree.ts <URL> \
  --output {OUTPUT_DIR}/data/{ラベル}/a11y-tree.txt
```

**SPA サイトでの優位性**: `scripts/lib/stable-browser.ts` の決定的な読み込み手順（load 待ち → networkidle best-effort → 全ページスクロール → フォント待ち）で JS 実行後を待機するため、React/Vue 等の SPA でも正しくレンダリングされた後のツリーを取得できる。WebFetch では JS 実行前の静的 HTML しか取れないケースをカバー。

**出力例:**（`ariaSnapshot()` は YAML 形式で、role と accessible name を `- role "name":` の形で出力する。`aria-label` は解決済みの値になる）
```
# アクセシビリティツリー
URL: https://example.com
取得日時: 2026-03-05T...

- link "本文へスキップ":
  - /url: "#main"
- banner:
  - navigation "グローバルナビ":
    - list:
      - listitem:
        - link "ホーム":
          - /url: ./
- main:
  - heading "サービス紹介" [level=1]
  - link "詳細を見る":
    - /url: /service
- contentinfo
```

保存先: `{OUTPUT_DIR}/data/{ラベル}/a11y-tree.txt`

取得に失敗した場合（タイムアウト等）はスキップし、ステップ5 で WebFetch にフォールバックする。

### ステップ3: 結果分析

JSON結果を解析し、以下の情報を整理する:

1. **violations（違反）** を影響度順にソート: critical > serious > moderate > minor
2. **incomplete（要確認）** を整理
3. **passes（パス）** の件数を集計
4. `references/wcag-checklist.md` を参照し、目視確認が必要な項目を特定する

### ステップ4: 結果分析（完了）

ステップ3 で整理した情報はステップ5 の統合レポート生成で直接参照する。このステップでは中間Markdownファイルは生成しない。

### ステップ5: Claude 分析・統合レポート生成

axe-coreで「未確認」となった項目について、ステップ2.9で取得したアクセシビリティツリーを優先的に使用し、Claudeが分析して判定する。

各URLに対して分析を行い、結果を `{OUTPUT_DIR}/data/{ラベル}/claude-overrides.json` に保存する。

**入力ソースの優先順位:**

| 優先度 | ソース | 条件 |
|--------|--------|------|
| 1位 | `a11y-tree.txt`（アクセシビリティツリー） | ステップ2.9 が成功している場合 |
| 2位 | WebFetch（HTML抽出） | a11y-tree.txt が空またはステップ2.9 が失敗した場合 |

**手順:**

1. `{OUTPUT_DIR}/data/{ラベル}/a11y-tree.txt` が存在し空でない場合 → **ツリーを使用**:
   - ツリーテキスト全体を読み込む（HTML全文より大幅に小さいため入力トークン節約）
   - ツリーから直接確認できる項目はツリーで判定する

   a11y-tree.txt が存在しない / 空の場合 → **WebFetch にフォールバック**:
   - WebFetch で対象URLのページ内容を取得する（1回）
   - 取得した HTML から以下のセクション・タグのみを抽出して分析する:
     - `<head>` 全体（lang 属性・meta 等の確認用）
     - `<nav>`, `<header>`, `<footer>`（ランドマーク・スキップリンク確認用）
     - `<main>` の先頭部分（見出し構造・ランドマーク確認用、200 行程度）
     - すべての `<form>`, `<audio>`, `<video>` タグ
     - すべての `<a>` タグ（最大 50 件、リンクテキスト品質確認用）

2. 以下の観点で分析する（ツリー／HTML どちらを使う場合も同じ観点）:

   **ツリーで直接判定できる項目（a11y-tree.txt 使用時に精度向上）:**
   > ツリーは `ariaSnapshot()` の YAML 形式で、各行は `- role "accessible name"` の形をとる（例: `- link "本文へスキップ":`、`- banner:`、`- textbox "お名前（必須）"`）。末尾のコロンは子要素がある場合だけ付く。**判定・evidence には必ずツリーに実在するこの表記を使い、`[banner]` のような独自表記を書かない。**

   - リンクテキストの品質（2.4.4）: `- link "..."` の引用符内（accessible name。`aria-label` は解決済みの値）を直接確認
   - ランドマーク要素の有無（2.4.1）: `- banner` / `- main` / `- navigation` / `- contentinfo` で始まる行の存在（名前付きの場合は `- navigation "グローバルナビ":`）
   - 見出し階層の品質（1.3.1）: `- heading "..." [level=N]` の `[level=N]` を出現順に確認
   - aria-hidden による誤った隠蔽（4.1.2）: ツリーから要素が欠落しているかで検出
   - フォーム要素の accessible name（1.3.1 / 4.1.2）: `- textbox "お名前（必須）"` のように、role に続く引用符内が accessible name。引用符が無い（`- textbox`）＝名前なし

   **ツリーに現れないため WebFetch / HTML で判定する項目:**
   - lang 属性の設定（3.1.1 / 3.1.2）: `<head>` の lang 属性
   - 画像の文字画像使用（1.4.5）: `<img>` タグと alt 属性
   - 音声・映像要素の有無と代替テキスト（1.2.x）: `<audio>` `<video>` タグ
   - CSS アニメーションの一時停止手段（2.2.2）
   - ホバー/フォーカスで表示されるコンテンツの有無（1.4.13）
   - 時間制限付きコンテンツの有無（2.2.1）
   - スキップリンクの有無（2.4.1）: `<a>` タグのリンク先確認

   ツリー使用時は上記「ツリーに現れない項目」のみ WebFetch を追加で実行する（WebFetch の呼び出し回数を最小化）。

3. 各項目を以下の基準で判定:
   - 問題を検出 → **修正あり**（担当: 自動判定(Claude)、備考に具体的な問題内容を記載）
   - 問題なし or 該当コンテンツなし → **確認OK**（担当: 自動判定(Claude)）
   - ブラウザ操作が必要で判定不可 → **未確認**（担当: 要目視確認）

4. **判定の決定性ルール（実行ごとのブレ防止のため厳守）:**
   - **pass / fail / not-applicable の判定は、ツリー or HTML 上に具体的な証拠（要素・属性・値）を引用できる場合のみ**行う。その証拠（該当要素のセレクタ・accessible name・属性値等）を必ず `evidence` フィールドに記載する
   - **`evidence` が空・欠落の pass / fail / not-applicable は、統合スクリプトが機械的に `warning`（未確認）へ強制降格する**（降格はログと備考に記録される）。プロンプト頼みではなくコードで担保されているため、証拠なし判定は最終結果に反映されない
   - 証拠を引用できない・確信が持てない・「おそらく」で判断しそうになった場合は、**必ず `warning`（未確認・要目視確認）に倒す**。印象や推測で pass / fail を出さない
   - 「問題の可能性がある」程度の所見は fail にせず、warning + details に懸念点を記載する
   - 同一の入力（同じ a11y-tree.txt / HTML）に対しては同一の判定結果になることを意識する。判定に迷った履歴がある項目は warning に固定する

### ステップ5.5: Excel + merged-result.json 生成（統合版）

すべてのチェック（axe-core、Visual テスト、Interactive テスト、Claude HTML分析）完了後に、全結果を統合した Excel チェックシートと `merged-result.json`（Single Source of Truth）を生成する。

**このステップは `REPORT_FORMAT` の値にかかわらず必ず実行する。** `generate-checklist-xlsx.ts` は `--output` が必須で Excel ファイルを常に書き出すため、`REPORT_FORMAT` が `markdown` の場合も `.xlsx` ファイル自体は生成される（`merged-result.json` の生成に必要な副産物として扱い、最終報告で案内しないだけ）。Excel の生成を抑止するフラグは現時点で存在しない。

**Claude オーバーライド JSON のフォーマット:**
ステップ5のClaude分析結果は以下のJSON形式で保存する:
- `criterion`: WCAG達成基準番号（例: "1.2.1"）
- `status`: "pass"（確認OK）/ "fail"（修正あり）/ "not-applicable"（該当なし→確認OK扱い）/ "warning"（判定不可、目視確認のまま）
- `details`: 判定理由や問題内容
- `evidence`: **pass / fail / not-applicable では必須。** ツリー or HTML から引用した具体的な証拠（該当要素のセレクタ・accessible name・属性値・「ツリー全体に video/audio 要素なし」等）。空・欠落の場合、スクリプトが該当判定を warning に強制降格する

```json
{"overrides":[
  {"criterion":"1.2.1","status":"not-applicable","details":"該当コンテンツなし","evidence":"a11y-tree 全体に audio/video 要素が存在しない"},
  {"criterion":"1.3.2","status":"pass","details":"DOM順序が論理的","evidence":"main 内の heading が h1→h2→h3 の順で出現"}
]}
```

マニフェストJSON を `{OUTPUT_DIR}/data/manifest.json` に保存する（単一URL・複数URLともに同じ形式）:

**重要: パスは manifest.json からの相対パスで記述すること。** スクリプト側で manifest.json の場所を基準に自動解決するため、絶対パスへの書き換えは不要。

```json
{
  "testDate": "{ISO日時}",
  "entries": [
    {
      "label": "TOP",
      "url": "https://example.com",
      "axeJson": "TOP/axe-result.json",
      "visualJson": "TOP/visual-result.json",
      "interactiveJson": "TOP/interactive-result.json",
      "overridesJson": "TOP/claude-overrides.json"
    },
    {
      "label": "お問い合わせ",
      "url": "https://example.com/contact",
      "axeJson": "お問い合わせ/axe-result.json",
      "visualJson": "お問い合わせ/visual-result.json",
      "interactiveJson": "お問い合わせ/interactive-result.json",
      "overridesJson": "お問い合わせ/claude-overrides.json"
    }
  ]
}
```

Excel + merged-result.json を生成（マニフェストモード）:

```bash
cd <skill_dir> && bun scripts/generate-checklist-xlsx.ts \
  --manifest {OUTPUT_DIR}/data/manifest.json \
  --output {OUTPUT_DIR}/report/a11y-checklist-{サイト名}-{YYYY-MM-DD}.xlsx
```

**出力される Excel の構造:**
- シート1「まとめ」: 全URLのサマリー表（ラベル / URL / 確認OK / 修正あり / 未確認の件数、各詳細シートへのハイパーリンク）
- シート2「基本17項目」: デジタル庁『ウェブアクセシビリティ導入ガイドブック』の基本17項目への集約（後述）
- シート3以降: 各URL/ラベルごとの詳細チェックシート（55項目フォーマット）
- シート名 = ラベル（Excelの31文字制限に自動で切り詰め、重複時は `(2)` 等のサフィックスを追加）

**「基本17項目」シート:**
URL がいくつあっても **1 枚だけ**生成し、行は 17 項目で固定、ページごとに列が増える。横方向に読むことで「どのページでも直っていない共通問題」と「特定ページだけの問題」を見分けられる。単一URLのときは状態に加えて内訳列（`5基準中 確認 3 / 不適合 1 / 未確認 1`）も出力する。

集約は `generate-baseline-view.ts` の `aggregate()` をそのまま使うため、ステップ5.5b で生成する `{ラベル}-baseline-17.md` と必ず同じ結果になる。**一部しか確認できていない項目を「確認OK」に丸めない**ルール（ステップ5.5b 参照）もそのまま適用される。

レガシーの単一URLモード（`--json`）でも同じシートを生成する（シート構成は「基本17項目」→「チェックシート」の 2 枚）。

**merged-result.json の出力:**
スクリプトは Excel と同時に、各エントリごとに `{OUTPUT_DIR}/data/{ラベル}/merged-result.json` を自動生成する。このファイルは全テスト結果（axe-core・Visual・Interactive・Claude判定）を統合した55項目の最終判定結果を含み、ステップ5.7のMarkdownレポート生成で Single Source of Truth として使用される。

**結果統合の優先順位（スクリプト内で決定的に適用）:**
Interactive テスト結果 > Visual テスト結果 > Claude判定 > axe-core

**重要な統合ルール（スクリプトに実装済み）:**
- warning は上書きしない（下位の pass/fail 結果を維持）
- `not-applicable` は `pass`（確認OK）として扱う
- axe-coreの1ルールが複数WCAG基準にマッピングされる場合、すべての基準に反映
- violations が1つでもあれば passes より優先
- **axe-core カバレッジガード**: 55項目の定義が持つ `axeCoverage` が `partial`（axe-core のルール群が達成基準の一部しか検証していない）の項目では、`passes` に一致しても「適合」にせず「要確認（未確認）」に倒し、備考に「axe-core は達成基準の一部のみ検証（{ルール名}）」と記録する。**現時点で `full` は0件（55項目すべて `partial`）＝ axe-core の pass だけを根拠に「確認OK」になる項目は存在しない**。`violations`（不適合）・`incomplete`（要確認）の扱いは変わらず、Visual / Interactive / Claude が証拠つきで pass を出した場合は「適合」になる（その場合、カバレッジ降格の説明は備考から取り除かれる）
- **証拠必須ガード**: `evidence` が空・欠落の Claude 判定（pass / fail / not-applicable）は warning に強制降格し、降格をログと備考に記録する
- **遷移ルール（安全側への遷移は自由、危険側への遷移は制限）**:
  - 任意 → 不適合 の上書きは無条件で許可
  - **「適合」への上書きは、上書き元の判定に証拠がある場合のみ許可**（Claude は `evidence`、Visual / Interactive は `details` が証拠）。証拠が空・空白のみ・欠落なら上書きを却下し、元の判定（不適合／未確認）を維持して却下の経緯を備考に残す
  - 不適合 → 適合 を試みた項目は、上書きの成否を問わず `merged-result.json` に `conflict: true` を立て、備考に「⚠️ 判定矛盾」の経緯を必ず残す（Excel の備考列にも同じ内容が出力される）。未確認からの上書き却下は矛盾ではないため `conflict` は立てない

担当列には判定ソース（自動判定/自動判定(Visual)/自動判定(Interactive)/自動判定(Claude)/要目視確認）を表示する。

### ステップ5.5b: 基本17項目ビュー生成（デジタル庁ガイドブック）

`merged-result.json` から、デジタル庁『ウェブアクセシビリティ導入ガイドブック』の**基本17項目（重大4＋必須13）**への集約ビューを生成する。

```bash
cd <skill_dir> && bun scripts/generate-baseline-view.ts \
  --merged {OUTPUT_DIR}/data/{ラベル}/merged-result.json \
  --output {OUTPUT_DIR}/report/markdown/{ラベル}-baseline-17.md \
  --output-json {OUTPUT_DIR}/data/{ラベル}/baseline-17.json
```

**なぜこれを出すか:** WCAG 2.2 の55項目を渡されても「何から手をつけるか」が判断できない。
デジタル庁が示す17項目は「まずここ」を公的な根拠で示せる入口になる。

**集約ルール（スクリプトに実装済み。絶対に変更しないこと）:**

| 条件 | 状態 |
|---|---|
| 対応する達成基準に1つでも「不適合」がある | ❌ **要修正** |
| 不適合はないが「要確認」「目視確認」が残っている | ⚠️ **一部未確認** |
| 対応する達成基準がすべて「適合」 | ✅ **確認OK** |
| 対応する達成基準がすべて A+AA の範囲外 | — 判定対象外 |

> ⚠️ **一部しか確認できていない項目を「確認OK」に丸めてはならない。**
> 例: 「キーボードだけで全機能にアクセスできる」は 2.1.1 / 2.4.3 / 2.4.7 / 3.2.1 / 3.2.2 の5基準に対応する。
> 3基準が適合でも、2基準が目視未確認なら **⚠️ 一部未確認** と表示する。
> ここを丸めると「間違った合格」を生む。このツールが最も避けるべき出力である。

**判定対象外になる達成基準（正当な理由がある）:**
- `2.4.10 セクション見出し` — Level AAA のため A+AA の対象外
- `4.1.1 構文解析` — WCAG 2.2 で廃止

詳細は `references/digital-agency-baseline.md` を参照。

### ステップ5.6: Google Sheets 書き込み（スプレッドシートURL指定時）

ユーザーが Google Sheets の URL を指定している場合、`gog` CLI で対象シートのチェック欄・担当列に結果を書き込む。`gog` コマンドがインストール済みで認証済みであることが前提。

詳細な手順は `references/google-sheets.md` を参照。

### ステップ5.7: Markdownレポート生成（merged-result.json ベース）

**注意:** `REPORT_FORMAT` が `excel` の場合、このステップはスキップする。`markdown` または `both` の場合に実行する。

ステップ5.5で生成された `{OUTPUT_DIR}/data/{ラベル}/merged-result.json` を読み込み、Markdownレポートを生成する。**Claudeが独自に結果統合を行うのではなく、merged-result.json の内容をそのまま反映する**ことで、Excel と Markdown の結果が必ず一致する。

**手順:**

1. `{OUTPUT_DIR}/data/{ラベル}/merged-result.json` を Read ツールで読み込む
2. JSON の `summary` からサマリー件数を取得
3. JSON の `items` 配列から55項目のチェックテーブルを生成
4. `displayLabel` が「修正あり」の項目のみ詳細セクションを展開（axe-core の violations HTML スニペットや Claude 判定の根拠を `notes` から引用）
5. `conflict: true` の項目は、備考の「⚠️ 判定矛盾」の記載をそのまま残す（要約・削除で消さない）。矛盾項目が1件以上ある場合は、サマリーの直後に「⚠️ 判定矛盾のあった項目」として No.・達成基準・経緯を列挙する

**保存先:** `{OUTPUT_DIR}/report/markdown/{ラベル}.md`

**統合レポートのフォーマット** (`references/report-output-design.md` 参照):

```markdown
# ページ: {ラベル}

| 項目 | 値 |
|------|-----|
| 対象URL | {URL} |
| テスト日時 | {日時} |
| 対象基準 | WCAG 2.2 Level AA |
| テストツール | axe-core + Playwright（自動判定）、Claude 分析（自動判定(Claude)） |

> **凡例**
> - **自動判定**: axe-core による自動テスト結果
> - **自動判定(Visual)**: Playwright Visual テスト結果
> - **自動判定(Interactive)**: Playwright Interactive テスト結果
> - **自動判定(Claude)**: アクセシビリティツリー（またはHTML）を分析して判定した結果
> - **要目視確認**: ブラウザ操作が必要なため、人による目視確認が必要

## サマリー

{merged-result.json の summary をそのまま使用}

| カテゴリ | 件数 |
|---------|------|
| 🔴 修正あり | {summary.fail}件 |
| ✅ 確認OK | {summary.pass}件 |
| ⚠️ 未確認 | {summary.unknown}件 |

---

## チェック項目

{merged-result.json の items 配列をそのままテーブルに変換}

| No. | カテゴリ | チェック項目 | レベル | 確認内容 | 担当 | 結果 | 備考 |
|-----|---------|------------|--------|---------|------|------|------|
| {item.no} | {item.category} | {item.criterion} {item.name} | {item.level} | {item.description} | {item.source} | {item.displayLabel} | {item.notes} |

---

## 修正が必要な項目の詳細

{displayLabel が「修正あり」の項目のみ詳細を展開}

### No.{item.no} — {item.criterion} {item.name} ({item.source})

{item.notes の内容を展開。axe-core violations の場合は HTMLスニペット・コントラスト比等を記載。Claude判定の場合は根拠・推奨対応を記載}

---

## 対応優先度まとめ

| 優先度 | No. | 項目 | 影響度 | 推奨対応 |
|--------|-----|------|--------|---------|
| 🔴 高 | {no} | ... | serious | ... |
```

### ステップ5.9: report/ のインデックスファイル生成

**注意:** `REPORT_FORMAT` が `excel` の場合、このステップはスキップする（Markdownレポートが存在しないため）。

全ページの統合レポート生成完了後に、以下の3ファイルを生成する（単一URL・複数URLともに生成する）。

#### ① markdown/_index.md（概要 + ページ別サマリー）

テスト概要・ページ別サマリー・サイト共通の問題を `{OUTPUT_DIR}/report/markdown/_index.md` に生成する。

**サマリー件数は各ページの `merged-result.json` の `summary` から取得する（独自に集計しない）。**

```markdown
# アクセシビリティテスト レポート

## テスト概要

| 対象サイト | テスト日時 | 対象基準 |
|-----------|-----------|---------|
| {ドメイン} | {日時} | WCAG 2.2 Level AA |

## ページ別サマリー

| ページ | 修正あり | 未確認 | 確認OK |
|--------|---------|--------|--------|
| [{ラベル}](./{ラベル}.md) | {summary.fail}件 | {summary.unknown}件 | {summary.pass}件 |
| ...    |         |        |        |

## サイト共通の問題

{複数ページで共通して検出された問題をまとめる}
例: aria-hidden-focus（全ページ共通）、color-contrast（複数ページ）
```

#### ② report/index.md（目次のみ）

ページ一覧のリンクのみを `{OUTPUT_DIR}/report/index.md` に生成する。

```markdown
# アクセシビリティテスト レポート

- [概要・サマリー](./markdown/_index.md)
- [{ラベル}](./markdown/{ラベル}.md)
- ...

> HTML版: [index.html](./index.html) を開くとサイドバー付きで閲覧できます。
```

#### ③ report/index.html（HTML ビューア）

`generate-report-html.ts` で生成する。**テンプレートを手作業でコピー・置換してはならない**（プレースホルダーの置換位置を誤ると HTML の構文が壊れ、画面が真っ白になる）。

```bash
cd <skill_dir> && bun scripts/generate-report-html.ts \
  --report-dir {OUTPUT_DIR}/report \
  --page "概要・サマリー=./markdown/_index.md" \
  --page "TOP=./markdown/TOP.md" \
  --page "会社概要=./markdown/会社概要.md"
```

`--page` は「ラベル=report ディレクトリからの相対パス」の形式で、ページ数ぶん繰り返す。ページ数が多い場合は `--pages-json '[{"label":"TOP","file":"./markdown/TOP.md"}]'` でまとめて渡せる。ステップ5.5b で生成した `{ラベル}-baseline-17.md` も 1 ページとして含める。

スクリプトは Markdown 本文と marked.js / DOMPurify の本体をすべて HTML に埋め込むため、**生成された index.html はローカルサーバーなしで開ける単一ファイル**になる。ラベルや本文は `JSON.stringify` 相当のエスケープを通したうえで埋め込まれるため、`</script>` を含むコードスニペットがレポートにあっても壊れない。

**閲覧方法**: `index.html` をブラウザで開く（ダブルクリック、または `open {OUTPUT_DIR}/report/index.html`）。左サイドバーに全ページが表示され、クリックで各 Markdown レポートが右ペインにレンダリングされる。本文中の相対 `.md` リンクもページ切替として動作する。オフラインでも表示できる。

### ステップ6: 完了通知

全ファイルの生成が完了したら、ユーザーに以下のディレクトリ構成と通知を行う。ステップ1.5 で選択された `REPORT_FORMAT`（`excel` / `markdown` / `both`）に応じて、生成されなかったファイルはディレクトリ構成から省略する。

| `REPORT_FORMAT` | 最終報告で案内しないもの |
|---|---|
| `excel` | `markdown/{ラベル}.md`（ステップ5.7 をスキップ）、`markdown/_index.md`・`index.md`・`index.html`（ステップ5.9 をスキップ） |
| `markdown` | `a11y-checklist-*.xlsx`（ファイル自体はステップ5.5 で常に生成される。`generate-checklist-xlsx.ts` は `--output` 必須のため。報告で案内しないだけ） |
| `both` | なし |

#### 生成されるファイル構成（単一URL・複数URL 共通）

```
{OUTPUT_DIR}/
├── report/                                               ← 確認・共有用
│   ├── index.md                                         ← 目次（リンク一覧のみ）
│   ├── index.html                                       ← HTMLビューア（サイドバー付き）
│   ├── markdown/
│   │   ├── _index.md                                    ← 概要 + ページ別サマリー
│   │   ├── {ラベル}.md                                   ← 統合レポート（ページごと）
│   │   ├── {ラベル}-baseline-17.md                       ← 基本17項目ビュー（デジタル庁）
│   │   └── ...
│   └── a11y-checklist-{サイト名}-{YYYY-MM-DD}.xlsx       ← Excel チェックシート
└── data/                                                 ← 作業データ
    ├── manifest.json
    ├── {ラベル}/
    │   ├── axe-result.json                              ← ステップ2（axe-core）
    │   ├── visual-result.json                           ← ステップ2.5（Visual）
    │   ├── interactive-result.json                      ← ステップ2.7（Interactive）
    │   ├── a11y-tree.txt                                ← ステップ2.9（アクセシビリティツリー）
    │   ├── claude-overrides.json                        ← ステップ5（Claude 判定）
    │   ├── merged-result.json                           ← ステップ5.5（55項目の最終判定 / Single Source of Truth）
    │   ├── baseline-17.json                             ← ステップ5.5b（基本17項目への集約結果）
    │   └── screenshots/
    └── ...
```

> `merged-result.json` は `REPORT_FORMAT` に関わらず必ず生成される（Markdownレポート・基本17項目ビューの入力となるため）。
> `{ラベル}-baseline-17.md` は `REPORT_FORMAT` が `excel` の場合も `report/markdown/` に生成される。

保存後、ユーザーに以下を通知する:
- 出力ディレクトリのパス
- 保存ファイル一覧
- 各URLの違反件数サマリー
- 特に対応が必要な critical/serious の違反があれば強調
- Claude検証で新たに検出された問題の件数

あわせて、生成した成果物を **SendUserFile で送る**（パスをテキストで書くだけではクリックで開けないため）:
- `report/index.html`（`REPORT_FORMAT` が `markdown` / `both` の場合）— 単一ファイルなのでクリックだけで開ける
- `report/a11y-checklist-*.xlsx`（`REPORT_FORMAT` が `excel` / `both` の場合）は `display: "attach"` で送る

`index.html` はローカルサーバーなしで開けるため、`npx serve` 等のコマンドを案内する必要はない。ターミナルから開きたい場合の `open {OUTPUT_DIR}/report/index.html` だけ添えれば足りる。

## 将来の改善オプション

### --light モード（未実装）

`--light` フラグを追加することで Claude API コストをさらに削減できる:
- Claude 分析の出力を「結果ラベル + 1行サマリーのみ」に変更（詳細な根拠記述を省略）
- Markdown レポートの「修正が必要な項目の詳細」セクションをスキップ
- 追加で出力トークン ▼40〜60% の削減が見込まれる
- 実装コスト: SKILL.md のワークフロー分岐追加のみ


## エラーハンドリング

### URLにアクセスできない場合
```
❌ エラー: 指定されたURL ({URL}) にアクセスできません。
  - URLが正しいか確認してください
  - サイトが稼働中か確認してください
  - 認証が必要なページの場合、ログイン状態でのテストには対応していません
```

### Playwrightのブラウザが見つからない場合
```
❌ エラー: Chromium がインストールされていません。
以下のコマンドでインストールしてください:
  cd <skill_dir>/scripts && bunx playwright install chromium
```

### タイムアウトの場合
ページ読み込みが30秒以内に完了しない場合、タイムアウトエラーを表示する。
`--timeout` オプションの追加を提案する。

## トラブルシューティング

### axe-coreの結果が0件
- SPAの場合、ページの描画が完了する前にテストが実行された可能性がある
- 全スクリプトは `scripts/lib/stable-browser.ts` の決定的な読み込み手順（`load` 待ち → networkidle best-effort → 全ページスクロール → フォント待ち → 固定1秒待機）で待機しているが、描画完了までさらに時間がかかる動的コンテンツの場合は追加の待機が必要な場合がある

### 実行するたびに結果が変わる
- スクリプト・Claude 分析側の対策は「結果の決定性（実行ごとのブレ防止）」セクションを参照
- それでも変わる場合、サイト側がリクエストごとに違うコンテンツを返している可能性が高い（ランダムバナー・A/Bテスト・広告・おすすめ枠等）。`--exclude` で該当要素を除外してテストする

### 特定の要素を除外したい
`--exclude` オプションでCSSセレクタを指定:
```bash
bun scripts/a11y-test.ts https://example.com --exclude ".third-party-widget,.ad-banner"
```
