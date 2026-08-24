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
またタグ指定実行では axe-core の既定 `tagExclude`（`experimental` / `deprecated`）が効くため、WCAG タグを持っていても
`td-has-header` / `table-fake-caption` / `label-content-name-mismatch` / `css-orientation-lock` / `audio-caption` は実行されない。
これらに相当する違反の検出経路は Visual / AI判定 / 目視として記載している。

さらに、axe-core のルールが持つ WCAG タグと「その違反が人間にとってどの SC の問題か」は一致しないことがある。
本表の「検出経路」に `axe: {ルール名}` と書くのは、**そのルールが実際に violation として発火し、かつ当該 SC のタグを持つ**場合に限る
（例: axe `label` は `wcag412` タグのみのため、3.3.2 の行では `axe: label` と書かない）。

## 違反一覧

### 共通（ng 全ページ）

| ID | SC | レベル | ページ | 箇所（セレクタ） | 仕込み内容 | 期待判定 | 検出経路 |
|----|----|--------|--------|------------------|-----------|----------|----------|
| NG-01 | 2.4.1 | A | 全ページ | `body` 直下の文書構造 | `header` / `nav` / `main` / `footer` を `div` に置換しランドマークなし。スキップリンクもなし | 不適合 | AI判定・目視（各ページに h1 があるため axe `bypass` は発火しない） |
| NG-02 | 2.4.7 | AA | 全ページ | `style.css` の `:focus` | `outline: none` でフォーカスインジケーターを消去 | 不適合 | Interactive: `testFocusVisible`（fail。ng 全5ページで実測済み）。旧実装は computed `outline` ショートハンド（`rgb(...) none 0px`）を文字列 `"none"` と比較していたため検出できなかったが、issue #10 でフォーカス前後の computed style 差分（outline / box-shadow / 背景色・枠線色の変化）による判定に修正済み（常時付与の装飾 box-shadow では誤カウントしない） |
| NG-03 | 4.1.2 | A | 全ページ | ヘッダー検索ボタン `.search-form button` | 虫眼鏡アイコンのみでアクセシブルネームなし | 不適合 | axe: `button-name` |
| NG-04 | 3.2.3 | AA | contact.html | `.site-nav` | ナビゲーションの順序・ラベルが他ページと異なる（「施設案内」→「ご案内」、「お知らせ」→「新着情報」、「ギャラリー」→「写真」、並び順も変更） | 不適合 | AI判定・目視（複数ページの比較が必要） |

「全ページ」は ng の5ページ（index / news / facility / gallery / contact）を指す。

### index.html（トップページ）

| ID | SC | レベル | ページ | 箇所（セレクタ） | 仕込み内容 | 期待判定 | 検出経路 |
|----|----|--------|--------|------------------|-----------|----------|----------|
| NG-05 | 3.1.1 | A | index.html | `html` | `lang` 属性なし | 不適合 | axe: `html-has-lang` |
| NG-06 | 1.3.1 | A | index.html | 見出し構造 | h1 の直後が h3（h2 をスキップ）。カード見出しは h4 | 不適合 | Visual: `checkHeadingStructure` |
| NG-07 | 1.1.1 | A | index.html | `.hero img` | `alt="画像"`（内容を説明しない代替テキスト） | 不適合 | AI判定（alt は存在するため axe `image-alt` は発火しない） |
| NG-08 | 1.4.3 | AA | index.html | お知らせの日付 `.news .date` | 文字色 `#aaaaaa`（白背景に約 2.3:1） | 不適合 | axe: `color-contrast` |
| NG-09 | 2.4.4 | A | index.html | お知らせ・利用案内のリンク | 「詳しくはこちら」「こちら」など行き先の分からないリンクテキスト（複数、行き先はそれぞれ異なる） | 不適合 | AI判定（2.4.4 に紐づく axe ルール `link-name` はアクセシブルネームの**有無**しか見ないため、「こちら」でも pass する） |
| NG-10 | 3.1.2 | AA | index.html | 英語キャッチコピー `.tagline .en` | 英語フレーズに `lang="en"` なし | 不適合 | AI判定・目視 |
| NG-11 | 2.5.8 | AA | index.html | SNS アイコンリンク `.sns-link` | ターゲットサイズ 18×18px（最小 24×24px 未満） | 不適合 | Visual: `checkTargetSize`（warning）。axe の `target-size` は周囲に隣接ターゲットがないため spacing exception で pass する |

### facility.html（施設案内）

| ID | SC | レベル | ページ | 箇所（セレクタ） | 仕込み内容 | 期待判定 | 検出経路 |
|----|----|--------|--------|------------------|-----------|----------|----------|
| NG-12 | 2.4.2 | A | facility.html | `head` | `title` 要素なし | 不適合 | axe: `document-title` |
| NG-13 | 1.1.1 | A | facility.html | `.gallery img`（3枚） | `alt` 属性なし | 不適合 | axe: `image-alt` |
| NG-14 | 1.3.1 | A | facility.html | 貸室一覧テーブル `.rooms-table` | `caption` / `th` なし（`td` + 装飾クラスで見た目だけ再現） | 不適合 | AI判定・目視（`th` が1つもないため `th-has-data-cells` は該当せず、`td-has-header` / `table-fake-caption` は experimental タグで実行されない） |
| NG-15 | 2.4.6 | AA | facility.html | 減免案内の見出し | 「その他のご案内」— 内容（利用料金の減免）を説明しない見出し | 不適合 | AI判定 |

### contact.html（お問い合わせ）

| ID | SC | レベル | ページ | 箇所（セレクタ） | 仕込み内容 | 期待判定 | 検出経路 |
|----|----|--------|--------|------------------|-----------|----------|----------|
| NG-16 | 2.4.2 | A | contact.html | `title` | 「ページ」という内容を説明しないタイトル（存在はするため axe は発火しない） | 不適合 | AI判定 |
| NG-17 | 3.3.2 | A | contact.html | 電話番号入力欄 `#tel` | 「電話番号」のテキストは隣接表示されているが `label` 要素で関連付けられていない（`placeholder` もなし。placeholder があると accessible name になり axe が発火しないため） | 不適合 | AI判定・目視（axe `label` は violation として発火するが、タグが `wcag412` のみのため本ツールでは 4.1.2 側に集計される。3.3.2 に紐づく axe ルールは `form-field-multiple-labels` だけで、これは passes に入りカバレッジガードで「未確認」に倒れる） |
| NG-18 | 1.3.5 | AA | contact.html | 氏名・メール入力欄 | `autocomplete` 属性なし | 不適合 | AI判定・目視（Visual の 1.3.5 チェックは「フォームあり」の汎用 warning のみで欠落自体は特定しない。axe `autocomplete-valid` は値が不正な場合のみ発火） |
| NG-19 | 1.4.1 | A | contact.html | 必須項目の表示 | 「赤字の項目は必須です」— 色のみで必須を伝える（赤は `#b30000` でコントラスト自体は 4.5:1 以上を確保し、1.4.3 と混ざらないようにしている） | 不適合 | AI判定・目視 |
| NG-20 | 1.4.11 | AA | contact.html | 入力欄の枠線 | `border: #dddddd`（白背景に約 1.4:1、3:1 未満） | 不適合 | Visual: `checkNonTextContrast` |
| NG-21 | 2.5.3 | A | contact.html | 送信ボタン | 表示テキスト「送信する」に対し `aria-label="フォーム"`（ラベルが name に含まれない） | 不適合 | Visual: `checkLabelInName`（axe `label-content-name-mismatch` は experimental タグのためタグ指定実行では動作しない） |
| NG-22 | 1.4.4 | AA | contact.html | `meta[name=viewport]` | `maximum-scale=1, user-scalable=no` で拡大禁止 | 不適合 | axe: `meta-viewport` |
| NG-23 | 4.1.2 | A | contact.html | 同意チェック `.fake-checkbox` | `div` 自作チェックボックス。role / name / state なし、キーボード操作不可 | 不適合 | AI判定・目視 |

### news.html（お知らせ一覧）

| ID | SC | レベル | ページ | 箇所（セレクタ） | 仕込み内容 | 期待判定 | 検出経路 |
|----|----|--------|--------|------------------|-----------|----------|----------|
| NG-24 | 1.4.1 | A | news.html | お知らせ本文中のリンク `.news-body a`（6か所） | 下線を消し色だけでリンクを区別（リンク色 `#1d4ed8` と本文色 `#1f2430` のコントラスト比 約2.3:1 で 3:1 未満） | 不適合 | axe: `link-in-text-block`（6件） |
| NG-25 | 1.3.1 | A | news.html | お知らせリスト `.news-list` | `ul` 直下に `li` ではなく `div` を並べ、リスト構造が壊れている | 不適合 | axe: `list` |
| NG-26 | 1.3.2 | A | news.html | 各記事 `.news-item` | DOM 順は「本文 → 日付・分類」なのに CSS `flex-direction: row-reverse` で「日付・分類 → 本文」に見せる（読み上げ順と視覚順が食い違う） | 不適合 | AI判定・目視（Interactive の 2.4.3 は DOM 順どおりのフォーカス移動しか見ないため pass になる） |
| NG-27 | 2.1.1 | A | news.html | 配信アーカイブ表のコンテナ `.archive-scroll` | 横スクロールする領域に `tabindex` がなく、内部にフォーカス可能な要素もないためキーボードでスクロールできない | 不適合 | axe: `scrollable-region-focusable` |
| NG-28 | 1.4.13 | AA | news.html | 分類バッジ `.news-category.has-tip` | 分類の説明を CSS `:hover` のツールチップだけで提供。閉じる手段がなく、`pointer-events: none` と 12px の間隔でツールチップ上にポインタを移動することもできない | 不適合 | AI判定・目視 |
| NG-29 | 1.4.10 | AA | news.html | 記事見出し `.news-title` | `white-space: nowrap` で見出しが折り返さず、320px 幅でページ全体に横スクロールが発生 | 不適合 | Interactive: `testReflow`（fail） |

### gallery.html（写真ギャラリー）

| ID | SC | レベル | ページ | 箇所（セレクタ） | 仕込み内容 | 期待判定 | 検出経路 |
|----|----|--------|--------|------------------|-----------|----------|----------|
| NG-30 | 1.1.1 | A | gallery.html | `.gallery figure`（1〜3枚目） | `figcaption` と `alt` が別の部屋を説明している（alt を1つずつずらしたコピー間違い型） | 不適合 | AI判定（alt は存在するため axe `image-alt` は発火しない） |
| NG-31 | 1.4.3 | AA | gallery.html | 写真上のキャプション `.shot-overlay` | 写真の上に白文字を重ね、背景色を敷いていない（前庭の緑地の上で約1.4:1） | 不適合 | AI判定・目視（axe `color-contrast` は「要素が画像を含むため背景色を判定できない」として **incomplete** になり violation にならない） |
| NG-32 | 1.4.5 | AA | gallery.html | イベント告知 `.event-poster img` | 催しの日時・会場・内容をすべて文字画像（SVG 内テキスト）で提供し、同じ情報のテキストをページに置いていない | 不適合 | AI判定・目視（alt は内容を説明しているため 1.1.1 としては発火しない） |
| NG-33 | 4.1.2 | A | gallery.html | `.gallery figure`（4・5枚目） | 施設案内へのサムネイルリンクの中身が `alt=""` の画像だけで、リンクにアクセシブルネームがない | 不適合 | axe: `link-name`（2件） |
| NG-34 | 2.4.11 | AA | gallery.html | 臨時のお知らせバー `.notice-bar` | 画面下部に固定した高さ約130pxのバーが、フォーカスした要素を覆う | 不適合 | Interactive: `testFocusNotObscured`（fail。サンプル10個中2個） |
| NG-35 | 1.3.1 | A | gallery.html | セクション見出し `.section-title`（3か所） | 見出しを `h2` ではなく `p` でマークアップし、見た目だけ見出しにしている | 不適合 | AI判定・目視（h1 が1つあるだけで階層スキップがないため Visual `checkHeadingStructure` は問題を検出せず warning に留まる） |

## 1つの欠陥が複数 SC にまたがるケース

精度実測の突き合わせで「表にない SC の指摘」を誤検出と即断しないための注記。

- **NG-17（label なし入力欄）**: 主たる SC は 3.3.2 だが、ラベル欠如は 1.3.1（情報及び関係性）・4.1.2（name の欠如）としても指摘されうる。なお axe の `label` ルールが持つ WCAG タグは `wcag412` のみで（`wcag131` も `wcag332` も持たない）、本ツールの集計では 4.1.2 の不適合としてのみ現れる
- **NG-23（div 自作チェックボックス）**: 主たる SC は 4.1.2 だが、キーボード操作不可のため 2.1.1（キーボード）としても指摘されうる
- **NG-01（ランドマークなし）**: 主たる SC は 2.4.1 だが、文書構造の欠如として 1.3.1 で指摘されうる
- **NG-19（色のみの必須表示）**: 必須であることが label に含まれないため 3.3.2 の説明不足として指摘されうる。また色（赤字）という感覚的な特徴だけで項目を識別させているため 1.3.3（感覚的な特徴）としても指摘されうる
- **NG-26（視覚順序と DOM 順序の食い違い）**: 主たる SC は 1.3.2 だが、日付と本文の関係が読み上げ順で崩れるため 1.3.1 としても指摘されうる
- **NG-29（折り返さない見出し）**: 主たる SC は 1.4.10 だが、200% 拡大時にも同じ横スクロールが起きるため 1.4.4 としても指摘されうる
- **NG-32（文字画像）**: 主たる SC は 1.4.5 だが、拡大時に画像内テキストが劣化する点で 1.4.4 としても指摘されうる
- **NG-33（`alt=""` のサムネイルリンク）**: 主たる SC は 4.1.2 だが、画像の情報が失われる点で 1.1.1、行き先が分からない点で 2.4.4 としても指摘されうる。axe `link-name` が持つ WCAG タグは `wcag2a` / `wcag244` / `wcag412` なので、本ツールの集計では 2.4.4 と 4.1.2 の両方に不適合として現れる
- **NG-34（画面下部の固定バー）**: 主たる SC は 2.4.11 だが、バーに覆われた本文が読めなくなる点で 1.4.10 としても指摘されうる

## ok 版との対応

ok 版は ng 版と同一のページ構成・レイアウトのまま、上記すべての箇所を適合実装にしている。
主な対応: ランドマーク + スキップリンク / フォーカスリング維持 / 検索ボタンに視覚ラベル /
`lang="ja"` + 英語フレーズに `lang="en"` / h1→h2→h3 の正しい階層 / 内容を説明する alt・見出し・リンクテキスト /
コントラスト 4.5:1 以上（枠線 3:1 以上）/ ターゲット 24px 以上 / `caption` + `th scope` 付きテーブル /
全入力欄に `label` + `autocomplete` / 「（必須）」のテキスト表記 / ネイティブ `checkbox` + `label` /
ページごとに固有の `title` / 5ページで一貫したナビゲーション。

news.html / gallery.html で追加した対応:

- 本文中のリンクに下線を残す（NG-24）／ `ul` の直下を `li` にする（NG-25）／ DOM 順を視覚順と一致させる（NG-26）
- 横スクロールする表のコンテナに `tabindex="0"` を付けてキーボードでスクロールできるようにする（NG-27）
- ホバー限定のツールチップをやめ、分類の説明を本文に常時表示する（NG-28）
- 見出しを折り返させ、320px 幅でも横スクロールを起こさない（NG-29）
- `figcaption` と一致する alt を付ける（NG-30）／ 写真上のキャプションに不透明な背景色を敷く（NG-31）
- イベント情報を文字画像ではなく HTML テキスト（`dl`）で提供し、イラストは `alt=""` の装飾画像にする（NG-32）
- サムネイルリンクの画像に内容を説明する alt を付ける（NG-33）
- 臨時のお知らせバーを固定配置にせず本文の流れの中に置く（NG-34）
- セクション見出しを `h2` でマークアップする（NG-35）

なお ok/news.html では、ページ送りの `nav` と配信アーカイブのスクロール領域に `aria-label` / `aria-labelledby` を付けていない。
Visual の `checkLabelInName`（2.5.3）が「`aria-label` を持つ要素の可視テキストがアクセシブルネームに含まれるか」を要素の種類を問わず検査するため、
子孫にテキストを持つコンテナに `aria-label` を付けると fail に倒れてしまう（2.5.3 が本来対象とするのはボタン・リンク等のラベル付き部品で、
ランドマークやスクロール領域ではない）。ok 版を「fail 0 件」に保つための回避であり、WCAG 2.2 Level AA の要件としては
ランドマークの命名は必須ではない。

**期待結果**: ok 版は axe violations 0 件、Visual / Interactive テストの fail / 具体指摘 0 件（実測済み）。
なお以下のチェックは「検証しきれない pass を出さない」設計（issue #10）のため、ok 版でも warning（未確認）が出る（違反検出ではない）:

- Visual の 1.3.5 / 3.3.1 / 3.3.2 / 3.3.3 / 3.3.7: フォーム要素が存在するページでは常に目視確認を促す warning
- Visual の 1.4.11（境界線のみの検証）/ 1.3.1（見出し階層のみの検証）/ 4.1.3（属性の存在検査のみ）: 問題未検出でも常に warning
- Interactive の 2.4.7: フォーカス前後のスタイル変化は確認できても視認性（コントラスト・太さ）は自動検証できないため、fail でない場合は warning
- Interactive の 1.3.4 / 1.4.4: スクリーンショット取得 + 目視確認前提の warning
- Interactive の 2.4.3: index ページ（ok / ng 共通）はレイアウト起因で「順序が不自然な可能性 1 件」の warning が出る（位置ヒューリスティックの既存の癖であり、違反検出ではない）

ng 版にも、仕込んだ違反とは別に次の warning が出る（違反検出ではない）:

- ng/news.html の Visual 2.5.8 `checkTargetSize`: NG-24 で本文中のリンクを `display: inline` にした結果、リンクの矩形が 16px 高になり
  「24×24px 未満が5個」の warning が出る。WCAG 2.5.8 は文章中のインラインリンクを例外としているため違反ではなく、
  チェック自身も details に「インラインリンク等は例外の可能性あり」と書いて warning（未確認）に倒している

## 実測結果（2026-08-25、axe-core 4.11.1 / Playwright 1.58.2）

ローカル配信した全10ページに対して 3 つの検査スクリプトを実行した結果。

axe-core（`@axe-core/playwright`、WCAG タグのみ）:

| ページ | axe violations | axe incomplete |
|--------|----------------|----------------|
| ok/ 全5ページ | 0 件 | 0 件 |
| ng/index.html | `html-has-lang`、`color-contrast`×3、`button-name` | 0 件 |
| ng/news.html | `link-in-text-block`×6、`list`、`scrollable-region-focusable`、`button-name` | 0 件 |
| ng/facility.html | `document-title`、`image-alt`×3、`button-name` | 0 件 |
| ng/gallery.html | `link-name`×2、`button-name` | `color-contrast`（`.shot-overlay`） |
| ng/contact.html | `label`、`meta-viewport`、`button-name` | 0 件 |

ng/gallery.html の `color-contrast` は「Element's background color could not be determined because element contains an image node」を理由に
incomplete へ落ちる。NG-31 が「axe では violation にならない」ことの実測根拠である。

Visual テスト（`a11y-visual-test.ts`）の fail:

| ページ | fail |
|--------|------|
| ok/ 全5ページ | なし |
| ng/index.html・ng/news.html・ng/facility.html・ng/gallery.html | なし（warning のみ） |
| ng/contact.html | 2.5.3 `checkLabelInName`、1.4.11 `checkNonTextContrast` |

ng/index.html では 1.3.1 `checkHeadingStructure` が「1件の見出し構造の問題」（h1→h3 スキップ）を、
2.5.8 `checkTargetSize` が `.sns-link` 18×18px を warning として報告する（いずれも件数が閾値未満のため fail にはならない）。

Interactive テスト（`a11y-interactive-test.ts`）の fail:

| ページ | fail |
|--------|------|
| ok/ 全5ページ | なし |
| ng/index.html・ng/facility.html・ng/contact.html | 2.4.7 `testFocusVisible` |
| ng/news.html | 2.4.7 `testFocusVisible`、1.4.10 `testReflow` |
| ng/gallery.html | 2.4.7 `testFocusVisible`、2.4.11 `testFocusNotObscured`（10個中2個） |

ok 版は全5ページで fail 0 件。3.2.1 / 3.2.2 は URL・DOM スナップショット比較 + ナビゲーション監視のうえ pass
（contact は tel / select / checkbox を含む 5 フィールドを検査）、2.4.7 は「スタイル変化確認済み・視認性は目視確認」の warning となる。

news.html / gallery.html の追加（2026-08-25）でナビゲーションを3項目から5項目に増やしたが、既存6ページの
axe violations・Visual fail/warning・Interactive の pass/fail/warning はいずれも追加前と一致している
（2.4.3 の warning の分母だけがナビゲーションのリンク2本ぶん増え、ok/index は 1/13→1/15、ng/index は 1/12→1/14 になる。
「順序が不自然な可能性 1 件」という判定自体は不変）。

## SC カバレッジ

仕込み済み: 25 SC / 35 箇所

| 原則 | SC |
|------|-----|
| 1. 知覚可能 | 1.1.1, 1.3.1, 1.3.2, 1.3.5, 1.4.1, 1.4.3, 1.4.4, 1.4.5, 1.4.10, 1.4.11, 1.4.13 |
| 2. 操作可能 | 2.1.1, 2.4.1, 2.4.2, 2.4.4, 2.4.6, 2.4.7, 2.4.11, 2.5.3, 2.5.8 |
| 3. 理解可能 | 3.1.1, 3.1.2, 3.2.3, 3.3.2 |
| 4. 堅牢 | 4.1.2 |

生成 AI 判定の主対象（2.4.4 リンクテキスト品質 / 4.1.2 accessible name / 1.3.1 見出し階層 / 2.4.1 ランドマーク / 3.1.1・3.1.2 lang）をすべて含む。
静的 HTML では自然に再現できない項目（時間依存メディア 1.2.x、タイミング 2.2.x、動的ステータス 4.1.3 等）は対象外とした。

検出経路の内訳は次のとおりで、機械が検出できるもの・AI 判定に頼るもの・どの経路でも「未確認」に残るものを意図的に混ぜている。

| 検出経路 | 件数 | ID |
|----------|------|-----|
| axe | 10 | NG-03, NG-05, NG-08, NG-12, NG-13, NG-22, NG-24, NG-25, NG-27, NG-33 |
| Visual | 4 | NG-06, NG-11, NG-20, NG-21 |
| Interactive | 3 | NG-02, NG-29, NG-34 |
| AI判定・目視のみ | 18 | NG-01, NG-04, NG-07, NG-09, NG-10, NG-14, NG-15, NG-16, NG-17, NG-18, NG-19, NG-23, NG-26, NG-28, NG-30, NG-31, NG-32, NG-35 |

Visual の 4 件のうち fail で返るのは NG-20（`checkNonTextContrast`、5件検出）と NG-21（`checkLabelInName`）で、
NG-06（`checkHeadingStructure`、1件検出）と NG-11（`checkTargetSize`）は件数が閾値未満のため warning に留まる。
