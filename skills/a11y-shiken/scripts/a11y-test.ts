#!/usr/bin/env bun

import AxeBuilder from "@axe-core/playwright";
import { launchStableBrowser, gotoStable } from "./lib/stable-browser";

interface CliArgs {
  url: string;
  tags: string[];
  exclude: string[];
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0].startsWith("--")) {
    console.error("Usage: bun a11y-test.ts <URL> [--tags tag1,tag2] [--exclude selector1,selector2]");
    process.exit(1);
  }

  const url = args[0];
  let tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
  let exclude: string[] = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--tags" && args[i + 1]) {
      tags = args[i + 1].split(",");
      i++;
    } else if (args[i] === "--exclude" && args[i + 1]) {
      exclude = args[i + 1].split(",");
      i++;
    }
  }

  return { url, tags, exclude };
}

async function runAccessibilityTest(options: CliArgs) {
  const { browser, page } = await launchStableBrowser();

  try {
    await gotoStable(page, options.url);

    let builder = new AxeBuilder({ page }).withTags(options.tags);

    for (const selector of options.exclude) {
      builder = builder.exclude(selector);
    }

    const results = await builder.analyze();

    const output = {
      url: options.url,
      timestamp: new Date().toISOString(),
      summary: {
        violations: results.violations.length,
        passes: results.passes.length,
        incomplete: results.incomplete.length,
        inapplicable: results.inapplicable.length,
      },
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        tags: v.tags,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          target: n.target,
          failureSummary: n.failureSummary,
        })),
      })),
      incomplete: results.incomplete.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        tags: v.tags,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          target: n.target,
          failureSummary: n.failureSummary,
        })),
      })),
      passes: results.passes.map((v) => ({
        id: v.id,
        description: v.description,
        tags: v.tags,
      })),
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await browser.close();
  }
}

const args = parseArgs();
runAccessibilityTest(args).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
