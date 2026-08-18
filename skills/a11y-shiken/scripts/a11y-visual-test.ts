#!/usr/bin/env bun

import type { Page } from "playwright";
import { launchStableBrowser, gotoStable } from "./lib/stable-browser";

// ── Types ──────────────────────────────────────────────────────────

interface CheckResult {
  id: string;
  criterion: string;
  name: string;
  result: "pass" | "fail" | "warning";
  details: string;
  elements: { selector: string; issue: string }[];
}

interface Output {
  url: string;
  timestamp: string;
  summary: { pass: number; fail: number; warning: number };
  checks: CheckResult[];
}

// ── Helpers ────────────────────────────────────────────────────────

function parseArgs(): string {
  const url = process.argv[2];
  if (!url || url.startsWith("--")) {
    console.error("Usage: bun a11y-visual-test.ts <URL>");
    process.exit(1);
  }
  return url;
}

// ── Check functions ────────────────────────────────────────────────

// checkReflow(1.4.10), checkOrientation(1.3.4) は interactive-test に統合済み

/** 2.5.8 ターゲットサイズ（最小）: 24x24px 未満の操作要素を検出 */
async function checkTargetSize(page: Page): Promise<CheckResult> {
  const smallTargets = await page.evaluate(() => {
    const interactiveSelectors =
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [tabindex]';
    const elements = document.querySelectorAll(interactiveSelectors);
    const results: { selector: string; width: number; height: number }[] = [];

    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      // Skip invisible elements
      if (rect.width === 0 || rect.height === 0) return;
      // Skip elements outside viewport
      if (rect.top < 0 || rect.left < 0) return;

      if (rect.width < 24 || rect.height < 24) {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const cls = el.className
          ? `.${String(el.className).split(" ").filter(Boolean).join(".")}`
          : "";
        results.push({
          selector: `${tag}${id}${cls}`,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        });
      }
    });

    return results;
  });

  // More than 5 small targets is a warning; any inline links are expected to be small
  const result: CheckResult = {
    id: "target-size",
    criterion: "2.5.8",
    name: "ターゲットサイズ（最小）",
    result: smallTargets.length === 0 ? "pass" : "warning",
    details:
      smallTargets.length === 0
        ? "24x24px 未満の操作要素なし"
        : `${smallTargets.length}個の操作要素が 24x24px 未満（インラインリンク等は例外の可能性あり）`,
    elements: smallTargets.slice(0, 20).map((t) => ({
      selector: t.selector,
      issue: `${t.width}x${t.height}px`,
    })),
  };

  return result;
}

// checkFocusVisible(2.4.7) は interactive-test に統合済み

/** 2.5.3 名前のラベル: visible text が accessible name に含まれるか */
async function checkLabelInName(page: Page): Promise<CheckResult> {
  const issues = await page.evaluate(() => {
    const elements = document.querySelectorAll(
      "[aria-label], [aria-labelledby]"
    );
    const problems: { selector: string; issue: string }[] = [];

    elements.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const visibleText = (htmlEl.innerText || htmlEl.textContent || "")
        .trim()
        .toLowerCase();
      if (!visibleText) return;

      let accessibleName = "";
      const ariaLabel = htmlEl.getAttribute("aria-label");
      const ariaLabelledby = htmlEl.getAttribute("aria-labelledby");

      if (ariaLabelledby) {
        const ids = ariaLabelledby.split(/\s+/);
        accessibleName = ids
          .map((id) => {
            const ref = document.getElementById(id);
            return ref ? (ref.innerText || ref.textContent || "").trim() : "";
          })
          .join(" ")
          .toLowerCase();
      } else if (ariaLabel) {
        accessibleName = ariaLabel.toLowerCase();
      }

      if (accessibleName && !accessibleName.includes(visibleText)) {
        const tag = htmlEl.tagName.toLowerCase();
        const id = htmlEl.id ? `#${htmlEl.id}` : "";
        problems.push({
          selector: `${tag}${id}`,
          issue: `表示テキスト「${visibleText}」が accessible name「${accessibleName}」に含まれていない`,
        });
      }
    });

    return problems;
  });

  return {
    id: "label-in-name",
    criterion: "2.5.3",
    name: "名前のラベル",
    result: issues.length === 0 ? "pass" : "fail",
    details:
      issues.length === 0
        ? "すべての要素で visible text が accessible name に含まれている"
        : `${issues.length}個の要素で visible text と accessible name が不一致`,
    elements: issues.slice(0, 20),
  };
}

// checkKeyboardTrap(2.1.2), checkFocusOrder(2.4.3), checkTextResize(1.4.4) は interactive-test に統合済み

/** 1.4.11 非テキストコントラスト: ボタン/入力欄の border vs background コントラスト比 */
async function checkNonTextContrast(page: Page): Promise<CheckResult> {
  const issues = await page.evaluate(() => {
    function parseColor(
      color: string
    ): [number, number, number] | null {
      const m = color.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/
      );
      if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
      return null;
    }

    function relLum(r: number, g: number, b: number): number {
      const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
        c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      );
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    function contrast(
      c1: [number, number, number],
      c2: [number, number, number]
    ): number {
      const l1 = relLum(...c1);
      const l2 = relLum(...c2);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    const targets = document.querySelectorAll(
      'button, input:not([type="hidden"]), select, textarea, [role="button"]'
    );
    const problems: { selector: string; issue: string }[] = [];

    targets.forEach((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const style = window.getComputedStyle(el);
      const borderColor = parseColor(style.borderColor);
      const bgColor = parseColor(style.backgroundColor);

      if (!borderColor || !bgColor) return;

      // Skip if border is transparent or not visible
      const borderWidth = parseFloat(style.borderWidth);
      if (borderWidth < 1) return;
      const borderStyle = style.borderStyle;
      if (borderStyle === "none" || borderStyle === "hidden") return;

      const ratio = contrast(borderColor, bgColor);

      if (ratio < 3) {
        const tag = (el as HTMLElement).tagName.toLowerCase();
        const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
        problems.push({
          selector: `${tag}${id}`,
          issue: `border と background のコントラスト比 ${ratio.toFixed(2)}:1 (基準: 3:1以上)`,
        });
      }
    });

    return problems;
  });

  // 本チェックが検証しているのはフォーム部品の「境界線 vs 背景」のみ。
  // 境界線のないコンポーネント・アイコン・状態表示等のグラフィックは検証できていないため、
  // 問題が検出されなくても pass は出さず warning（未確認）に倒す。
  return {
    id: "non-text-contrast",
    criterion: "1.4.11",
    name: "非テキストコントラスト",
    result: issues.length > 3 ? "fail" : "warning",
    details:
      issues.length === 0
        ? "フォーム部品の境界線と背景のコントラスト比に問題は検出されず。ただし本チェックは境界線のみの検証のため、境界線のないコンポーネント・アイコン・グラフィックは目視確認が必要"
        : `${issues.length}個の UI コンポーネントでコントラスト比が 3:1 未満`,
    elements: issues.slice(0, 20),
  };
}

/** 1.3.1 見出し構造: h1-h6 の階層スキップと h1 複数使用を検出 */
async function checkHeadingStructure(page: Page): Promise<CheckResult> {
  const issues = await page.evaluate(() => {
    const headings = Array.from(
      document.querySelectorAll("h1,h2,h3,h4,h5,h6")
    );
    const problems: { selector: string; issue: string }[] = [];

    // h1の数をチェック
    const h1Count = headings.filter((h) => h.tagName === "H1").length;
    if (h1Count === 0) {
      problems.push({ selector: "html", issue: "h1要素が存在しない" });
    } else if (h1Count > 1) {
      problems.push({
        selector: "h1",
        issue: `h1要素が${h1Count}個存在（推奨: 1個）`,
      });
    }

    // 階層スキップチェック（h2→h4 のようなスキップ）
    let prevLevel = 0;
    for (const h of headings) {
      const level = parseInt(h.tagName[1]);
      if (prevLevel > 0 && level > prevLevel + 1) {
        problems.push({
          selector: h.tagName.toLowerCase(),
          issue: `h${prevLevel} → h${level} に階層スキップ`,
        });
      }
      prevLevel = level;
    }

    return { headings: headings.length, problems };
  });

  // 1.3.1（情報及び関係性）のうち本チェックが検証しているのは見出し階層のみ。
  // テーブル・リスト・視覚的な関係性など他の構造は検証できていないため、
  // 見出しに問題がなくても pass は出さず warning（未確認）に倒す。
  return {
    id: "heading-structure",
    criterion: "1.3.1",
    name: "見出し構造",
    result: issues.problems.length > 2 ? "fail" : "warning",
    details:
      issues.problems.length === 0
        ? `見出し階層に機械検出可能な問題なし（${issues.headings}個の見出し要素）。テーブル・リスト等、見出し以外の構造の適切さは目視確認が必要`
        : `${issues.problems.length}件の見出し構造の問題を検出（${issues.headings}個の見出し要素）`,
    elements: issues.problems.slice(0, 20),
  };
}

/** 4.1.3 aria-live: aria-live領域、role="status"/"alert"/"log" の有無を検出 */
async function checkAriaLive(page: Page): Promise<CheckResult> {
  const result = await page.evaluate(() => {
    const liveRegions = document.querySelectorAll(
      '[aria-live], [role="status"], [role="alert"], [role="log"]'
    );

    const found: { selector: string; issue: string }[] = [];
    liveRegions.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const role = el.getAttribute("role") || "";
      const ariaLive = el.getAttribute("aria-live") || "";
      found.push({
        selector: `${tag}${id}`,
        issue: `aria-live="${ariaLive}" role="${role}" を検出`,
      });
    });

    // 動的コンテンツ領域の検出（JS更新される可能性のある要素）
    const dynamicSelectors = [
      ".notification",
      ".alert",
      ".message",
      ".toast",
      ".snackbar",
      "[data-loading]",
      "[data-status]",
      ".error-message",
      ".success-message",
    ];
    const dynamicElements = document.querySelectorAll(
      dynamicSelectors.join(",")
    );
    const missingLive: { selector: string; issue: string }[] = [];
    dynamicElements.forEach((el) => {
      if (
        !el.getAttribute("aria-live") &&
        !el.getAttribute("role")?.match(/^(status|alert|log)$/)
      ) {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const cls = el.className
          ? `.${String(el.className).split(" ").filter(Boolean).slice(0, 2).join(".")}`
          : "";
        missingLive.push({
          selector: `${tag}${id}${cls}`,
          issue: "動的コンテンツの可能性があるがaria-liveが未設定",
        });
      }
    });

    return { found, missingLive };
  });

  const allIssues = [...result.found, ...result.missingLive];

  // aria-live 属性の存在検査だけでは「ステータスメッセージが支援技術に適切に伝わる」ことも
  // 「動的コンテンツが存在しない」ことも検証できないため、pass は出さず常に warning（未確認）とする。
  return {
    id: "aria-live",
    criterion: "4.1.3",
    name: "ステータスメッセージ（aria-live）",
    result: "warning",
    details:
      result.found.length > 0
        ? `${result.found.length}個のaria-live領域を検出${result.missingLive.length > 0 ? `、${result.missingLive.length}個の動的要素にaria-live未設定` : ""}。ステータスメッセージが支援技術に適切に通知されるかは目視確認が必要`
        : `aria-live領域なし${result.missingLive.length > 0 ? `。${result.missingLive.length}個の動的要素にaria-live未設定の可能性` : ""}。動的なステータスメッセージの有無は機械判定できないため目視確認が必要`,
    elements: allIssues.slice(0, 20),
  };
}

/** 1.4.2 自動再生メディア: audio[autoplay], video[autoplay] の検出 */
async function checkAutoplayMedia(page: Page): Promise<CheckResult> {
  const autoplayElements = await page.evaluate(() => {
    const elements = document.querySelectorAll(
      "audio[autoplay], video[autoplay]"
    );
    const results: { selector: string; issue: string }[] = [];

    elements.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const src =
        el.getAttribute("src") ||
        el.querySelector("source")?.getAttribute("src") ||
        "";
      const muted = el.hasAttribute("muted") ? "（muted属性あり）" : "";
      results.push({
        selector: `${tag}${id}`,
        issue: `autoplay属性あり${muted}${src ? ` src: ${src.slice(0, 80)}` : ""}`,
      });
    });

    return results;
  });

  return {
    id: "autoplay-media",
    criterion: "1.4.2",
    name: "音声の制御（自動再生）",
    result: autoplayElements.length === 0 ? "pass" : "fail",
    details:
      autoplayElements.length === 0
        ? "自動再生メディア要素なし"
        : `${autoplayElements.length}個の自動再生メディア要素を検出`,
    elements: autoplayElements.slice(0, 20),
  };
}

/** 2.1.4 文字キーのショートカット: accesskey属性とdocumentレベルのキーリスナーを検出 */
async function checkCharKeyShortcuts(page: Page): Promise<CheckResult> {
  const issues = await page.evaluate(() => {
    const problems: { selector: string; issue: string }[] = [];

    // accesskey属性の検出
    const accesskeyElements = document.querySelectorAll("[accesskey]");
    accesskeyElements.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const key = el.getAttribute("accesskey") || "";
      problems.push({
        selector: `${tag}${id}`,
        issue: `accesskey="${key}" が設定されている`,
      });
    });

    return problems;
  });

  // CDPでdocument/windowレベルのkeydown/keypressイベントリスナーを検出
  let keyListenerIssues: { selector: string; issue: string }[] = [];
  let cdpOk = false;
  try {
    const client = await (page as any).context().newCDPSession(page);
    for (const target of ["document", "window"]) {
      const { listeners } = await client.send("DOMDebugger.getEventListeners", {
        objectId: (
          await client.send("Runtime.evaluate", {
            expression: target,
            objectGroup: "listeners",
          })
        ).result.objectId,
      });

      const keyListeners = (listeners as any[]).filter((l: any) =>
        ["keydown", "keypress", "keyup"].includes(l.type)
      );

      keyListenerIssues.push(
        ...keyListeners.map((l: any) => ({
          selector: target,
          issue: `${target}レベルの${l.type}リスナーを検出（文字キーショートカットの可能性）`,
        }))
      );
    }
    cdpOk = true;

    await client.detach();
  } catch {
    // CDP接続に失敗した場合、リスナーの有無は未確認（cdpOk = false のまま）
  }

  const allIssues = [...issues, ...keyListenerIssues];

  return {
    id: "char-key-shortcuts",
    criterion: "2.1.4",
    name: "文字キーのショートカット",
    // キーリスナーを検査できなかった場合、「検出されず」は検証の裏付けがないため pass を出さない
    result: allIssues.length === 0 ? (cdpOk ? "pass" : "warning") : "warning",
    details:
      allIssues.length === 0
        ? cdpOk
          ? "文字キーショートカットは検出されず"
          : "accesskey属性は検出されず。キーイベントリスナーの検査に失敗したため（CDP接続不可）、文字キーショートカットの有無は目視確認が必要"
        : `${allIssues.length}件の文字キーショートカットの可能性を検出（無効化/再設定/フォーカス時のみ有効にする手段があるか要確認）`,
    elements: allIssues.slice(0, 20),
  };
}

/** 2.5.4 動きによる起動: devicemotion/deviceorientation リスナーの検出 */
async function checkMotionActuation(page: Page): Promise<CheckResult> {
  let motionListeners: { selector: string; issue: string }[] = [];
  let cdpOk = false;

  try {
    const client = await (page as any).context().newCDPSession(page);

    // windowオブジェクトのイベントリスナーを検出
    const { listeners } = await client.send("DOMDebugger.getEventListeners", {
      objectId: (
        await client.send("Runtime.evaluate", {
          expression: "window",
          objectGroup: "listeners",
        })
      ).result.objectId,
    });

    const motionEvents = (listeners as any[]).filter((l: any) =>
      ["devicemotion", "deviceorientation"].includes(l.type)
    );

    if (motionEvents.length > 0) {
      motionListeners = motionEvents.map((l: any) => ({
        selector: "window",
        issue: `${l.type}イベントリスナーを検出（動きによる起動の可能性。UIによる代替手段があるか要確認）`,
      }));
    }
    cdpOk = true;

    await client.detach();
  } catch {
    // CDP接続に失敗した場合、リスナーの有無は未確認（cdpOk = false のまま）
  }

  return {
    id: "motion-actuation",
    criterion: "2.5.4",
    name: "動きによる起動",
    // リスナーを検査できなかった場合、「検出されず」は検証の裏付けがないため pass を出さない
    result: motionListeners.length === 0 ? (cdpOk ? "pass" : "warning") : "warning",
    details:
      motionListeners.length === 0
        ? cdpOk
          ? "動きによる起動は検出されず"
          : "モーションイベントリスナーの検査に失敗したため（CDP接続不可）、動きによる起動の有無は目視確認が必要"
        : `${motionListeners.length}件のモーションイベントリスナーを検出`,
    elements: motionListeners.slice(0, 20),
  };
}

// checkFocusNotObscured(2.4.11) は interactive-test に統合済み

/** 2.5.7 ドラッグ操作: draggable属性やdrag系イベントリスナーの検出 */
async function checkDraggingMovements(page: Page): Promise<CheckResult> {
  // Check draggable attributes
  const draggableElements = await page.evaluate(() => {
    const elements = document.querySelectorAll('[draggable="true"]');
    const results: { selector: string; issue: string }[] = [];

    elements.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className
        ? `.${String(el.className).split(" ").filter(Boolean).slice(0, 2).join(".")}`
        : "";
      results.push({
        selector: `${tag}${id}${cls}`,
        issue: `draggable="true" 属性あり（単一ポインタの代替手段があるか要確認）`,
      });
    });

    return results;
  });

  // Check drag event listeners via CDP
  let dragListeners: { selector: string; issue: string }[] = [];
  let cdpOk = false;
  try {
    const client = await (page as any).context().newCDPSession(page);
    const { listeners } = await client.send("DOMDebugger.getEventListeners", {
      objectId: (
        await client.send("Runtime.evaluate", {
          expression: "document",
          objectGroup: "listeners",
        })
      ).result.objectId,
    });

    const dragEvents = (listeners as any[]).filter((l: any) =>
      ["dragstart", "drag", "dragend", "dragover", "drop"].includes(l.type)
    );

    if (dragEvents.length > 0) {
      dragListeners = dragEvents.map((l: any) => ({
        selector: "document",
        issue: `documentレベルの${l.type}リスナーを検出（ドラッグ操作の可能性）`,
      }));
    }
    cdpOk = true;

    await client.detach();
  } catch {
    // CDP接続に失敗した場合、リスナーの有無は未確認（cdpOk = false のまま）
  }

  const allIssues = [...draggableElements, ...dragListeners];

  return {
    id: "dragging-movements",
    criterion: "2.5.7",
    name: "ドラッグ操作",
    // リスナーを検査できなかった場合、「検出されず」は検証の裏付けがないため pass を出さない
    result: allIssues.length === 0 ? (cdpOk ? "pass" : "warning") : "warning",
    details:
      allIssues.length === 0
        ? cdpOk
          ? "ドラッグ操作は検出されず"
          : "draggable属性は検出されず。dragイベントリスナーの検査に失敗したため（CDP接続不可）、ドラッグ操作の有無は目視確認が必要"
        : `${allIssues.length}件のドラッグ操作の可能性を検出（単一ポインタの代替手段があるか要確認）`,
    elements: allIssues.slice(0, 20),
  };
}

/**
 * フォーム関連の達成基準チェック（該当コンテンツの有無を判定）
 *
 * 以下の達成基準をまとめてチェック：
 * - 1.3.5 入力目的の特定
 * - 3.3.1 エラーの特定
 * - 3.3.2 ラベル又は説明
 * - 3.3.3 エラー修正の提案
 * - 3.3.7 冗長な入力
 * - 3.3.8 アクセシブル認証（最小）
 */
async function checkFormRelatedCriteria(page: Page): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // フォーム要素の有無をチェック
  const hasFormElements = await page.evaluate(() => {
    const forms = document.querySelectorAll("form");
    const inputs = document.querySelectorAll("input:not([type='hidden']), textarea, select");
    return forms.length > 0 || inputs.length > 0;
  });

  // パスワード入力の有無をチェック
  const hasPasswordInput = await page.evaluate(() => {
    return document.querySelectorAll("input[type='password']").length > 0;
  });

  // 1.3.5 入力目的の特定
  results.push({
    id: "input-purpose",
    criterion: "1.3.5",
    name: "入力目的の特定",
    result: hasFormElements ? "warning" : "pass",
    details: hasFormElements
      ? "フォーム要素あり。autocomplete属性の設定を目視確認が必要"
      : "フォーム要素なし（該当コンテンツなし）",
    elements: [],
  });

  // 3.3.1 エラーの特定
  results.push({
    id: "error-identification",
    criterion: "3.3.1",
    name: "エラーの特定",
    result: hasFormElements ? "warning" : "pass",
    details: hasFormElements
      ? "フォーム要素あり。入力エラー時のエラー特定を目視確認が必要"
      : "フォーム要素なし（該当コンテンツなし）",
    elements: [],
  });

  // 3.3.2 ラベル又は説明
  results.push({
    id: "labels-or-instructions",
    criterion: "3.3.2",
    name: "ラベル又は説明",
    result: hasFormElements ? "warning" : "pass",
    details: hasFormElements
      ? "フォーム要素あり。ラベル・説明の適切性を目視確認が必要"
      : "フォーム要素なし（該当コンテンツなし）",
    elements: [],
  });

  // 3.3.3 エラー修正の提案
  results.push({
    id: "error-suggestion",
    criterion: "3.3.3",
    name: "エラー修正の提案",
    result: hasFormElements ? "warning" : "pass",
    details: hasFormElements
      ? "フォーム要素あり。エラー修正の提案を目視確認が必要"
      : "フォーム要素なし（該当コンテンツなし）",
    elements: [],
  });

  // 3.3.7 冗長な入力
  results.push({
    id: "redundant-entry",
    criterion: "3.3.7",
    name: "冗長な入力",
    result: hasFormElements ? "warning" : "pass",
    details: hasFormElements
      ? "フォーム要素あり。同一プロセス内での再入力要求がないか目視確認が必要"
      : "フォーム要素なし（該当コンテンツなし）",
    elements: [],
  });

  // 3.3.8 アクセシブル認証（最小）
  results.push({
    id: "accessible-authentication",
    criterion: "3.3.8",
    name: "アクセシブル認証（最小）",
    result: hasPasswordInput ? "warning" : "pass",
    details: hasPasswordInput
      ? "パスワード入力あり。認知機能テストのみに依存していないか目視確認が必要"
      : "パスワード入力なし（該当コンテンツなし）",
    elements: [],
  });

  return results;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const url = parseArgs();

  const { browser, page } = await launchStableBrowser();

  try {
    await gotoStable(page, url);

    const checks: CheckResult[] = [];

    // --- Visual テスト固有のチェック ---
    // 注: reflow(1.4.10), orientation(1.3.4), focusVisible(2.4.7),
    //     keyboardTrap(2.1.2), focusOrder(2.4.3), textResize(1.4.4),
    //     focusNotObscured(2.4.11) は interactive-test に統合済み

    // target-size — getBoundingClientRect のみ
    checks.push(await checkTargetSize(page));

    // label-in-name — DOM 読み取りのみ
    checks.push(await checkLabelInName(page));

    // non-text-contrast — getComputedStyle のみ
    checks.push(await checkNonTextContrast(page));

    // 見出し構造（DOM読み取りのみ、リロード不要）
    checks.push(await checkHeadingStructure(page));
    checks.push(await checkAriaLive(page));
    checks.push(await checkAutoplayMedia(page));

    // CDP利用チェック（リロード不要）
    checks.push(await checkCharKeyShortcuts(page));
    checks.push(await checkMotionActuation(page));

    // dragging-movements — DOM読み取り + CDP
    checks.push(await checkDraggingMovements(page));

    // フォーム関連の達成基準チェック（該当コンテンツの有無）
    const formChecks = await checkFormRelatedCriteria(page);
    checks.push(...formChecks);

    // Build output
    const summary = { pass: 0, fail: 0, warning: 0 };
    for (const c of checks) {
      summary[c.result]++;
    }

    const output: Output = {
      url,
      timestamp: new Date().toISOString(),
      summary,
      checks,
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
