# 検証用ダミーサイト ground truth（ng 版 違反設計表）

ng 版（`ng/`）に意図的に仕込んだ WCAG 2.2 Level A + AA 違反の一覧。
精度実測では、この表を正解データとして検査結果と突き合わせる。
ok 版（`ok/`）は同一レイアウトのまま、下表のすべての箇所を適合実装にしている。

## 検出経路の凡例

| 表記 | 意味 |
|------|------|
| axe: `rule-id` | `a11y-test.ts`（axe-core、WCAG タグのみ）で該当ルールが violation として発火する |
| Visual: `checkXxx` | `a11y-visual-test.ts` の該当チェック関数で検出される |
| AI判定 | 生成 AI（Claude）による文脈判定の対象。自動ツールでは検出されない |
| 目視 | 人の操作・確認が必要 |

注意: axe-core は WCAG タグ（wcag2a / wcag2aa / wcag21a / wcag21aa / wcag22a / wcag22aa）のみで実行するため、
best-practice タグのルール（`region` / `landmark-one-main` / `heading-order` / `empty-heading` 等）は発火しない。
これらに相当する違反の検出経路は Visual / AI判定 / 目視として記載している。

## 違反一覧

### 共通（ng 全ページ）

| ID | SC | レベル | ページ | 箇所（セレクタ） | 仕込み内容 | 期待判定 | 検出経路 |
|----|----|--------|--------|------------------|-----------|----------|----------|
| NG-01 | 2.4.1 | A | 全ページ | `body` 直下の文書構造 | `header` / `nav` / `main` / `footer` を `div` に置換しランドマークなし。スキップリンクもなし | 不適合 | AI判定・目視（各ページに h1 があるため axe `bypass` は発火しない） |
| NG-02 | 2.4.7 | AA | 全ページ | `style.css` の `:focus` | `outline: none` でフォーカスインジケーターを消去 | 不適合 | 目視（キーボード操作で確認）。`a11y-interactive-test.ts` の 2.4.7 チェックは computed `outline` ショートハンド（`rgb(...) none 0px`）を文字列 `"none"` と比較する実装のため `outline: none` を検出できず pass 判定になる（2026-08-18 実測） |
| NG-03 | 4.1.2 | A | 全ページ | ヘッダー検索ボタン `.search-form button` | 虫眼鏡アイコンのみでアクセシブルネームなし | 不適合 | axe: `button-name` |
| NG-04 | 3.2.3 | AA | contact.html | `.site-nav` | ナビゲーションの順序・ラベルが他ページと異なる（「施設案内」→「ご案内」、並び順も変更） | 不適合 | AI判定・目視（3ページの比較が必要） |

### index.html（トップページ）

| ID | SC | レベル | ページ | 箇所（セレクタ） | 仕込み内容 | 期待判定 | 検出経路 |
|----|----|--------|--------|------------------|-----------|----------|----------|
| NG-05 | 3.1.1 | A | index.html | `html` | `lang` 属性なし | 不適合 | axe: `html-has-lang` |
| NG-06 | 1.3.1 | A | index.html | 見出し構造 | h1 の直後が h3（h2 をスキップ）。カード見出しは h4 | 不適合 | Visual: `checkHeadingStructure` |
| NG-07 | 1.1.1 | A | index.html | `.hero img` | `alt="画像"`（内容を説明しない代替テキスト） | 不適合 | AI判定（alt は存在するため axe `image-alt` は発火しない） |
| NG-08 | 1.4.3 | AA | index.html | お知らせの日付 `.news .date` | 文字色 `#aaaaaa`（白背景に約 2.3:1） | 不適合 | axe: `color-contrast` |
| NG-09 | 2.4.4 | A | index.html | お知らせ・利用案内のリンク | 「詳しくはこちら」「こちら」など行き先の分からないリンクテキスト（複数、行き先はそれぞれ異なる） | 不適合 | AI判定（axe の該当自動ルールなし） |
| NG-10 | 3.1.2 | AA | index.html | 英語キャッチコピー `.tagline .en` | 英語フレーズに `lang="en"` なし | 不適合 | AI判定・目視 |
| NG-11 | 2.5.8 | AA | index.html | SNS アイコンリンク `.sns-link` | ターゲットサイズ 18×18px（最小 24×24px 未満） | 不適合 | Visual: `checkTargetSize`（warning）。axe の `target-size` は周囲に隣接ターゲットがないため spacing exception で pass する |

### facility.html（施設案内）

| ID | SC | レベル | ページ | 箇所（セレクタ） | 仕込み内容 | 期待判定 | 検出経路 |
|----|----|--------|--------|------------------|-----------|----------|----------|
| NG-12 | 2.4.2 | A | facility.html | `head` | `title` 要素なし | 不適合 | axe: `document-title` |
| NG-13 | 1.1.1 | A | facility.html | `.gallery img`（3枚） | `alt` 属性なし | 不適合 | axe: `image-alt` |
| NG-14 | 1.3.1 | A | facility.html | 貸室一覧テーブル `.rooms-table` | `caption` / `th` なし（`td` + 装飾クラスで見た目だけ再現） | 不適合 | AI判定・目視（この形は axe では発火しない） |
| NG-15 | 2.4.6 | AA | facility.html | 減免案内の見出し | 「その他のご案内」— 内容（利用料金の減免）を説明しない見出し | 不適合 | AI判定 |

### contact.html（お問い合わせ）

| ID | SC | レベル | ページ | 箇所（セレクタ） | 仕込み内容 | 期待判定 | 検出経路 |
|----|----|--------|--------|------------------|-----------|----------|----------|
| NG-16 | 2.4.2 | A | contact.html | `title` | 「ページ」という内容を説明しないタイトル（存在はするため axe は発火しない） | 不適合 | AI判定 |
| NG-17 | 3.3.2 | A | contact.html | 電話番号入力欄 `#tel` | 「電話番号」のテキストは隣接表示されているが `label` 要素で関連付けられていない（`placeholder` もなし。placeholder があると accessible name になり axe が発火しないため） | 不適合 | axe: `label` |
| NG-18 | 1.3.5 | AA | contact.html | 氏名・メール入力欄 | `autocomplete` 属性なし | 不適合 | AI判定・目視（Visual の 1.3.5 チェックは「フォームあり」の汎用 warning のみで欠落自体は特定しない。axe `autocomplete-valid` は値が不正な場合のみ発火） |
| NG-19 | 1.4.1 | A | contact.html | 必須項目の表示 | 「赤字の項目は必須です」— 色のみで必須を伝える（赤は `#b30000` でコントラスト自体は 4.5:1 以上を確保し、1.4.3 と混ざらないようにしている） | 不適合 | AI判定・目視 |
| NG-20 | 1.4.11 | AA | contact.html | 入力欄の枠線 | `border: #dddddd`（白背景に約 1.4:1、3:1 未満） | 不適合 | Visual: `checkNonTextContrast` |
| NG-21 | 2.5.3 | A | contact.html | 送信ボタン | 表示テキスト「送信する」に対し `aria-label="フォーム"`（ラベルが name に含まれない） | 不適合 | Visual: `checkLabelInName` |
| NG-22 | 1.4.4 | AA | contact.html | `meta[name=viewport]` | `maximum-scale=1, user-scalable=no` で拡大禁止 | 不適合 | axe: `meta-viewport` |
| NG-23 | 4.1.2 | A | contact.html | 同意チェック `.fake-checkbox` | `div` 自作チェックボックス。role / name / state なし、キーボード操作不可 | 不適合 | AI判定・目視 |

## 1つの欠陥が複数 SC にまたがるケース

精度実測の突き合わせで「表にない SC の指摘」を誤検出と即断しないための注記。

- **NG-17（label なし入力欄）**: 主たる SC は 3.3.2 だが、ラベル欠如は 1.3.1（情報及び関係性）・4.1.2（name の欠如）としても指摘されうる。axe の `label` ルール自体が wcag131 / wcag412 タグを持つ
- **NG-23（div 自作チェックボックス）**: 主たる SC は 4.1.2 だが、キーボード操作不可のため 2.1.1（キーボード）としても指摘されうる
- **NG-01（ランドマークなし）**: 主たる SC は 2.4.1 だが、文書構造の欠如として 1.3.1 で指摘されうる
- **NG-19（色のみの必須表示）**: 必須であることが label に含まれないため 3.3.2 の説明不足として指摘されうる

## ok 版との対応

ok 版は ng 版と同一のページ構成・レイアウトのまま、上記すべての箇所を適合実装にしている。
主な対応: ランドマーク + スキップリンク / フォーカスリング維持 / 検索ボタンに視覚ラベル /
`lang="ja"` + 英語フレーズに `lang="en"` / h1→h2→h3 の正しい階層 / 内容を説明する alt・見出し・リンクテキスト /
コントラスト 4.5:1 以上（枠線 3:1 以上）/ ターゲット 24px 以上 / `caption` + `th scope` 付きテーブル /
全入力欄に `label` + `autocomplete` / 「（必須）」のテキスト表記 / ネイティブ `checkbox` + `label` /
ページごとに固有の `title` / 3ページで一貫したナビゲーション。

**期待結果**: ok 版は axe violations 0 件、Visual テストの fail / 具体指摘 0 件（実測済み）。
なお Visual テストの 1.3.5 / 3.3.1 / 3.3.2 / 3.3.3 / 3.3.7 は「フォーム要素が存在するページでは常に目視確認を促す warning を出す」設計のため、
ヘッダーに検索フォームを持つ本サイトでは ok 版でもこの汎用 warning は出る（違反検出ではない）。

## 実測結果（2026-08-18）

axe-core（`@axe-core/playwright`、WCAG タグのみ）をローカル配信した全ページに対して実行した結果:

| ページ | axe violations |
|--------|----------------|
| ok/ 全3ページ | 0 件 |
| ng/index.html | `html-has-lang`、`color-contrast`×3、`button-name` |
| ng/facility.html | `document-title`、`image-alt`×3、`button-name` |
| ng/contact.html | `label`、`meta-viewport`、`button-name` |

Visual テスト（`a11y-visual-test.ts`）では ng 版で `checkHeadingStructure`（h1→h3 スキップ）、`checkTargetSize`（`.sns-link` 18×18px）、
`checkLabelInName`（送信ボタン）、`checkNonTextContrast`（フォーム枠線 1.36:1）が検出されることを確認済み。

## SC カバレッジ

仕込み済み: 19 SC / 23 箇所

| 原則 | SC |
|------|-----|
| 1. 知覚可能 | 1.1.1, 1.3.1, 1.3.5, 1.4.1, 1.4.3, 1.4.4, 1.4.11 |
| 2. 操作可能 | 2.4.1, 2.4.2, 2.4.4, 2.4.6, 2.4.7, 2.5.3, 2.5.8 |
| 3. 理解可能 | 3.1.1, 3.1.2, 3.2.3, 3.3.2 |
| 4. 堅牢 | 4.1.2 |

生成 AI 判定の主対象（2.4.4 リンクテキスト品質 / 4.1.2 accessible name / 1.3.1 見出し階層 / 2.4.1 ランドマーク / 3.1.1・3.1.2 lang）をすべて含む。
静的 HTML では自然に再現できない項目（時間依存メディア 1.2.x、タイミング 2.2.x、動的ステータス 4.1.3 等）は対象外とした。
