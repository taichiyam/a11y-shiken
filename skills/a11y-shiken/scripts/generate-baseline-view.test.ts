import { describe, expect, test } from "bun:test"
import { BASELINE_ITEMS, aggregate, type MergedResultItem } from "./generate-baseline-view"

function fixture(map: Record<string, MergedResultItem["status"]>) {
  return new Map(
    Object.entries(map).map(([criterion, status]) => [
      criterion,
      { no: 0, criterion, name: "", level: "A", source: "test", status, displayLabel: "", notes: "" } as MergedResultItem,
    ]),
  )
}

const byNo = (n: number) => BASELINE_ITEMS.find((i) => i.no === n)!

describe("17項目のマッピング（デジタル庁ガイドブック 2024-03-29版 §3.1・§3.2）", () => {
  test("重大4項目・必須13項目の計17項目である", () => {
    expect(BASELINE_ITEMS).toHaveLength(17)
    expect(BASELINE_ITEMS.filter((i) => i.severity === "重大")).toHaveLength(4)
    expect(BASELINE_ITEMS.filter((i) => i.severity === "必須")).toHaveLength(13)
  })

  test("重大（非干渉）4項目の達成基準が固定されている", () => {
    expect(byNo(1).criteria).toEqual(["1.4.2"])
    expect(byNo(2).criteria).toEqual(["2.1.2"])
    expect(byNo(3).criteria).toEqual(["2.3.1"])
    expect(byNo(4).criteria).toEqual(["2.2.2"])
  })

  test("複数基準に対応する必須項目の達成基準が固定されている", () => {
    expect(byNo(6).criteria).toEqual(["2.1.1", "2.4.3", "2.4.7", "3.2.1", "3.2.2"])
    expect(byNo(7).criteria).toEqual(["2.2.1", "2.2.2"])
    expect(byNo(8).criteria).toEqual(["1.3.1", "1.3.3", "1.4.1"])
    expect(byNo(9).criteria).toEqual(["1.3.1", "1.3.2", "2.4.3"])
    expect(byNo(10).criteria).toEqual(["1.3.1", "2.4.6", "2.4.1", "2.4.10"])
    expect(byNo(13).criteria).toEqual(["3.3.2", "4.1.1", "4.1.2"])
  })

  test("単一基準の必須項目の達成基準が固定されている", () => {
    expect(byNo(5).criteria).toEqual(["1.1.1"])
    expect(byNo(11).criteria).toEqual(["1.4.3"])
    expect(byNo(12).criteria).toEqual(["1.4.4"])
    expect(byNo(14).criteria).toEqual(["2.4.2"])
    expect(byNo(15).criteria).toEqual(["2.4.4"])
    expect(byNo(16).criteria).toEqual(["3.2.3"])
    expect(byNo(17).criteria).toEqual(["3.2.4"])
  })
})

describe("集約ルール", () => {
  test("すべて適合なら 確認OK", () => {
    const r = aggregate(byNo(6), fixture({ "2.1.1": "適合", "2.4.3": "適合", "2.4.7": "適合", "3.2.1": "適合", "3.2.2": "適合" }))
    expect(r.status).toBe("確認OK")
  })

  test("⚠️ 一部しか確認できていなければ 確認OK に丸めない（最重要）", () => {
    const r = aggregate(byNo(6), fixture({ "2.1.1": "適合", "2.4.3": "適合", "2.4.7": "適合", "3.2.1": "目視確認", "3.2.2": "要確認" }))
    expect(r.status).toBe("一部未確認")
    expect(r.confirmed).toBe(3)
    expect(r.unconfirmed).toBe(2)
  })

  test("1つでも不適合があれば 要修正（未確認より優先）", () => {
    const r = aggregate(byNo(6), fixture({ "2.1.1": "適合", "2.4.3": "不適合", "2.4.7": "目視確認", "3.2.1": "適合", "3.2.2": "適合" }))
    expect(r.status).toBe("要修正")
    expect(r.failed).toBe(1)
  })

  test("結果に存在しない基準はデータ欠落として未確認に倒し、確認OK にしない", () => {
    const r = aggregate(byNo(6), fixture({ "2.1.1": "適合" }))
    expect(r.status).toBe("一部未確認")
    expect(r.unconfirmed).toBe(4) // 2.4.3 / 2.4.7 / 3.2.1 / 3.2.2 が欠落
    expect(r.outOfScope).toBe(0)  // 欠落を「対象外」に読み替えない
  })

  test("A+AA の範囲外の基準は 対象外 として数え、確認OK を妨げない", () => {
    const r10 = aggregate(byNo(10), fixture({ "1.3.1": "適合", "2.4.6": "適合", "2.4.1": "適合" }))
    expect(r10.outOfScope).toBe(1) // 2.4.10 は AAA
    expect(r10.status).toBe("確認OK")

    const r13 = aggregate(byNo(13), fixture({ "3.3.2": "適合", "4.1.2": "適合" }))
    expect(r13.outOfScope).toBe(1) // 4.1.1 は WCAG 2.2 で廃止
    expect(r13.status).toBe("確認OK")
  })

  test("対応基準がすべて明示的な範囲外なら 判定対象外", () => {
    const r = aggregate({ no: 99, severity: "必須", title: "test", criteria: ["2.4.10", "4.1.1"] }, fixture({}))
    expect(r.status).toBe("判定対象外")
    expect(r.outOfScope).toBe(2)
  })

  test("未知の基準IDは範囲外ではなくデータ欠落として扱う", () => {
    const r = aggregate({ no: 98, severity: "必須", title: "test", criteria: ["9.9.9"] }, fixture({}))
    expect(r.status).toBe("一部未確認")
    expect(r.outOfScope).toBe(0)
  })
})
