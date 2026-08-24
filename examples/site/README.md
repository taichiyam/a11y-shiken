# 検証用ダミーサイト「つばめ台コミュニティセンター」

a11y-shiken の精度実測・ハンズオン用の自前検査対象サイト。
同一レイアウトの ok / ng 2バージョンを持ち、ng 版に仕込んだ違反は [ground-truth.md](ground-truth.md) で ground truth として管理する。

- **ok 版** (`ok/`): WCAG 2.2 Level A + AA 適合を目指した実装。検査すると「確認OK」が並ぶデモ用
- **ng 版** (`ng/`): 25 SC / 35 箇所の違反を意図的に仕込んだ実装。精度実測の正解データ付き検査対象

登場する施設・住所・電話番号はすべて架空。ビルド不要の素の HTML / CSS / SVG のみで構成している。

## 構成

```
examples/site/
├── index.html        # 入口ページ（ok / ng へのリンク）
├── ground-truth.md   # ng 版の違反設計表（SC × 箇所 × 期待判定）
├── assets/           # ok / ng 共有の画像（SVG）
├── ok/               # 適合バージョン（index / news / facility / gallery / contact + style.css）
└── ng/               # 違反バージョン（同一ページ構成）
```

ページ構成（両バージョン共通、各5ページ）:

| ページ | 主な構造 |
|--------|----------|
| `index.html`（トップ） | ナビ・ヒーロー画像・お知らせ抜粋・カード |
| `news.html`（お知らせ一覧） | 日付つき記事リスト・分類バッジ・ページ送り・横スクロールする配信アーカイブ表 |
| `facility.html`（施設案内） | 貸室一覧テーブル・開館時間テーブル・画像ギャラリー |
| `gallery.html`（写真ギャラリー） | 大きな写真＋重ねキャプション・サムネイルのグリッド・イベント告知・臨時のお知らせバー |
| `contact.html`（お問い合わせ） | 入力フォーム（テキスト・select・チェックボックス） |

ハンズオンで複数 URL の一括検査を試すときは、`ok/` 5ページと `ng/` 5ページの計10 URL を検査対象にできる。

## ローカルでの表示

リポジトリルートで静的サーバーを起動する:

```bash
bunx serve examples/site
# → http://localhost:3000/ が入口ページ
# → http://localhost:3000/ok/ / http://localhost:3000/ng/
```

`python3 -m http.server` などでもよい（ビルド不要）。

注意: `bunx serve` は cleanUrls 機能により `/ok/index.html` を末尾スラッシュなしの `/ok` に
リダイレクトし、相対パスの `style.css` がルート解決されて 404 になる。
`serve` を使うときはトップページを必ず末尾スラッシュ付き（`/ok/`・`/ng/`）で開くこと
（`facility.html` 等のサブページや GitHub Pages ではこの問題は起きない）。

## GitHub Pages での配信

リポジトリ public 化後、Settings → Pages で `main` ブランチ / `(root)` を選ぶと以下の URL で配信される:

```
https://<owner>.github.io/a11y-shiken/examples/site/          # 入口ページ
https://<owner>.github.io/a11y-shiken/examples/site/ok/index.html
https://<owner>.github.io/a11y-shiken/examples/site/ng/index.html
```

リンク・アセット参照はすべて相対パスで、外部 CDN 等への依存はないため、サブパス配信でもそのまま動く。
アンダースコア始まりのファイル / ディレクトリを使っていないので `.nojekyll` も不要。

## 注意

- **ng 版の HTML / CSS ソースには違反の注釈コメントを書かない。** 生成 AI 判定がソースを読むため、注釈があると答えが漏れて精度実測を汚染する。違反の記録は ground-truth.md にのみ置く
- ng 版に違反を追加・変更した場合は、必ず ground-truth.md を同時に更新する
