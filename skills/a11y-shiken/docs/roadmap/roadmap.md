# アクセシビリティテスト スキル ロードマップ

> このファイルは**未実装の検討項目**を並べたもの。実装済みの内容は [how-it-works.md](../../../../docs/how-it-works.md)（判定の仕組み）と
> `SKILL.md`（実行ワークフロー）が正本で、両者と矛盾する記述はここに残さない。
> 実装済みになった項目は「✅ 実装済み」として、実際の実装方式との差分だけを残している。

## 全体優先順位サマリー

| 優先度 | カテゴリ | 施策 | Claude APIコスト増 | 実装難易度 |
|--------|---------|------|-------------------|-----------|
| 🔴 高 | 精度向上 | **B. Computed Styles** によるコントラスト精密計算 | なし | 低 |
| 🟢 低 | 精度向上 | **C. CSS静的解析** — outline:none は Interactive、user-scalable は axe で埋まったため残りは `pointer-events` のみ | なし | 低 |
| 🔴 高 | ツール統合 | **Lighthouse** アクセシビリティスコア | なし | 低 |
| 🔴 高 | ツール統合 | **html-validate** マークアップ構造チェック | なし | 低 |
| ✅ 済 | 精度向上 | ~~**I. agent-browser** アクセシビリティツリー取得（SPA対応・コスト削減）~~ → Playwright `ariaSnapshot()` で実装済み | なし（削減） | — |
| 🟡 中 | 精度向上 | **D. メディアクエリ** 環境テスト（reduced-motion / HCM） | なし | 中 |
| 🟡 中 | 精度向上 | **E. ARIA ロールパターン** キーボードイベント検証 | なし | 中 |
| 🟡 中 | 精度向上 | **A. Claude Vision** 視覚的コントラスト・フォーカス判定 | **あり**（要枚数制限） | 中 |
| 🟡 中 | ツール統合 | **Pa11y** HTML_CodeSniffer補完 | なし | 低 |
| 🟡 中 | 設定 | **WCAGレベルプリセット**（`--preset` フラグ） | なし | 中 |
| 🟡 中 | 設定 | **選択出力フラグ**（`--no-claude-analysis` / 非対話実行での形式指定。出力形式の選択自体は `REPORT_FORMAT` で実装済み） | なし（削減） | 低 |
| 🟢 低 | ツール統合 | **Nu Html Checker (vnu)** W3C公式バリデーター | なし | 中 |
| 🟢 低 | 精度向上 | **F. IBM Equal Access Checker** ルール補完 | なし | 低 |
| 🟢 低 | 精度向上 | **H. フォーム詳細検証** エラー関連付け等 | なし | 高 |

---

## カテゴリ①: 自動判定精度向上

目視確認（⚠️ 未確認）件数の削減が主目的。

### 現在の判定構成

| ツール | 役割 | Claude API コスト |
|--------|------|-----------------|
| axe-core | WCAG機械的違反の検出 | なし |
| Visual テスト (Playwright) | DOM/レイアウト系の自動判定 | なし |
| Interactive テスト (Playwright) | キーボード操作・挙動の自動判定 | なし |
| a11y ツリー取得 (Playwright `ariaSnapshot()`) | レンダリング後のアクセシビリティツリーをテキスト化 | なし |
| Claude 分析 | a11y ツリー（無い場合のみ WebFetch した HTML）を読んで品質判断 | **あり**（入力トークン中心） |

> 判定結果の統合には `axeCoverage` によるカバレッジガード・証拠必須ガード・「適合」への遷移制限が入っている。
> 詳細は [how-it-works.md](../../../../docs/how-it-works.md) を参照（このロードマップでは扱わない）。

---

### A. Claude Vision による視覚的判定

**効果**: 色コントラスト・フォーカスリング等を実描画で判定。HTML分析では不可能なケースをカバー。

**対象 WCAG**: 1.4.3（透明背景・グラデーション）、1.4.11（ボタン枠線・アイコン）、2.4.7（フォーカスリング視認性）

いずれも「合格を出さない設計」で常に未確認になっている項目と重なる（1.4.11 / 2.4.7 は Visual / Interactive が warning のみを返す）。
判定できていない領域を埋める施策としては優先度が高いが、**画像から読み取った所見も証拠必須ガードの対象にする**必要がある
（「見た目では十分に見える」という所見は、引用可能な証拠を伴わない限り「適合」に上げてはならない）。

**Claude API コスト**: **あり（画像トークン = 高コスト）**

```typescript
const screenshot = await page.screenshot({ encoding: "base64" });
// → Claude API に画像として渡して判定
```

| 構成 | 追加トークン/ページ | 追加コスト目安 |
|------|--------------------|--------------|
| フォーカス確認のみ（5枚） | 〜10,000 tokens | 〜$0.03 |
| コントラスト全要素（20枚） | 〜40,000 tokens | 〜$0.12 |
| フルスクリーン複数状態（50枚） | 〜100,000 tokens | 〜$0.30 |

**推奨**: 対象要素を絞って枚数を最小化（要素ごとのクロップ + フルスクリーン1枚）

---

### B. Computed Styles によるコントラスト精密計算

**効果**: Claude API コスト追加ゼロでコントラスト判定精度を向上。axe-core の限界（`background: transparent` の積み重ね・CSS変数・擬似要素）を突破。

**Claude API コスト**: **なし**

```typescript
const colors = await page.evaluate(() => {
  const els = document.querySelectorAll('p, h1, h2, h3, a, button, label');
  return [...els].map(el => {
    const style = window.getComputedStyle(el);
    return { selector: el.tagName, color: style.color, background: style.backgroundColor, fontSize: style.fontSize };
  });
});
// WCAG相対輝度の式でコントラスト比を計算 → 自動判定に格上げ
```

---

### C. CSS 静的解析

**効果**: HTMLに現れない問題（CSSで上書きされた outline 等）を検出。

**Claude API コスト**: **なし**

| 検索パターン | 対応 WCAG | 判定内容 | 現状 |
|------------|----------|---------|------|
| `outline:\s*(none\|0)` | 2.4.7 | フォーカスリング無効化 | 実行時判定で代替済み（Interactive `testFocusVisible` がフォーカス前後の computed style 差分で fail 判定。issue #10） |
| `user-scalable=no` | 1.4.4 | viewport ズーム禁止 | axe `meta-viewport`（`wcag144`）が担当済み |
| `pointer-events:\s*none` | 2.1.1 | インタラクティブ要素の操作無効化 | 未実装（2.1.1 は axe の3ルールのみで、通しのキーボード検査は存在しない） |
| `animation` / `transition` | 2.3.3 | `prefers-reduced-motion` 未考慮 | 未実装（2.3.3 は Level AAA のため現在の55項目の対象外。導入するなら 2.2.2 の停止手段判定として設計する） |

上2行は実装済みの経路で埋まったため、CSS静的解析の残る価値は下2行に絞られる。

```typescript
const cssText = await page.evaluate(() =>
  [...document.styleSheets].flatMap(s => {
    try { return [...s.cssRules].map(r => r.cssText); } catch { return []; }
  }).join('\n')
);
```

---

### D. メディアクエリ環境テスト

**効果**: `prefers-reduced-motion` / ハイコントラストモードでの挙動を自動判定。

**Claude API コスト**: **なし**

```typescript
await page.emulateMedia({ reducedMotion: 'reduce' });   // 2.3.3
await page.emulateMedia({ forcedColors: 'active' });     // 1.4.3, 2.4.7
await page.emulateMedia({ colorScheme: 'dark' });        // 1.4.3
```

---

### E. ARIA ロールパターン検証の強化

**効果**: axe-core の構造チェックに加え、カスタムコンポーネントのキーボードイベント実装有無まで検証。

**Claude API コスト**: **なし**

対象:
- `role="button"` → Enter/Space ハンドラ（2.1.1）
- `role="dialog"` → Escape キー・フォーカストラップ（2.1.1, 2.4.3）
- `role="tab"` → 矢印キーナビゲーション（2.1.1）

---

### F. IBM Equal Access Checker 統合

**効果**: axe-core と異なるルールセットで補完的な検出。リッチコンポーネントの ARIA 検証で誤検知・未検知を削減。

**Claude API コスト**: **なし**

```bash
bun add accessibility-checker
```

---

### G. → ③ ツール統合「Lighthouse」に統合

---

### H. フォーム詳細検証の強化

**効果**: エラーメッセージ関連付け・必須フィールド等のフォームa11yを動的検証。フォームが検出された場合のみ実行。

**Claude API コスト**: **なし**

- 送信 → エラーメッセージと `aria-describedby` の関連付け確認（3.3.1）
- `aria-required` / `required` 属性確認（3.3.2）
- エラー提案の有無（3.3.3）

---

### I. アクセシビリティツリー取得 ✅ 実装済み

**当初案**: agent-browser（Vercel 製 CLI）の `snapshot` コマンドでアクセシビリティツリーを取得する。

**実際の実装**: 外部 CLI を追加せず、既存の Playwright 環境で `page.locator("body").ariaSnapshot()` を使う
`scripts/a11y-tree.ts` として実装した（SKILL.md ステップ2.9）。出力は agent-browser の `snapshot` と同等の YAML 形式で、
`{OUTPUT_DIR}/data/{ラベル}/a11y-tree.txt` に保存される。Claude 分析（ステップ5）はこのツリーを第1優先の入力とし、
ツリーが空・取得失敗の場合のみ WebFetch にフォールバックする。

**当初案から変えた理由**: axe-core / Visual / Interactive がすでに Playwright を起動しており、
同じ `scripts/lib/stable-browser.ts` の決定的な読み込み手順を共有できるため。
外部 CLI を足すと依存関係と読み込みタイミングの二重管理になる。

**得られた効果**（当初の想定どおり）:

| 比較 | WebFetch + HTML解析 | `ariaSnapshot()` |
|------|---------------------------|----------------------|
| 取得内容 | HTML ソース（静的） | レンダリング済みアクセシビリティツリー（動的） |
| role/name/state | HTML属性から推測 | ブラウザが計算した実値 |
| SPA/動的コンテンツ | JS実行前の状態 | JS実行後の状態 ✅ |
| Claude への入力量 | HTML全文（多い） | ツリーテキスト（少ない＝コスト削減） |
| aria-hidden の影響 | 検出しにくい | ツリーから除外されるので正確 |

ツリーで判定する項目（2.4.4 リンクテキスト品質 / 4.1.2 accessible name・aria-hidden / 2.4.1 ランドマーク / 1.3.1 見出し階層）と、
ツリーに現れないため HTML が必要な項目（lang / 文字画像 / 音声・映像 / アニメーション等）の切り分けは
SKILL.md ステップ5 と [how-it-works.md](../../../../docs/how-it-works.md) 第4章に記載済み。

**残っている課題**: viewport変更・JS評価・CSS計算・raw keyboard操作は引き続き Playwright スクリプト側が担当する（ツリーでは代替できない）。

---

## カテゴリ②: 他ツール統合

Claude API コスト追加ゼロで判定カバレッジを広げる外部ツール統合。

### A. Lighthouse Accessibility スコア（高優先）

**効果**: スコア（0〜100）による数値比較・axe-core にない監査項目の補完。クライアント報告に使いやすい。

**Claude API コスト**: **なし**

```bash
bunx lighthouse <URL> \
  --only-categories=accessibility \
  --output=json \
  --output-path={OUTPUT_DIR}/data/lighthouse-result.json \
  --chrome-flags="--headless"
```

| 監査項目 | axe-coreとの重複 | 補完価値 |
|---------|----------------|---------|
| `accesskeys` | axe の `accesskeys` は best-practice タグのため、本ツールのWCAGタグ実行では発火しない | accesskey の重複検出 |
| `tap-targets` | **あり**（axe `target-size` / Visual `checkTargetSize`） | モバイル実機基準でのタップターゲット判定 |
| `meta-viewport` | **あり**（axe に同名ルールが存在し `wcag144` タグで実行される。ng/contact.html の実測でも violation として発火） | なし（重複） |
| スコア | **独自** | 0〜100の総合スコア |

レポートのサマリーに「Lighthouse スコア: XX/100」を追記するだけで付加価値あり。

**導入時の注意**: Lighthouse の内部エンジンは axe-core であり、多くの監査項目は本ツールの axe-core 実行と重複する。
統合するなら「スコア」と「axe-core にない独自監査」に絞り、重複分を二重に判定へ流し込まないこと。

---

### B. html-validate（高優先）

**効果**: HTMLマークアップの構造的エラー（不正なネスト・閉じタグ漏れ・廃止属性等）を検出。a11yの根本原因になるマークアップ問題を排除。

**Claude API コスト**: **なし**

```bash
bun add -d html-validate
# Playwright で page.content() を取得して保存してから実行
bunx html-validate {OUTPUT_DIR}/data/page.html --formatter=json \
  > {OUTPUT_DIR}/data/html-validate-result.json
```

| エラー例 | a11yへの影響 |
|---------|------------|
| `<button>` の中に `<div>` | スクリーンリーダーの誤読 |
| `<label>` の `for` 属性が孤立 | フォームの関連付け失敗 |
| `<th>` に `scope` なし | テーブルの読み上げ順序 |

担当列: `自動判定(HTML Validate)`

---

### C. Pa11y（中優先）

**効果**: HTML_CodeSniffer エンジン（axe-coreとは別ルールセット）で補完検出。

**Claude API コスト**: **なし**

```bash
bunx pa11y <URL> --standard WCAG2AA --reporter json \
  > {OUTPUT_DIR}/data/pa11y-result.json
```

axe-coreとの差分で価値が出るケース: `autocomplete` 属性（1.3.5）、PDF リンク警告等。実行後に axe-core との重複を確認し、ユニークな検出項目だけ統合する。

---

### D. Nu Html Checker / vnu（低優先）

**効果**: W3C公式バリデーター。html-validate より厳密・網羅的。Java依存のため W3C API 経由が導入しやすい。

**Claude API コスト**: **なし**

```bash
curl -s -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @{OUTPUT_DIR}/data/page.html \
  "https://validator.w3.org/nu/?out=json" \
  > {OUTPUT_DIR}/data/vnu-result.json
```

---

### 統合後のツール構成（全体像）

```
【現在】
axe-core          → WCAG機械的違反
Visual テスト      → DOM/レイアウト系
Interactive テスト → キーボード・挙動系
a11y ツリー取得    → ariaSnapshot()（Claude 分析の第1入力）
Claude 分析        → 品質判断が必要な項目（ツリー優先・WebFetch フォールバック）

【追加後】
Lighthouse        → スコア（重複しない独自監査のみ）
html-validate     → マークアップ構造エラー
Pa11y             → HTML_CodeSniffer補完
```

判定優先順位（現在は `Interactive > Visual > Claude判定 > axe-core`。追加後の想定）:
```
Interactive > Visual > Lighthouse > html-validate > Pa11y > Claude判定 > axe-core
```

> 追加ツールを統合する際は、既存の3つのガード（`axeCoverage` カバレッジガード / 証拠必須ガード /
> 「適合」への遷移制限）にどう乗せるかを先に決めること。**証拠のない pass を「適合」に通す経路を新たに作らない。**

---

## カテゴリ③: ユーザビリティ・設定

### WCAGレベルプリセット（`--preset` フラグ）

現在 WCAG 2.2 Level AA 固定。プロジェクトによって必要な基準が異なるため、プリセット選択に対応したい。

```bash
/accessibility-test https://example.com --preset wcag21-aa
```

| プリセット名 | axe-coreタグ | 用途 |
|------------|------------|------|
| `wcag22-aa`（デフォルト） | `wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22a,wcag22aa` | 最新基準 |
| `wcag21-aa` | `wcag2a,wcag2aa,wcag21a,wcag21aa` | 旧プロジェクト・既存契約向け |
| `wcag22-a` | `wcag2a,wcag21a,wcag22a` | Level Aのみ（スモールスタート） |
| `best-practice` | 上記 + `best-practice` | 基準 + axe推奨事項も含む |

**実装上の課題**: axe-coreタグは簡単。`references/wcag-checklist.md` のレベル別対応と Visual/Interactive スクリプト側の改修が必要。

---

### 選択出力フラグ（`--no-*` フラグ）

Claude 分析が最もAPIコストが高いため、用途に応じて出力物を省略できるとよい。

**出力形式の選択は実装済み**（ステップ1.5 の AskUserQuestion → `REPORT_FORMAT`）。
フラグではなく対話で選ぶ形になっており、`--no-markdown` / `--no-excel` に相当する制御は既にできる。

| フラグ案 | 状態 | コスト削減効果 | 影響 |
|-------|------|-------------|------|
| `--no-claude-analysis` | 未実装 | **大**（ツリー/HTML の入力トークンが大きい） | 未確認項目が増える |
| `--no-markdown` | ✅ `REPORT_FORMAT: excel` で実現済み | 中（統合Markdownレポートをスキップ） | `markdown/{ラベル}.md` / `_index.md` / `index.md` / `index.html` が生成されない |
| `--no-excel` | ✅ `REPORT_FORMAT: markdown` で実現済み | なし（ローカル処理） | Excelが不要な場合のみ |
| `--no-index` | 未実装 | 軽微 | `index.md` が生成されない |

**残る検討点**: 非対話実行（CI 等）では AskUserQuestion が使えないため、`REPORT_FORMAT` を引数で渡せる手段は別途必要。
なお `merged-result.json` は Single Source of Truth かつ基本17項目ビューの入力のため、どの形式でも省略できない。

---

### Google Sheets 連携（実装済み・正式公開前）

`gog` CLI を使って、テスト結果を Google スプレッドシートに直接書き込む機能。SKILL.md のステップ5.6 に実装済みだが、以下の理由で正式公開前としている:

- `gog` CLI の導入・認証セットアップが前提となる
- スプレッドシートの列構成がプロジェクトにより異なり、汎用的な書き込みロジックの整備が必要
- エラーハンドリング（認証切れ、シート不存在等）の強化が必要
- 手順が Claude の手作業（Read → 行の対応付け → `gog sheets update`）で、スクリプト化されていない

書き込み元は `merged-result.json` に統一済み（`references/google-sheets.md`）。
Excel / Markdown と同じ Single Source of Truth を使うため、シート書き込み側で判定を再解釈することはない。

**公開に向けて必要な対応:**
1. `gog` CLI のセットアップガイド作成
2. スプレッドシートのテンプレート提供（列構成の標準化）
3. ドライラン（`--dry-run`）モードの追加（書き込み前の確認）
4. `merged-result.json` → シート行のマッピングをスクリプト化し、手作業による転記ミスをなくす
