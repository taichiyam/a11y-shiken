#!/usr/bin/env bun

import type { ElementHandle, Page } from "playwright";
import { mkdir } from "fs/promises";
import { join } from "path";
import { launchStableBrowser, gotoStable } from "./lib/stable-browser";

interface CliArgs {
  url: string;
  screenshotDir: string;
}

interface TestResult {
  criterion: string;
  name: string;
  status: "pass" | "fail" | "warning";
  source: string;
  details: string;
  screenshots?: string[];
}

interface InteractiveTestOutput {
  url: string;
  timestamp: string;
  results: TestResult[];
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0].startsWith("--")) {
    console.error("Usage: bun a11y-interactive-test.ts <URL> [--screenshot-dir <dir>]");
    process.exit(1);
  }

  const url = args[0];
  let screenshotDir = "screenshots";

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--screenshot-dir" && args[i + 1]) {
      screenshotDir = args[i + 1];
      i++;
    }
  }

  return { url, screenshotDir };
}

/**
 * 2.4.7 フォーカス可視化
 * フォーカス可能要素にTabキーで移動し、フォーカスリングが視認できるかスクリーンショットで確認
 */
async function testFocusVisible(page: Page, screenshotDir: string): Promise<TestResult> {
  const screenshots: string[] = [];

  try {
    // フォーカス可能な要素を取得
    const allFocusable = await page.$$('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])');

    // 実際にキーボードで到達しうる（表示されていて無効化されていない）要素だけを母数にする。
    // 母数が実態とずれると、後段のカバレッジ判定が意味を失うため。
    const focusableElements: typeof allFocusable = [];
    for (const el of allFocusable) {
      const reachable = await el.evaluate((node) => {
        const e = node as HTMLElement;
        if ((e as HTMLInputElement).disabled) return false;
        if (e.getAttribute("aria-hidden") === "true") return false;
        const style = getComputedStyle(e);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = e.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0;
      }).catch(() => false);
      if (reachable) focusableElements.push(el);
    }

    if (focusableElements.length === 0) {
      return {
        criterion: "2.4.7",
        name: "フォーカス可視化",
        status: "warning",
        source: "自動判定(Interactive)",
        details: "フォーカス可能な要素が見つかりませんでした。",
      };
    }

    // 最大10個の要素をサンプリング（全要素だと時間がかかるため）
    const sampleSize = Math.min(10, focusableElements.length);
    const sampleIndices = Array.from(
      { length: sampleSize },
      (_, i) => Math.floor((i * focusableElements.length) / sampleSize)
    );

    // キーボードモダリティを確立する。
    // Chromium は直前の操作がキーボードのときだけ script focus にも :focus-visible を適用するため、
    // 先に Tab を1回押しておかないと、UA デフォルトのフォーカスリングだけに頼る適合ページを
    // 「インジケータなし」と誤判定（false fail）してしまう。
    await page.keyboard.press("Tab");
    await page.waitForTimeout(50);

    let visibleFocusCount = 0;

    for (const index of sampleIndices) {
      const element = focusableElements[index];
      await element.focus();
      await page.waitForTimeout(100); // フォーカス描画を待つ

      const screenshotPath = join(screenshotDir, `focus-visible-${index}.png`);
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);

      // フォーカススタイルの有無を確認（outline または box-shadow）。
      // computed の outline ショートハンドは「rgb(...) none 0px」形式で返るため、
      // 文字列全体を "none" と比較しても outline: none を検出できない。個別プロパティで判定する。
      // outlineStyle "auto" は UA デフォルトのフォーカスリング（幅の計算値に依存しない）。
      const hasVisibleFocus = await element.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        const outlineVisible =
          styles.outlineStyle !== "none" &&
          (styles.outlineStyle === "auto" || parseFloat(styles.outlineWidth) > 0);
        const boxShadowVisible = styles.boxShadow !== "none";
        return outlineVisible || boxShadowVisible;
      });

      if (hasVisibleFocus) {
        visibleFocusCount++;
      }
    }

    const passRate = visibleFocusCount / sampleSize;

    if (passRate >= 0.5) {
      // CSS 上にフォーカススタイルが存在しても、実際に視認できるか（コントラスト・太さ）までは
      // 自動検証できていない。pass は出さず warning（未確認）に倒す。
      return {
        criterion: "2.4.7",
        name: "フォーカス可視化",
        status: "warning",
        source: "自動判定(Interactive)",
        details: `${sampleSize}個中${visibleFocusCount}個の操作要素でフォーカススタイル（outline / box-shadow）を確認。実際の視認性（コントラスト・太さ）は自動検証できないため、スクリーンショットの目視確認が必要です。`,
        screenshots,
      };
    } else {
      return {
        criterion: "2.4.7",
        name: "フォーカス可視化",
        status: "fail",
        source: "自動判定(Interactive)",
        details: `${sampleSize}個中${visibleFocusCount}個でのみフォーカスが視認可能。多くの要素でフォーカスインジケータが不足しています。`,
        screenshots,
      };
    }
  } catch (error) {
    return {
      criterion: "2.4.7",
      name: "フォーカス可視化",
      status: "warning",
      source: "自動判定(Interactive)",
      details: `テスト実行中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
      screenshots,
    };
  }
}

/**
 * 2.4.3 フォーカス順序
 * Tab移動順序をトレースし、DOM順序と比較して論理的か判定
 */
async function testFocusOrder(page: Page, screenshotDir: string): Promise<TestResult> {
  try {
    // フォーカス可能な要素をDOM順序で取得
    const focusableElements = await page.$$('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])');

    if (focusableElements.length === 0) {
      return {
        criterion: "2.4.3",
        name: "フォーカス順序",
        status: "warning",
        source: "自動判定(Interactive)",
        details: "フォーカス可能な要素が見つかりませんでした。",
      };
    }

    // tabindex値を確認
    const tabindexValues = await Promise.all(
      focusableElements.map((el) => el.getAttribute("tabindex"))
    );

    // カスタムtabindex（正の値）が使用されているかチェック
    const hasPositiveTabindex = tabindexValues.some((val) => val && parseInt(val) > 0);

    if (hasPositiveTabindex) {
      return {
        criterion: "2.4.3",
        name: "フォーカス順序",
        status: "warning",
        source: "自動判定(Interactive)",
        details: "正の値のtabindex属性が使用されています。フォーカス順序がDOM順序と異なる可能性があるため、目視確認が必要です。",
      };
    }

    // 要素が1つしかない場合は順序チェック不要
    if (focusableElements.length === 1) {
      return {
        criterion: "2.4.3",
        name: "フォーカス順序",
        status: "pass",
        source: "自動判定(Interactive)",
        details: "フォーカス可能な要素が1つのみです。順序の問題はありません。",
      };
    }

    // DOM順序が論理的かどうかの簡易チェック（上から下、左から右）
    const positions = await Promise.all(
      focusableElements.map((el) =>
        el.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, left: rect.left };
        })
      )
    );

    let outOfOrderCount = 0;
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];

      // 前の要素より上にある、または同じ高さで左にある場合は順序が逆
      if (curr.top < prev.top - 10 || (Math.abs(curr.top - prev.top) < 10 && curr.left < prev.left - 10)) {
        outOfOrderCount++;
      }
    }

    const errorRate = outOfOrderCount / (positions.length - 1);

    if (errorRate === 0) {
      return {
        criterion: "2.4.3",
        name: "フォーカス順序",
        status: "pass",
        source: "自動判定(Interactive)",
        details: `${focusableElements.length}個の要素のフォーカス順序がDOM順序に従っており、論理的です。`,
      };
    } else if (errorRate < 0.2) {
      return {
        criterion: "2.4.3",
        name: "フォーカス順序",
        status: "warning",
        source: "自動判定(Interactive)",
        details: `一部の要素でフォーカス順序が不自然な可能性があります（${outOfOrderCount}/${positions.length - 1}）。目視確認が推奨されます。`,
      };
    } else {
      return {
        criterion: "2.4.3",
        name: "フォーカス順序",
        status: "fail",
        source: "自動判定(Interactive)",
        details: `多くの要素でフォーカス順序が不自然です（${outOfOrderCount}/${positions.length - 1}）。フォーカス順序の見直しが必要です。`,
      };
    }
  } catch (error) {
    return {
      criterion: "2.4.3",
      name: "フォーカス順序",
      status: "warning",
      source: "自動判定(Interactive)",
      details: `テスト実行中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 2.1.2 キーボードトラップ
 * 全フォーカス可能要素をTab/Shift+Tabで移動し、トラップ（無限ループ）がないか確認
 */
/**
 * キーボード巡回のカバレッジ閾値。
 * これを下回る巡回率で循環が閉じた場合、「他の部分へ出られない」= トラップとみなす。
 * 下回ったまま終了した場合は pass を出さず warning に倒す。
 */
const TRAP_COVERAGE_THRESHOLD = 0.5;

async function testKeyboardTrap(page: Page, screenshotDir: string): Promise<TestResult> {
  try {
    const focusableElements = await page.$$('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])');

    if (focusableElements.length === 0) {
      return {
        criterion: "2.1.2",
        name: "キーボードトラップ",
        status: "warning",
        source: "自動判定(Interactive)",
        details: "フォーカス可能な要素が見つかりませんでした。",
      };
    }

    // 最初の要素にフォーカス
    await focusableElements[0].focus();
    const visitedElements = new Set<string>();

    // Tab キーを押してフォーカスを移動
    // 要素数が少ない場合は最低10回、多い場合は要素数の2倍まで試行
    let maxIterations = Math.max(20, focusableElements.length * 2 + 20);
    let currentIteration = 0;
    let consecutiveSameElement = 0;
    let lastElementId: string | null = null;

    while (currentIteration < maxIterations) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(50);

      const activeElementId = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        // より詳細なID生成（位置情報も含める）
        const rect = el.getBoundingClientRect();
        return `${el.tagName}${el.id ? `#${el.id}` : ""}${el.className ? `.${el.className.split(" ")[0]}` : ""}@${Math.round(rect.top)},${Math.round(rect.left)}`;
      });

      if (!activeElementId) break;

      // 同じ要素に連続して留まっている場合（トラップの可能性）
      if (activeElementId === lastElementId) {
        consecutiveSameElement++;
        if (consecutiveSameElement >= 3) {
          return {
            criterion: "2.1.2",
            name: "キーボードトラップ",
            status: "fail",
            source: "自動判定(Interactive)",
            details: "キーボードトラップが検出されました。同じ要素から移動できません。",
          };
        }
      } else {
        consecutiveSameElement = 0;
      }

      lastElementId = activeElementId;

      if (visitedElements.has(activeElementId)) {
        // 訪問済みの要素に戻った。
        // ⚠️ これを無条件に「ループ完了（正常）」としてはならない。
        //    ページ全体の操作可能要素のごく一部しか巡回していない状態で循環が閉じるのは、
        //    「そこから他の部分へ出られない」＝キーボードトラップそのものである。
        const coverage = visitedElements.size / focusableElements.length;
        if (coverage < TRAP_COVERAGE_THRESHOLD) {
          return {
            criterion: "2.1.2",
            name: "キーボードトラップ",
            status: "fail",
            source: "自動判定(Interactive)",
            details:
              `キーボードトラップの疑いがあります。操作可能な要素 ${focusableElements.length} 個のうち ` +
              `${visitedElements.size} 個（${Math.round(coverage * 100)}%）を巡回した時点で循環が閉じました。` +
              `ページの他の部分へキーボードで到達できない可能性があります。`,
          };
        }
        // 十分に巡回したうえでの循環 = 正常なループ完了
        break;
      }

      visitedElements.add(activeElementId);
      currentIteration++;
    }

    // 要素数より明らかに多く移動している場合はトラップの可能性
    if (currentIteration >= maxIterations && visitedElements.size < focusableElements.length) {
      return {
        criterion: "2.1.2",
        name: "キーボードトラップ",
        status: "fail",
        source: "自動判定(Interactive)",
        details: `キーボードトラップの可能性があります。${maxIterations}回移動しても循環が完了しませんでした。`,
      };
    }

    // 巡回が十分でないまま終了した場合は「合格」を出さない。
    // 見ていない範囲を「問題なし」と報告することは、間違った合格になる。
    const finalCoverage = visitedElements.size / focusableElements.length;
    if (finalCoverage < TRAP_COVERAGE_THRESHOLD) {
      return {
        criterion: "2.1.2",
        name: "キーボードトラップ",
        status: "warning",
        source: "自動判定(Interactive)",
        details:
          `判定できませんでした。操作可能な要素 ${focusableElements.length} 個のうち ` +
          `${visitedElements.size} 個（${Math.round(finalCoverage * 100)}%）までしか巡回できていません。目視確認が必要です。`,
      };
    }

    return {
      criterion: "2.1.2",
      name: "キーボードトラップ",
      status: "pass",
      source: "自動判定(Interactive)",
      details: `キーボードトラップは検出されませんでした。操作可能な要素 ${focusableElements.length} 個のうち ${visitedElements.size} 個（${Math.round(finalCoverage * 100)}%）を巡回しました。`,
    };
  } catch (error) {
    return {
      criterion: "2.1.2",
      name: "キーボードトラップ",
      status: "warning",
      source: "自動判定(Interactive)",
      details: `テスト実行中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 2.4.11 フォーカス不明瞭化防止
 * fixed/sticky要素によってフォーカス要素が隠れないかスクリーンショットで確認
 */
async function testFocusNotObscured(page: Page, screenshotDir: string): Promise<TestResult> {
  const screenshots: string[] = [];

  try {
    const focusableElements = await page.$$('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])');

    if (focusableElements.length === 0) {
      return {
        criterion: "2.4.11",
        name: "フォーカス不明瞭化防止",
        status: "warning",
        source: "自動判定(Interactive)",
        details: "フォーカス可能な要素が見つかりませんでした。",
      };
    }

    // fixed/sticky要素を computedStyle で検出（CSSクラス経由の指定も含む）
    const hasFixedElements = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*')).some(el => {
        const pos = getComputedStyle(el).position;
        return pos === 'fixed' || pos === 'sticky';
      });
    });

    if (!hasFixedElements) {
      return {
        criterion: "2.4.11",
        name: "フォーカス不明瞭化防止",
        status: "pass",
        source: "自動判定(Interactive)",
        details: "position: fixed または sticky の要素が見つかりませんでした。フォーカスの不明瞭化のリスクはありません。",
      };
    }

    // サンプリングして確認
    const sampleSize = Math.min(10, focusableElements.length);
    const sampleIndices = Array.from(
      { length: sampleSize },
      (_, i) => Math.floor((i * focusableElements.length) / sampleSize)
    );

    let obscuredCount = 0;

    for (const index of sampleIndices) {
      const element = focusableElements[index];
      await element.focus();
      await element.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);

      const screenshotPath = join(screenshotDir, `focus-obscured-${index}.png`);
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);

      // フォーカス要素が他の要素に覆われているかチェック
      const isObscured = await element.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const topElement = document.elementFromPoint(centerX, centerY);
        return topElement !== el && !el.contains(topElement);
      });

      if (isObscured) {
        obscuredCount++;
      }
    }

    if (obscuredCount === 0) {
      // fixed/sticky 要素が存在する場合、隠れが起きるかはスクロール位置に依存する。
      // scrollIntoViewIfNeeded 後の中心点サンプル確認だけでは全スクロール位置を検証できて
      // いないため、pass は出さず warning（未確認）に倒す。
      return {
        criterion: "2.4.11",
        name: "フォーカス不明瞭化防止",
        status: "warning",
        source: "自動判定(Interactive)",
        details: `fixed/sticky 要素が存在します。サンプル${sampleSize}個の確認ではフォーカス要素の隠れは検出されませんでしたが、すべてのスクロール位置は検証できないため目視確認が必要です。`,
        screenshots,
      };
    } else {
      return {
        criterion: "2.4.11",
        name: "フォーカス不明瞭化防止",
        status: "fail",
        source: "自動判定(Interactive)",
        details: `${sampleSize}個中${obscuredCount}個の要素でフォーカスが他の要素に覆われています。`,
        screenshots,
      };
    }
  } catch (error) {
    return {
      criterion: "2.4.11",
      name: "フォーカス不明瞭化防止",
      status: "warning",
      source: "自動判定(Interactive)",
      details: `テスト実行中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
      screenshots,
    };
  }
}

/**
 * 1.4.10 リフロー
 * ビューポートを320x256pxに変更し、横スクロールバーが発生しないか確認
 */
async function testReflow(page: Page, screenshotDir: string): Promise<TestResult> {
  const screenshots: string[] = [];

  try {
    // 320x256px に変更
    await page.setViewportSize({ width: 320, height: 256 });
    await page.waitForTimeout(500); // レンダリングを待つ

    const screenshotPath = join(screenshotDir, "reflow-320x256.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshots.push(screenshotPath);

    // 横スクロールバーの有無を確認
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    // ビューポートを元に戻す
    await page.setViewportSize({ width: 1280, height: 720 });

    if (hasHorizontalScroll) {
      return {
        criterion: "1.4.10",
        name: "リフロー",
        status: "fail",
        source: "自動判定(Interactive)",
        details: "320x256pxで横スクロールバーが発生しました。リフローの要件を満たしていません。",
        screenshots,
      };
    }

    return {
      criterion: "1.4.10",
      name: "リフロー",
      status: "pass",
      source: "自動判定(Interactive)",
      details: "320x256pxで横スクロールバーは発生しませんでした。",
      screenshots,
    };
  } catch (error) {
    // ビューポートを元に戻す
    await page.setViewportSize({ width: 1280, height: 720 });

    return {
      criterion: "1.4.10",
      name: "リフロー",
      status: "warning",
      source: "自動判定(Interactive)",
      details: `テスト実行中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
      screenshots,
    };
  }
}

/**
 * 1.3.4 表示の向き
 * portrait/landscape両方でスクリーンショットを取得し、レイアウト崩れがないか確認
 */
async function testOrientation(page: Page, screenshotDir: string): Promise<TestResult> {
  const screenshots: string[] = [];

  try {
    // Portrait (縦向き): 375x667
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);
    const portraitPath = join(screenshotDir, "orientation-portrait.png");
    await page.screenshot({ path: portraitPath, fullPage: true });
    screenshots.push(portraitPath);

    // Landscape (横向き): 667x375
    await page.setViewportSize({ width: 667, height: 375 });
    await page.waitForTimeout(500);
    const landscapePath = join(screenshotDir, "orientation-landscape.png");
    await page.screenshot({ path: landscapePath, fullPage: true });
    screenshots.push(landscapePath);

    // ビューポートを元に戻す
    await page.setViewportSize({ width: 1280, height: 720 });

    // この基準は視覚的な判定が必要なため、warningを返す
    return {
      criterion: "1.3.4",
      name: "表示の向き",
      status: "warning",
      source: "自動判定(Interactive)",
      details: "portrait/landscapeのスクリーンショットを取得しました。レイアウト崩れがないか目視確認が必要です。",
      screenshots,
    };
  } catch (error) {
    await page.setViewportSize({ width: 1280, height: 720 });

    return {
      criterion: "1.3.4",
      name: "表示の向き",
      status: "warning",
      source: "自動判定(Interactive)",
      details: `テスト実行中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
      screenshots,
    };
  }
}

/**
 * 1.4.4 テキストサイズ変更
 * 200%ズームでスクリーンショットを取得し、テキストの切れや重なりがないか確認
 */
async function testTextResize(page: Page, screenshotDir: string): Promise<TestResult> {
  const screenshots: string[] = [];

  try {
    // 200%ズーム
    await page.evaluate(() => {
      document.body.style.zoom = "2.0";
    });
    await page.waitForTimeout(500);

    const screenshotPath = join(screenshotDir, "text-resize-200.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshots.push(screenshotPath);

    // overflow: hidden によるテキスト切れをチェック
    const hasTextClipping = await page.evaluate(() => {
      const elements = document.querySelectorAll("*");
      let clippingCount = 0;

      elements.forEach((el) => {
        const styles = window.getComputedStyle(el);
        if (styles.overflow === "hidden" && el.scrollHeight > el.clientHeight) {
          clippingCount++;
        }
      });

      return clippingCount > 0;
    });

    // ズームを元に戻す
    await page.evaluate(() => {
      document.body.style.zoom = "1.0";
    });

    if (hasTextClipping) {
      return {
        criterion: "1.4.4",
        name: "テキストサイズ変更",
        status: "fail",
        source: "自動判定(Interactive)",
        details: "200%ズーム時にテキストの切れが検出されました。overflow: hidden による切り取りが発生しています。",
        screenshots,
      };
    }

    return {
      criterion: "1.4.4",
      name: "テキストサイズ変更",
      status: "warning",
      source: "自動判定(Interactive)",
      details: "200%ズームのスクリーンショットを取得しました。テキストの重なりや読みづらさがないか目視確認が推奨されます。",
      screenshots,
    };
  } catch (error) {
    await page.evaluate(() => {
      document.body.style.zoom = "1.0";
    });

    return {
      criterion: "1.4.4",
      name: "テキストサイズ変更",
      status: "warning",
      source: "自動判定(Interactive)",
      details: `テスト実行中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
      screenshots,
    };
  }
}

/**
 * DOM スナップショット（3.2.1 / 3.2.2 の変化検出用）。
 * body の innerHTML ハッシュと可視要素数を記録し、操作前後で比較する。
 * - innerHTML ハッシュ: 要素の追加・削除・属性変更（class / style 切り替えによる表示変更を含む）を検出
 * - 可視要素数: DOM 変更を伴わずに CSS だけで表示状態が変わるケースの補助検出
 */
interface DomSnapshot {
  htmlHash: number;
  visibleCount: number;
}

async function takeDomSnapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate(() => {
    const html = document.body ? document.body.innerHTML : "";
    // djb2 xor 変種の単純ハッシュ（前後比較にのみ使用）
    let hash = 5381;
    for (let i = 0; i < html.length; i++) {
      hash = ((hash * 33) ^ html.charCodeAt(i)) | 0;
    }
    let visibleCount = 0;
    document.querySelectorAll("*").forEach((el) => {
      if ((el as HTMLElement).offsetParent !== null) visibleCount++;
    });
    return { htmlHash: hash, visibleCount };
  });
}

function snapshotChanged(before: DomSnapshot, after: DomSnapshot): boolean {
  return before.htmlHash !== after.htmlHash || before.visibleCount !== after.visibleCount;
}

/** 要素の簡易セレクタ表記（結果レポートでの特定用） */
async function describeElement(element: ElementHandle<SVGElement | HTMLElement>): Promise<string> {
  return element
    .evaluate((node) => {
      const tag = node.tagName.toLowerCase();
      const id = node.id ? `#${node.id}` : "";
      const cls = node.className
        ? `.${String(node.className).split(" ").filter(Boolean).slice(0, 2).join(".")}`
        : "";
      return `${tag}${id}${cls}`;
    })
    .catch(() => "(不明な要素)");
}

/**
 * 3.2.1 フォーカス時の挙動
 * フォーカス前後でURL/DOMを比較し、予期しないページ遷移やコンテンツ変化がないか確認
 */
async function testOnFocus(page: Page, screenshotDir: string): Promise<TestResult> {
  try {
    const focusableElements = await page.$$('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])');

    if (focusableElements.length === 0) {
      return {
        criterion: "3.2.1",
        name: "フォーカス時の挙動",
        status: "warning",
        source: "自動判定(Interactive)",
        details: "フォーカス可能な要素が見つかりませんでした。",
      };
    }

    let urlChanges = 0;
    const domChangedSelectors: string[] = [];

    // サンプリング
    const sampleSize = Math.min(10, focusableElements.length);
    const sampleIndices = Array.from(
      { length: sampleSize },
      (_, i) => Math.floor((i * focusableElements.length) / sampleSize)
    );

    for (const index of sampleIndices) {
      const element = focusableElements[index];
      const urlBefore = page.url();
      const domBefore = await takeDomSnapshot(page);

      await element.focus();
      await page.waitForTimeout(100);

      const urlAfter = page.url();

      if (urlBefore !== urlAfter) {
        // ページ遷移が起きた時点で fail 確定。遷移後の古い要素ハンドルに focus し続けると
        // 例外で warning に化けてしまう（fail の取りこぼし）ため、ここで打ち切る。
        urlChanges++;
        break;
      }

      const domAfter = await takeDomSnapshot(page);
      if (snapshotChanged(domBefore, domAfter)) {
        domChangedSelectors.push(await describeElement(element));
      }
    }

    if (urlChanges > 0) {
      return {
        criterion: "3.2.1",
        name: "フォーカス時の挙動",
        status: "fail",
        source: "自動判定(Interactive)",
        details: `${sampleSize}個中${urlChanges}個の要素でフォーカス時にページ遷移が発生しました。`,
      };
    }

    if (domChangedSelectors.length > 0) {
      // DOM の変化 = コンテキストの変化とは限らない（装飾クラスの付与等もありうる）ため、
      // fail ではなく warning（未確認）とし、目視確認に回す。
      return {
        criterion: "3.2.1",
        name: "フォーカス時の挙動",
        status: "warning",
        source: "自動判定(Interactive)",
        details: `${sampleSize}個中${domChangedSelectors.length}個の要素でフォーカス前後に DOM の変化を検出しました（${domChangedSelectors.join(", ")}）。ポップアップ表示などコンテキストの変化にあたらないか目視確認が必要です。`,
      };
    }

    return {
      criterion: "3.2.1",
      name: "フォーカス時の挙動",
      status: "pass",
      source: "自動判定(Interactive)",
      details: `${sampleSize}個の要素でフォーカス前後の URL・DOM に変化がないことを確認しました。`,
    };
  } catch (error) {
    return {
      criterion: "3.2.1",
      name: "フォーカス時の挙動",
      status: "warning",
      source: "自動判定(Interactive)",
      details: `テスト実行中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 3.2.2 入力時の挙動
 * テキスト入力時にURL/DOMを比較し、自動送信などの予期しない変化がないか確認
 */
async function testOnInput(page: Page, screenshotDir: string): Promise<TestResult> {
  try {
    const inputElements = await page.$$('input[type="text"], input[type="email"], input[type="search"], textarea');

    if (inputElements.length === 0) {
      return {
        criterion: "3.2.2",
        name: "入力時の挙動",
        status: "pass",
        source: "自動判定(Interactive)",
        details: "テキスト入力フィールドが見つかりませんでした。該当コンテンツなし。",
      };
    }

    // 表示されている（visible）要素のみをフィルタリング
    const visibleElements: typeof inputElements = [];
    for (const element of inputElements) {
      const isVisible = await element.isVisible();
      if (isVisible) {
        visibleElements.push(element);
      }
    }

    if (visibleElements.length === 0) {
      return {
        criterion: "3.2.2",
        name: "入力時の挙動",
        status: "pass",
        source: "自動判定(Interactive)",
        details: "表示されているテキスト入力フィールドが見つかりませんでした。該当コンテンツなし。",
      };
    }

    let urlChanges = 0;
    let testedCount = 0;
    const domChangedSelectors: string[] = [];

    // サンプリング
    const sampleSize = Math.min(5, visibleElements.length);
    const sampleIndices = Array.from(
      { length: sampleSize },
      (_, i) => Math.floor((i * visibleElements.length) / sampleSize)
    );

    for (const index of sampleIndices) {
      const element = visibleElements[index];

      try {
        const urlBefore = page.url();

        await element.focus();
        const domBefore = await takeDomSnapshot(page);
        await element.fill("test", { timeout: 5000 }); // タイムアウトを短く設定
        await page.waitForTimeout(500); // 自動送信を待つ

        const urlAfter = page.url();

        if (urlBefore !== urlAfter) {
          urlChanges++;
        } else {
          const domAfter = await takeDomSnapshot(page);
          if (snapshotChanged(domBefore, domAfter)) {
            domChangedSelectors.push(await describeElement(element));
          }
        }
        testedCount++;
      } catch (error) {
        // 個別の要素でエラーが発生しても継続
        continue;
      }
    }

    if (urlChanges > 0) {
      return {
        criterion: "3.2.2",
        name: "入力時の挙動",
        status: "fail",
        source: "自動判定(Interactive)",
        details: `${sampleSize}個中${urlChanges}個の入力フィールドで入力時にページ遷移が発生しました。`,
      };
    }

    if (testedCount < sampleSize) {
      // テストできなかったフィールドを「問題なし」と扱わない（間違った合格の防止）
      return {
        criterion: "3.2.2",
        name: "入力時の挙動",
        status: "warning",
        source: "自動判定(Interactive)",
        details: `${sampleSize}個中${testedCount}個の入力フィールドしかテストできませんでした。残りは目視確認が必要です。`,
      };
    }

    if (domChangedSelectors.length > 0) {
      // DOM の変化 = コンテキストの変化とは限らない（入力値のバリデーション表示等もありうる）ため、
      // fail ではなく warning（未確認）とし、目視確認に回す。
      return {
        criterion: "3.2.2",
        name: "入力時の挙動",
        status: "warning",
        source: "自動判定(Interactive)",
        details: `${sampleSize}個中${domChangedSelectors.length}個の入力フィールドで入力前後に DOM の変化を検出しました（${domChangedSelectors.join(", ")}）。フォーム自動送信・フォーカス移動などコンテキストの変化にあたらないか目視確認が必要です。`,
      };
    }

    return {
      criterion: "3.2.2",
      name: "入力時の挙動",
      status: "pass",
      source: "自動判定(Interactive)",
      details: `${sampleSize}個の入力フィールドで入力前後の URL・DOM に変化がないことを確認しました。`,
    };
  } catch (error) {
    return {
      criterion: "3.2.2",
      name: "入力時の挙動",
      status: "warning",
      source: "自動判定(Interactive)",
      details: `テスト実行中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function runInteractiveTests(options: CliArgs): Promise<void> {
  const { browser, page } = await launchStableBrowser();

  try {
    // スクリーンショットディレクトリを作成
    await mkdir(options.screenshotDir, { recursive: true });

    await gotoStable(page, options.url);

    const results: TestResult[] = [];

    // 各テストを実行
    results.push(await testFocusVisible(page, options.screenshotDir));
    results.push(await testFocusOrder(page, options.screenshotDir));
    results.push(await testKeyboardTrap(page, options.screenshotDir));
    results.push(await testFocusNotObscured(page, options.screenshotDir));
    results.push(await testReflow(page, options.screenshotDir));
    results.push(await testOrientation(page, options.screenshotDir));
    results.push(await testTextResize(page, options.screenshotDir));
    results.push(await testOnFocus(page, options.screenshotDir));
    results.push(await testOnInput(page, options.screenshotDir));

    const output: InteractiveTestOutput = {
      url: options.url,
      timestamp: new Date().toISOString(),
      results,
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await browser.close();
  }
}

const args = parseArgs();
runInteractiveTests(args).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
