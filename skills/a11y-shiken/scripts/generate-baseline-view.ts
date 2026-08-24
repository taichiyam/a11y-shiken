#!/usr/bin/env bun

/**
 * デジタル庁『ウェブアクセシビリティ導入ガイドブック』の基本17項目ビューを生成する。
 *
 * merged-result.json（WCAG 2.2 A+AA 55項目の判定結果）を読み、
 * 17項目それぞれに対応する達成基準の状態を集約する。
 *
 * ⚠️ 設計上の約束:
 *   1つの項目が複数の達成基準にマップされるとき、
 *   一部しか確認できていないのに「確認OK」と表示してはならない。
 *   確認できていない基準が1つでも残れば「一部未確認」に倒す。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

// --- 17項目の定義 ---

type Severity = "重大" | "必須"

export interface BaselineItem {
  no: number
  severity: Severity
  title: string
  criteria: string[] // WCAG 達成基準 ID
  note?: string
}

/**
 * 出典: デジタル庁『ウェブアクセシビリティ導入ガイドブック』2024-03-29版
 *   §3.1 達成しないと利用者に重大な悪影響を及ぼすもの（重大）… 4項目
 *   §3.2 必ず達成しなければならないもの（必須）… 13項目
 * https://www.digital.go.jp/resources/introduction-to-web-accessibility-guidebook
 *
 * 各項目に併記された WCAG 2.0（JIS X 8341-3:2016）の達成基準を紐づけている。
 * 本ツールの判定対象は WCAG 2.2 Level A + AA の55項目であるため、
 * その範囲外の達成基準は outOfScope として扱う（後述）。
 */
/**
 * A+AA の判定対象外である達成基準（理由つき）。
 *
 * ⚠️ 「結果に無い」ことを対象外と解釈してはならない。
 *    データ欠落と、範囲外は別物である。範囲外はここに明示的に列挙する。
 */
const OUT_OF_SCOPE: Record<string, string> = {
  "2.4.10": "Level AAA のため A+AA の判定対象外",
  "4.1.1": "WCAG 2.2 で廃止",
}

export const BASELINE_ITEMS: BaselineItem[] = [
  // --- §3.1 重大（非干渉） ---
  { no: 1, severity: "重大", title: "自動再生はさせない", criteria: ["1.4.2"] },
  { no: 2, severity: "重大", title: "袋小路に陥らせない（キーボードトラップ）", criteria: ["2.1.2"] },
  {
    no: 3, severity: "重大", title: "光の点滅は危険", criteria: ["2.3.1"],
    note: "ガイドブックは適合判断の難しさから 2.3.2（AAA）への適合を推奨しているが、本ツールの対象は A+AA のため 2.3.1 で判定する",
  },
  { no: 4, severity: "重大", title: "自動でコンテンツを切り替えない", criteria: ["2.2.2"] },

  // --- §3.2 必須 ---
  { no: 5, severity: "必須", title: "画像に代替テキストを付与する", criteria: ["1.1.1"] },
  { no: 6, severity: "必須", title: "キーボードだけで全機能にアクセスできる", criteria: ["2.1.1", "2.4.3", "2.4.7", "3.2.1", "3.2.2"] },
  { no: 7, severity: "必須", title: "操作に制限時間を設けない", criteria: ["2.2.1", "2.2.2"] },
  { no: 8, severity: "必須", title: "単一の表現だけで情報を伝えない", criteria: ["1.3.1", "1.3.3", "1.4.1"] },
  { no: 9, severity: "必須", title: "読み上げ順序が意味の通る順になっている", criteria: ["1.3.1", "1.3.2", "2.4.3"] },
  {
    no: 10, severity: "必須", title: "見出し要素でセクションを表現する", criteria: ["1.3.1", "2.4.6", "2.4.1", "2.4.10"],
    note: "2.4.10（セクション見出し）は Level AAA のため、A+AA の判定対象外",
  },
  { no: 11, severity: "必須", title: "文字と背景に十分なコントラスト比", criteria: ["1.4.3"] },
  { no: 12, severity: "必須", title: "拡大縮小しても情報が読み取れる", criteria: ["1.4.4"] },
  {
    no: 13, severity: "必須", title: "文字・文字コード・フォントの注意", criteria: ["3.3.2", "4.1.1", "4.1.2"],
    note: "4.1.1（構文解析）は WCAG 2.2 で廃止されたため判定対象外",
  },
  { no: 14, severity: "必須", title: "ページタイトルを適切に表現する", criteria: ["2.4.2"] },
  { no: 15, severity: "必須", title: "リンクを適切に表現する", criteria: ["2.4.4"] },
  { no: 16, severity: "必須", title: "ナビゲーションに一貫性をもたせる", criteria: ["3.2.3"] },
  { no: 17, severity: "必須", title: "同じ機能には同じラベルをつける", criteria: ["3.2.4"] },
]

// --- merged-result.json の型 ---

type ResultStatus = "適合" | "不適合" | "要確認" | "目視確認"

export interface MergedResultItem {
  no: number
  criterion: string
  name: string
  level: string
  source: string
  status: ResultStatus
  displayLabel: string
  notes: string
}

interface MergedResult {
  url: string
  testDate: string
  summary: { pass: number; fail: number; unknown: number }
  items: MergedResultItem[]
}

// --- 集約 ---

export type BaselineStatus = "要修正" | "確認OK" | "一部未確認" | "判定対象外"

interface CriterionState {
  id: string
  inScope: boolean
  outOfScopeReason?: string
  missing?: boolean
  status?: ResultStatus
  name?: string
  source?: string
  notes?: string
}

interface BaselineResult {
  item: BaselineItem
  status: BaselineStatus
  criteria: CriterionState[]
  confirmed: number // 適合と判定できた基準数
  failed: number
  unconfirmed: number
  outOfScope: number
}

export function aggregate(item: BaselineItem, byId: Map<string, MergedResultItem>): BaselineResult {
  const criteria: CriterionState[] = item.criteria.map((id) => {
    // 明示的に範囲外と宣言された基準のみ「対象外」
    if (OUT_OF_SCOPE[id]) return { id, inScope: false, outOfScopeReason: OUT_OF_SCOPE[id] }
    const hit = byId.get(id)
    // 範囲内なのに結果が無い = データ欠落。対象外ではなく「未確認」として扱う
    if (!hit) return { id, inScope: true, missing: true, status: "要確認" as ResultStatus, notes: "判定結果が見つかりません（データ欠落）" }
    return { id, inScope: true, status: hit.status, name: hit.name, source: hit.source, notes: hit.notes }
  })

  const inScope = criteria.filter((c) => c.inScope)
  const failed = inScope.filter((c) => c.status === "不適合").length
  const confirmed = inScope.filter((c) => c.status === "適合").length
  const unconfirmed = inScope.filter((c) => c.status === "要確認" || c.status === "目視確認").length
  const outOfScope = criteria.length - inScope.length

  let status: BaselineStatus
  if (inScope.length === 0) status = "判定対象外"
  else if (failed > 0) status = "要修正"
  else if (unconfirmed > 0) status = "一部未確認" // ← 「確認OK」に丸めない
  else status = "確認OK"

  return { item, status, criteria, confirmed, failed, unconfirmed, outOfScope }
}

// --- 出力 ---

const ICON: Record<BaselineStatus, string> = {
  要修正: "❌",
  確認OK: "✅",
  一部未確認: "⚠️",
  判定対象外: "—",
}

function renderMarkdown(url: string, testDate: string, results: BaselineResult[]): string {
  const count = (s: BaselineStatus) => results.filter((r) => r.status === s).length
  const critical = results.filter((r) => r.item.severity === "重大")
  const criticalFail = critical.filter((r) => r.status === "要修正").length

  const lines: string[] = []
  lines.push("# 基本17項目チェック（デジタル庁ガイドブック）")
  lines.push("")
  lines.push(`対象: ${url}`)
  lines.push(`実行日時: ${testDate}`)
  lines.push("")
  lines.push("> WCAG 2.2 Level A+AA の55項目の判定結果を、デジタル庁『ウェブアクセシビリティ導入ガイドブック』の")
  lines.push("> **基本17項目（重大4＋必須13）** に集約したものです。")
  lines.push("> **⚠️ この結果は正式なアクセシビリティ試験（JIS X 8341-3:2016）の代替にはなりません。**")
  lines.push("")
  lines.push("## サマリー")
  lines.push("")
  lines.push("| | 件数 |")
  lines.push("|---|---|")
  lines.push(`| ❌ 要修正 | ${count("要修正")} |`)
  lines.push(`| ⚠️ 一部未確認（目視が必要な基準が残っている） | ${count("一部未確認")} |`)
  lines.push(`| ✅ 確認OK | ${count("確認OK")} |`)
  lines.push(`| — 判定対象外 | ${count("判定対象外")} |`)
  lines.push("")
  if (criticalFail > 0) {
    lines.push(`> ## 🔴 「重大」項目に ${criticalFail} 件の要修正があります`)
    lines.push("> 重大（非干渉）の項目は、達成できていないと**利用者がページの他の部分にもアクセスできなくなります。**")
    lines.push("> リリース前に必ず改修してください。")
    lines.push("")
  }

  for (const severity of ["重大", "必須"] as Severity[]) {
    const group = results.filter((r) => r.item.severity === severity)
    lines.push(`## ${severity}（${group.length}項目）`)
    lines.push("")
    lines.push("| | 項目 | 状態 | 内訳 |")
    lines.push("|---|---|---|---|")
    for (const r of group) {
      const parts: string[] = []
      if (r.confirmed) parts.push(`確認 ${r.confirmed}`)
      if (r.failed) parts.push(`**不適合 ${r.failed}**`)
      if (r.unconfirmed) parts.push(`未確認 ${r.unconfirmed}`)
      if (r.outOfScope) parts.push(`対象外 ${r.outOfScope}`)
      const total = r.criteria.length
      lines.push(`| ${r.item.no} | ${r.item.title} | ${ICON[r.status]} ${r.status} | ${total}基準中 ${parts.join(" / ")} |`)
    }
    lines.push("")
  }

  lines.push("## 内訳")
  lines.push("")
  for (const r of results) {
    lines.push(`### ${r.item.no}. ${r.item.title} — ${ICON[r.status]} ${r.status}`)
    lines.push("")
    if (r.item.note) lines.push(`> ${r.item.note}`), lines.push("")
    lines.push("| 達成基準 | 状態 | 判定 | 備考 |")
    lines.push("|---|---|---|---|")
    for (const c of r.criteria) {
      if (!c.inScope) {
        lines.push(`| ${c.id} | — | 判定対象外 | ${c.outOfScopeReason ?? ""} |`)
        continue
      }
      const notes = (c.notes ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")
      lines.push(`| ${c.id} ${c.name ?? ""} | ${c.status} | ${c.source ?? ""} | ${notes} |`)
    }
    lines.push("")
  }

  lines.push("---")
  lines.push("")
  lines.push("出典: デジタル庁『ウェブアクセシビリティ導入ガイドブック』2024-03-29版 §3.1・§3.2")
  lines.push("https://www.digital.go.jp/resources/introduction-to-web-accessibility-guidebook")
  lines.push("")
  lines.push("本ツールはデジタル庁・WAIC・W3C・JISC の認証や推奨を受けたものではありません。")
  return lines.join("\n")
}

// --- main ---

function main() {
  const args = process.argv.slice(2)
  let input = ""
  let outMd = ""
  let outJson = ""

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--merged" && args[i + 1]) { input = args[++i] }
    else if (args[i] === "--output" && args[i + 1]) { outMd = args[++i] }
    else if (args[i] === "--output-json" && args[i + 1]) { outJson = args[++i] }
  }

  if (!input) {
    console.error(`Usage: bun generate-baseline-view.ts --merged <merged-result.json> [--output <out.md>] [--output-json <out.json>]`)
    process.exit(1)
  }

  const merged: MergedResult = JSON.parse(readFileSync(resolve(input), "utf-8"))
  const byId = new Map(merged.items.map((i) => [i.criterion, i]))
  const results = BASELINE_ITEMS.map((item) => aggregate(item, byId))

  const md = renderMarkdown(merged.url, merged.testDate, results)

  if (outMd) {
    mkdirSync(dirname(resolve(outMd)), { recursive: true })
    writeFileSync(resolve(outMd), md, "utf-8")
    console.log(`✅ ${outMd}`)
  } else {
    console.log(md)
  }

  if (outJson) {
    const payload = {
      source: "デジタル庁 ウェブアクセシビリティ導入ガイドブック 2024-03-29版 §3.1・§3.2",
      url: merged.url,
      testDate: merged.testDate,
      summary: {
        要修正: results.filter((r) => r.status === "要修正").length,
        一部未確認: results.filter((r) => r.status === "一部未確認").length,
        確認OK: results.filter((r) => r.status === "確認OK").length,
        判定対象外: results.filter((r) => r.status === "判定対象外").length,
      },
      items: results.map((r) => ({
        no: r.item.no,
        severity: r.item.severity,
        title: r.item.title,
        status: r.status,
        criteria: r.criteria,
        counts: { confirmed: r.confirmed, failed: r.failed, unconfirmed: r.unconfirmed, outOfScope: r.outOfScope },
      })),
    }
    mkdirSync(dirname(resolve(outJson)), { recursive: true })
    writeFileSync(resolve(outJson), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`✅ ${outJson}`)
  }
}

if (import.meta.main) main()
