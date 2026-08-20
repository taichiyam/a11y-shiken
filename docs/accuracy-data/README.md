# 精度実測（盲検）の生データ

[docs/accuracy-report.md](../accuracy-report.md) の集計を第三者が監査するための一次データです。
**このディレクトリのファイルは編集しないでください。** 測定時点の記録として固定します。

## 中身

| パス | 内容 |
|------|------|
| `skill-step5.md` | 判定者に渡した唯一の指示書。`skills/a11y-shiken/SKILL.md` の 293-354 行（ステップ5 本体）と 360-375 行（`claude-overrides.json` のフォーマット定義）を抜き出したもの |
| `judge-run{1,2,3}/{ページ}.json` | 独立した判定エージェント 3 体が出力した `claude-overrides.json`（4 ページ × 3 セッション = 12 ファイル） |

## ページ名と実体の対応

判定者には正解を伏せるため中立名で提示しています。**判定者はこの対応表を見ていません。**

| 判定者に見せた名前 | 実体 |
|---|---|
| `alpha-index` | [`examples/site/ok/index.html`](../../examples/site/ok/index.html)（仕込んだ違反なし） |
| `alpha-contact` | [`examples/site/ok/contact.html`](../../examples/site/ok/contact.html)（仕込んだ違反なし） |
| `beta-index` | [`examples/site/ng/index.html`](../../examples/site/ng/index.html)（10 達成基準に違反） |
| `beta-contact` | [`examples/site/ng/contact.html`](../../examples/site/ng/contact.html)（11 達成基準に違反） |

正解データは [examples/site/ground-truth.md](../../examples/site/ground-truth.md) です。

## 含まれていないもの

- **機械検査の結果**（`axe-result.json` / `visual-result.json` / `interactive-result.json` / `a11y-tree.txt`）:
  決定的なので、[レポートの再現手順](../accuracy-report.md#再現手順)のコマンドで再生成できます
- **統合結果**（`merged-result.json`）: 上記の生データと機械検査の結果から `generate-checklist-xlsx.ts` で再生成できます

## 監査のしかた

各 JSON は `{"overrides": [{"criterion", "status", "details", "evidence"}, ...]}` の形式です。
レポートの集計表と突き合わせる際の要点:

- **判定件数**: セッション1 と 3 は各ページ 16 項目、セッション2 は 15 項目（`1.3.2` を判定していない）
- **間違った合格**: `beta-*` の判定のうち、ground-truth.md が違反とする達成基準に `pass` / `not-applicable` が付いていないか
- **証拠品質**: `evidence` の記述が、実際のアクセシビリティツリー / HTML に存在するか
