# アクセシビリティテスト スキル ロードマップ

## 全体優先順位サマリー

| 優先度 | カテゴリ | 施策 | Claude APIコスト増 | 実装難易度 |
|--------|---------|------|-------------------|-----------|
| 🔴 高 | 精度向上 | **B. Computed Styles** によるコントラスト精密計算 | なし | 低 |
| 🔴 高 | 精度向上 | **C. CSS静的解析**（outline:none / user-scalable等） | なし | 低 |
| 🔴 高 | ツール統合 | **Lighthouse** アクセシビリティスコア | なし | 低 |
| 🔴 高 | ツール統合 | **html-validate** マークアップ構造チェック | なし | 低 |
| 🟡 中 | 精度向上 | **I. agent-browser** アクセシビリティツリー取得（SPA対応・コスト削減） | なし（削減の可能性も） | 中 |
| 🟡 中 | 精度向上 | **D. メディアクエリ** 環境テスト（reduced-motion / HCM） | なし | 中 |
| 🟡 中 | 精度向上 | **E. ARIA ロールパターン** キーボードイベント検証 | なし | 中 |
| 🟡 中 | 精度向上 | **A. Claude Vision** 視覚的コントラスト・フォーカス判定 | **あり**（要枚数制限） | 中 |
| 🟡 中 | ツール統合 | **Pa11y** HTML_CodeSniffer補完 | なし | 低 |
| 🟡 中 | 設定 | **WCAGレベルプリセット**（`--preset` フラグ） | なし | 中 |
| 🟡 中 | 設定 | **選択出力フラグ**（`--no-claude-analysis` 等） | なし（削減） | 低 |
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
| Claude HTML分析 (WebFetch) | HTMLソースを読んで品質判断 | **あり**（入力トークン中心） |

---

### A. Claude Vision による視覚的判定

**効果**: 色コントラスト・フォーカスリング等を実描画で判定。HTML分析では不可能なケースをカバー。

**対象 WCAG**: 1.4.3（透明背景・グラデーション）、1.4.11（ボタン枠線・アイコン）、2.4.7（フォーカスリング視認性）

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

| 検索パターン | 対応 WCAG | 判定内容 |
|------------|----------|---------|
| `outline:\s*(none\|0)` | 2.4.7 | フォーカスリング無効化 |
| `user-scalable=no` | 1.4.4 | viewport ズーム禁止 |
| `pointer-events:\s*none` | 2.1.1 | インタラクティブ要素の操作無効化 |
| `animation` / `transition` | 2.3.3 | `prefers-reduced-motion` 未考慮 |

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

### I. agent-browser によるアクセシビリティツリー取得

**効果**: 現在 WebFetch + HTML解析でやっている role/name/state の確認を、レンダリング済みアクセシビリティツリーから直接取得できる。**SPA サイトで特に有効**。

**Claude API コスト**: **なし**（ツリーテキストは HTML全文より小さいため、入力コスト削減の可能性もある）

#### agent-browser とは

Vercel 製の CLI ツール。AIエージェント向けに設計されており、`snapshot` コマンドでページのアクセシビリティツリーを効率的に取得できる。

```bash
npx agent-browser open <URL>
npx agent-browser snapshot  # アクセシビリティツリーをテキストで出力
```

#### 現在の HTML分析との比較

| 比較 | 現在（WebFetch + HTML解析） | agent-browser snapshot |
|------|---------------------------|----------------------|
| 取得内容 | HTML ソース（静的） | レンダリング済みアクセシビリティツリー（動的） |
| role/name/state | HTML属性から推測 | ブラウザが計算した実値 |
| SPA/動的コンテンツ | JS実行前の状態 | JS実行後の状態 ✅ |
| Claude への入力量 | HTML全文（多い） | ツリーテキスト（少ない＝コスト削減） |
| aria-hidden の影響 | 検出しにくい | ツリーから除外されるので正確 |

#### Playwright との役割分担

- **Playwright スクリプト（axe-core / Visual / Interactive）** はすでに `scripts/lib/stable-browser.ts` の決定的読み込み手順（load 待ち + networkidle best-effort + lazy-load 発火）でSPA対応済み → 代替不要
- **agent-browser が代替できるのは WebFetch（Claude HTML分析）のみ**
- viewport変更・JS評価・CSS計算・raw keyboard操作 は Playwright が必要

#### a11y判定への応用

- **リンクテキストの品質（2.4.4）**: ツリー上の accessible name を直接確認
- **accessible name（4.1.2）**: `aria-label` / `aria-labelledby` の解決済み値
- **aria-hidden による誤った隠蔽**: ツリーから要素が消えているかで検出
- **ランドマーク構造（2.4.1）**: `role=main/nav/banner/contentinfo` の存在を直接確認
- **見出し階層（1.3.1）**: ツリー上の heading level を順番通りに取得

```bash
npx agent-browser open {URL}
npx agent-browser snapshot > {OUTPUT_DIR}/data/a11y-tree.txt
# → Claude に渡す入力を HTML全文からツリーテキストに切り替え
```

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
| `accesskeys` | なし | accesskey の重複検出 |
| `tap-targets` | なし | タップターゲットサイズ（モバイル） |
| `meta-viewport` | なし | `user-scalable=no` 検出（1.4.4） |
| スコア | **独自** | 0〜100の総合スコア |

レポートのサマリーに「Lighthouse スコア: XX/100」を追記するだけで付加価値あり。

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
Claude HTML分析   → 品質判断が必要な項目

【追加後】
Lighthouse        → スコア + tap-targets + meta-viewport
html-validate     → マークアップ構造エラー
Pa11y             → HTML_CodeSniffer補完
agent-browser     → アクセシビリティツリー（Claude HTML分析の強化）
```

判定優先順位:
```
Interactive > Visual > Lighthouse > html-validate > Pa11y > Claude判定 > axe-core
```

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

Claude HTML分析が最もAPIコストが高いため、用途に応じて出力物を省略できるとよい。

```bash
/accessibility-test https://example.com --no-claude-analysis
/accessibility-test https://example.com --no-markdown
```

| フラグ | コスト削減効果 | 影響 |
|-------|-------------|------|
| `--no-claude-analysis` | **大**（HTML入力トークンが大きい） | 未確認項目が増える |
| `--no-markdown` | 中（統合Markdownレポートをスキップ） | `report/markdown/` が生成されない |
| `--no-excel` | なし（ローカル処理） | Excelが不要な場合のみ |
| `--no-index` | 軽微 | `index.md` が生成されない |

---

### Google Sheets 連携（実装済み・正式公開前）

`gog` CLI を使って、テスト結果を Google スプレッドシートに直接書き込む機能。SKILL.md のステップ5.6 に実装済みだが、以下の理由で正式公開前としている:

- `gog` CLI の導入・認証セットアップが前提となる
- スプレッドシートの列構成がプロジェクトにより異なり、汎用的な書き込みロジックの整備が必要
- エラーハンドリング（認証切れ、シート不存在等）の強化が必要

**公開に向けて必要な対応:**
1. `gog` CLI のセットアップガイド作成
2. スプレッドシートのテンプレート提供（列構成の標準化）
3. ドライラン（`--dry-run`）モードの追加（書き込み前の確認）
