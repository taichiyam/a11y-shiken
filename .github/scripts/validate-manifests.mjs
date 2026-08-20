#!/usr/bin/env node

// プラグインマニフェストの構文・必須フィールド・両ファイル間の整合を検証する。
// plugin.json と marketplace.json は同じ情報を重複して持つため、
// 片方だけ更新されて食い違う（ドリフトする）事故を CI で止める。

import { readFileSync } from "node:fs"

const PLUGIN_PATH = ".claude-plugin/plugin.json"
const MARKETPLACE_PATH = ".claude-plugin/marketplace.json"

/** 両ファイルで一致していなければならないフィールド */
const SHARED_FIELDS = ["name", "version", "description", "homepage", "repository", "license"]

const errors = []

function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    errors.push(`${path}: 読み込みまたは JSON パースに失敗 — ${error.message}`)
    return null
  }
}

const plugin = readManifest(PLUGIN_PATH)
const marketplace = readManifest(MARKETPLACE_PATH)

if (plugin) {
  for (const field of ["name", "description", "version"]) {
    if (!plugin[field]) errors.push(`${PLUGIN_PATH}: 必須フィールド "${field}" がない`)
  }
}

if (marketplace) {
  for (const field of ["name", "owner", "plugins"]) {
    if (!marketplace[field]) errors.push(`${MARKETPLACE_PATH}: 必須フィールド "${field}" がない`)
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    errors.push(`${MARKETPLACE_PATH}: "plugins" が空`)
  }
}

// 両ファイルが読めた場合のみ、重複フィールドの一致を検証する
if (plugin && marketplace && Array.isArray(marketplace.plugins)) {
  const entry = marketplace.plugins.find((p) => p.name === plugin.name)

  if (!entry) {
    errors.push(
      `${MARKETPLACE_PATH}: plugins に "${plugin.name}"（${PLUGIN_PATH} の name）のエントリがない`,
    )
  } else {
    if (!entry.source) errors.push(`${MARKETPLACE_PATH}: plugins[${plugin.name}] に "source" がない`)

    for (const field of SHARED_FIELDS) {
      // marketplace 側に書かれているフィールドだけを比較対象にする。
      // 省略は許容し、書くなら plugin.json と一致していることを求める
      if (entry[field] === undefined) continue
      if (JSON.stringify(entry[field]) !== JSON.stringify(plugin[field])) {
        errors.push(
          `マニフェストのドリフト: "${field}" が食い違っている\n` +
            `  ${PLUGIN_PATH}: ${JSON.stringify(plugin[field])}\n` +
            `  ${MARKETPLACE_PATH}: ${JSON.stringify(entry[field])}`,
        )
      }
    }
  }
}

if (errors.length > 0) {
  console.error("プラグインマニフェストの検証に失敗しました。\n")
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log("プラグインマニフェストの検証に成功しました。")
