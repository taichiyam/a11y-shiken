import { describe, expect, test } from "bun:test"
import {
  buildMergedResult,
  mergeResults,
  sanitizeClaudeOverrides,
  type AxeResult,
  type AxeRule,
  type ClaudeOverride,
  type ClaudeOverridesResult,
  type InteractiveTestOutput,
  type VisualTestOutput,
  type WcagCriterion,
} from "./generate-checklist-xlsx"

const CRITERION: WcagCriterion = {
  id: "1.1.1",
  name: "非テキストコンテンツ",
  category: "知覚可能",
  level: "A",
  description: "",
  axeTags: ["wcag111"],
}

function rule(tag: string): AxeRule {
  return {
    id: "image-alt",
    description: "",
    help: "画像に代替テキストがない",
    tags: [tag],
    nodes: [{ html: "<img src='a.png'>", target: ["img"] }],
  }
}

function axeFixture(partial: Partial<AxeResult> = {}): AxeResult {
  return {
    url: "https://example.com",
    timestamp: "2026-08-18T00:00:00.000Z",
    violations: [],
    incomplete: [],
    passes: [],
    ...partial,
  }
}

const axeViolation = () => axeFixture({ violations: [rule("wcag111")] })
const axePass = () => axeFixture({ passes: [rule("wcag111")] })

function overridesOf(...overrides: Partial<ClaudeOverride>[]): ClaudeOverridesResult {
  return {
    overrides: overrides.map((o) => ({
      criterion: "1.1.1",
      status: "pass",
      details: "",
      evidence: "",
      ...o,
    }) as ClaudeOverride),
  }
}

function visualOf(result: "pass" | "fail" | "warning", details: string): VisualTestOutput {
  return {
    url: "https://example.com",
    timestamp: "2026-08-18T00:00:00.000Z",
    summary: { pass: 0, fail: 0, warning: 0 },
    checks: [{ id: "check", criterion: "1.1.1", name: "", result, details, elements: [] }],
  }
}

function interactiveOf(status: "pass" | "fail" | "warning", details: string): InteractiveTestOutput {
  return {
    url: "https://example.com",
    timestamp: "2026-08-18T00:00:00.000Z",
    results: [{ criterion: "1.1.1", name: "", status, source: "test", details }],
  }
}

describe("sanitizeClaudeOverrides（証拠必須ガード）", () => {
  test("evidence 欠落の pass は warning に降格され、降格が記録される", () => {
    const { result, demotions } = sanitizeClaudeOverrides(
      overridesOf({ status: "pass", details: "問題なし", evidence: "" })
    )
    expect(result.overrides[0].status).toBe("warning")
    expect(result.overrides[0].details).toContain("証拠なしのため未確認に降格")
    expect(result.overrides[0].details).toContain("元判定: pass")
    expect(demotions).toHaveLength(1)
    expect(demotions[0]).toContain("1.1.1")
  })

  test("evidence 欠落の fail も warning に降格される", () => {
    const { result } = sanitizeClaudeOverrides(
      overridesOf({ status: "fail", details: "altがない", evidence: "" })
    )
    expect(result.overrides[0].status).toBe("warning")
  })

  test("evidence 欠落の not-applicable も warning に降格される（確認OK扱いの抜け道を塞ぐ）", () => {
    const { result } = sanitizeClaudeOverrides(
      overridesOf({ status: "not-applicable", details: "該当なし", evidence: "" })
    )
    expect(result.overrides[0].status).toBe("warning")
  })

  test("空白のみの evidence は欠落として扱う", () => {
    const { result } = sanitizeClaudeOverrides(
      overridesOf({ status: "pass", evidence: "   " })
    )
    expect(result.overrides[0].status).toBe("warning")
  })

  test("evidence がある pass はそのまま受理される", () => {
    const { result, demotions } = sanitizeClaudeOverrides(
      overridesOf({ status: "pass", details: "alt設定済み", evidence: "img[alt='ロゴ']" })
    )
    expect(result.overrides[0].status).toBe("pass")
    expect(demotions).toHaveLength(0)
  })

  test("warning は evidence がなくても降格対象にならない", () => {
    const { result, demotions } = sanitizeClaudeOverrides(
      overridesOf({ status: "warning", details: "目視確認が必要", evidence: "" })
    )
    expect(result.overrides[0].status).toBe("warning")
    expect(result.overrides[0].details).toBe("目視確認が必要")
    expect(demotions).toHaveLength(0)
  })
})

describe("mergeResults（遷移ルール: 不適合→適合の降格ガード）", () => {
  test("axe-core の不適合は証拠のない Claude pass で覆されない（矛盾フラグが立つ）", () => {
    const result = mergeResults(
      CRITERION,
      axeViolation(),
      undefined,
      undefined,
      overridesOf({ status: "pass", details: "問題なし", evidence: "" })
    )
    expect(result.status).toBe("不適合")
    expect(result.source).toBe("自動判定")
    expect(result.conflict).toBe(true)
    expect(result.notes).toContain("⚠️ 判定矛盾")
    expect(result.notes).toContain("不適合を維持")
  })

  test("証拠ガード（sanitize）後の evidence なし pass は warning となり不適合を維持する", () => {
    const { result: sanitized } = sanitizeClaudeOverrides(
      overridesOf({ status: "pass", details: "問題なし", evidence: "" })
    )
    const result = mergeResults(CRITERION, axeViolation(), undefined, undefined, sanitized)
    expect(result.status).toBe("不適合")
  })

  test("証拠のある Claude pass は不適合を覆せるが、矛盾フラグと経緯が残る", () => {
    const result = mergeResults(
      CRITERION,
      axeViolation(),
      undefined,
      undefined,
      overridesOf({ status: "pass", details: "全画像にalt設定済み", evidence: "img[alt='ロゴ'], img[alt='']" })
    )
    expect(result.status).toBe("適合")
    expect(result.source).toBe("自動判定(Claude)")
    expect(result.conflict).toBe(true)
    expect(result.notes).toContain("⚠️ 判定矛盾")
    expect(result.notes).toContain("証拠: img[alt='ロゴ'], img[alt='']")
  })

  test("適合→不適合（安全側への遷移）は無条件で許可され、矛盾フラグは立たない", () => {
    const result = mergeResults(
      CRITERION,
      axePass(),
      undefined,
      undefined,
      overridesOf({ status: "fail", details: "altが空", evidence: "img:nth-child(2)" })
    )
    expect(result.status).toBe("不適合")
    expect(result.conflict).toBeFalsy()
  })

  test("Visual pass が axe-core の不適合を覆す場合も矛盾フラグが立つ（details が証拠）", () => {
    const result = mergeResults(
      CRITERION,
      axeViolation(),
      visualOf("pass", "全要素で確認OK（12要素を検証）")
    )
    expect(result.status).toBe("適合")
    expect(result.conflict).toBe(true)
    expect(result.notes).toContain("⚠️ 判定矛盾")
  })

  test("details が空の Visual pass は不適合を覆せない", () => {
    const result = mergeResults(CRITERION, axeViolation(), visualOf("pass", ""))
    expect(result.status).toBe("不適合")
    expect(result.conflict).toBe(true)
  })

  test("Interactive pass が axe-core の不適合を覆す場合も矛盾フラグが立つ", () => {
    const result = mergeResults(
      CRITERION,
      axeViolation(),
      undefined,
      interactiveOf("pass", "全フォーカス要素で確認OK")
    )
    expect(result.status).toBe("適合")
    expect(result.conflict).toBe(true)
  })

  test("Interactive fail は前段の適合を無条件で覆す", () => {
    const result = mergeResults(
      CRITERION,
      axePass(),
      undefined,
      interactiveOf("fail", "キーボードトラップを検出")
    )
    expect(result.status).toBe("不適合")
    expect(result.notes).toContain("キーボードトラップを検出")
  })

  test("目視確認からの Claude pass（証拠あり）は矛盾なしで適合になる", () => {
    const result = mergeResults(
      CRITERION,
      axeFixture(),
      undefined,
      undefined,
      overridesOf({ status: "pass", details: "alt設定済み", evidence: "img[alt='ロゴ']" })
    )
    expect(result.status).toBe("適合")
    expect(result.conflict).toBeFalsy()
    expect(result.notes).toContain("証拠: img[alt='ロゴ']")
  })

  test("降格済み warning の details は要確認・目視確認の備考に引き継がれる", () => {
    const { result: sanitized } = sanitizeClaudeOverrides(
      overridesOf({ status: "pass", details: "問題なし", evidence: "" })
    )
    const result = mergeResults(CRITERION, axeFixture(), undefined, undefined, sanitized)
    expect(result.status).toBe("目視確認")
    expect(result.notes).toContain("証拠なしのため未確認に降格")
  })

  test("矛盾フラグは後段の上書きを経ても消えない", () => {
    // Claude が証拠付きで不適合を覆した後、Interactive pass がさらに上書きしても conflict は維持される
    const result = mergeResults(
      CRITERION,
      axeViolation(),
      undefined,
      interactiveOf("pass", "確認OK"),
      overridesOf({ status: "pass", details: "alt設定済み", evidence: "img[alt='ロゴ']" })
    )
    expect(result.status).toBe("適合")
    expect(result.conflict).toBe(true)
  })
})

describe("buildMergedResult（矛盾フラグの出力反映）", () => {
  test("矛盾が起きた項目は conflict: true と ⚠️ 備考が merged-result に残る", () => {
    const merged = buildMergedResult(
      "https://example.com",
      "2026-08-18 00:00",
      axeViolation(),
      undefined,
      undefined,
      overridesOf({ status: "pass", details: "alt設定済み", evidence: "img[alt='ロゴ']" })
    )
    const item = merged.items.find((i) => i.criterion === "1.1.1")!
    expect(item.conflict).toBe(true)
    expect(item.displayLabel).toBe("確認OK")
    expect(item.notes).toContain("⚠️ 判定矛盾")
  })

  test("矛盾のない項目は conflict: false になる", () => {
    const merged = buildMergedResult("https://example.com", "2026-08-18 00:00", axeViolation())
    for (const item of merged.items) {
      expect(item.conflict).toBe(false)
    }
  })
})
