#!/usr/bin/env node

// a11y-shiken installer
// Claude Code のスキルディレクトリへ skills/a11y-shiken/ を配置する。
// 依存なしで動くよう Node 標準モジュールのみを使う。

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const SKILL_NAME = "a11y-shiken"
const SOURCE = path.join(__dirname, "..", "skills", SKILL_NAME)

function usage() {
  console.log(`
a11y-shiken installer

  npx a11y-shiken@latest init            カレントプロジェクトの .claude/skills/ に配置
  npx a11y-shiken@latest init --global   ~/.claude/skills/ に配置
  npx a11y-shiken@latest init --force    既存のディレクトリを上書き

インストール後、Claude Code で /${SKILL_NAME} と入力すると起動します。
`)
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".DS_Store") continue
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args[0] !== "init") {
    usage()
    process.exit(args.length === 0 ? 0 : 1)
  }

  const isGlobal = args.includes("--global")
  const force = args.includes("--force")

  const root = isGlobal
    ? path.join(os.homedir(), ".claude")
    : path.join(process.cwd(), ".claude")
  const dest = path.join(root, "skills", SKILL_NAME)

  if (!fs.existsSync(SOURCE)) {
    console.error(`エラー: スキル本体が見つかりません (${SOURCE})`)
    process.exit(1)
  }

  if (fs.existsSync(dest) && !force) {
    console.error(`既に存在します: ${dest}`)
    console.error("上書きする場合は --force を付けて再実行してください。")
    process.exit(1)
  }

  copyDir(SOURCE, dest)

  console.log(`
✅ ${SKILL_NAME} を配置しました
   ${dest}

次の手順:
  1. bun を導入していない場合は https://bun.sh/docs/installation
  2. Claude Code で /${SKILL_NAME} と入力

⚠️ v0.1.0 はベータ版です。
   正式なアクセシビリティ試験（JIS X 8341-3:2016）の代替にはなりません。
   一部の判定は生成AIによるもので、精度は未測定です。
   詳細: https://github.com/taichiyam/a11y-shiken#制限事項
`)
}

main()
