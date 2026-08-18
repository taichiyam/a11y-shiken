/**
 * テスト結果の実行ごとのブレ（非決定性）を抑えるための共通ブラウザセットアップ。
 *
 * ブレの主な原因と対策:
 * - CSSアニメーション・トランジション動作中の計測
 *     → prefers-reduced-motion + アニメーション凍結CSSを注入して停止
 * - networkidle 待ちのタイミング差で lazy-load / 動的コンテンツの状態が毎回変わる
 *     → load 後に networkidle を best-effort で待ち、全ページスクロールで
 *       lazy-load を確実に発火させてから先頭に戻す決定的な手順に統一
 * - Web フォントのロード前後で文字サイズ・コントラスト計測が変わる
 *     → document.fonts.ready を待機
 * - 環境差（タイムゾーン・デバイススケール・配色）
 *     → コンテキストオプションで固定
 *
 * 全テストスクリプト（a11y-test / a11y-visual-test / a11y-interactive-test /
 * a11y-tree）はこのモジュール経由でページを開くこと。
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

/** 全スクリプト共通のコンテキスト設定（環境要因の固定） */
export const STABLE_CONTEXT_OPTIONS = {
  locale: "ja-JP",
  viewport: { width: 1280, height: 720 },
  timezoneId: "Asia/Tokyo",
  deviceScaleFactor: 1,
  colorScheme: "light" as const,
  // カルーセル自動再生・CSSアニメーションを尊重サイト側で停止させる
  reducedMotion: "reduce" as const,
};

/**
 * アニメーション・トランジションを即座に終了状態へ送るCSS。
 * 途中フレームの色・位置・透明度を計測してしまうブレを排除する。
 * （Playwright スクリーンショットの animations:"disabled" と同等の定番手法）
 */
const FREEZE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
    scroll-behavior: auto !important;
  }
`;

export interface StableBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/** 決定的な設定でブラウザ・コンテキスト・ページを起動する */
export async function launchStableBrowser(): Promise<StableBrowser> {
  // CI 等で Playwright 管理外の Chromium を使う場合の逃げ道
  const executablePath = process.env.A11Y_CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext(STABLE_CONTEXT_OPTIONS);
  const page = await context.newPage();
  return { browser, context, page };
}

/**
 * ページ全体を下までスクロールして lazy-load コンテンツを発火させる。
 * 無限スクロールページで止まらなくならないよう最大30画面分で打ち切る。
 */
async function scrollFullPage(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const step = window.innerHeight;
      let y = 0;
      for (let i = 0; i < 30; i++) {
        y += step;
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 150));
        if (y >= document.documentElement.scrollHeight - window.innerHeight) break;
      }
    })
    .catch(() => {});
}

/**
 * ページを決定的な手順で開き、DOM・スタイルが安定した状態にして返す。
 *
 * 手順（固定）:
 * 1. load イベントまで待機（networkidle 単独待ちはアナリティクス等の常時通信で
 *    タイムアウトしやすく、それ自体がブレ要因になるため使わない）
 * 2. networkidle を best-effort で待機（10秒で諦めて続行）
 * 3. 全ページスクロールで lazy-load を発火 → ページ先頭へ戻す
 * 4. Web フォントのロード完了を待機
 * 5. アニメーション凍結CSSを注入
 * 6. 固定の安定待ち（1秒）
 */
export async function gotoStable(page: Page, url: string, timeout = 30000): Promise<void> {
  await page.goto(url, { waitUntil: "load", timeout });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await scrollFullPage(page);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page
    .evaluate(() => (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready)
    .catch(() => {});
  await page.addStyleTag({ content: FREEZE_ANIMATIONS_CSS }).catch(() => {});
  await page.waitForTimeout(1000);
}
