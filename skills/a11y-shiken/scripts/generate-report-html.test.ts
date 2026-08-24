import { describe, expect, test } from "bun:test";
import {
  buildHtml,
  escapeForScriptTag,
  parsePageArg,
  stripSourceMappingUrl,
} from "./generate-report-html";

const TEMPLATE = `<!DOCTYPE html>
<html lang="ja">
<head>
  <!-- __LIBS_PLACEHOLDER__ -->
</head>
<body>
<script>
  // __DATA_PLACEHOLDER__
  const nav = document.getElementById('nav');
</script>
</body>
</html>`;

const build = (over: Partial<Parameters<typeof buildHtml>[0]> = {}) =>
  buildHtml({
    template: TEMPLATE,
    libraries: ["window.marked = {};"],
    pages: [{ label: "TOP", file: "./markdown/TOP.md" }],
    contents: { "./markdown/TOP.md": "# 見出し" },
    ...over,
  });

describe("escapeForScriptTag", () => {
  test("[正常] 本文中の </script> をエスケープし、script 要素が途中で閉じないこと", () => {
    const escaped = escapeForScriptTag('const s = "</script>";');
    expect(escaped).not.toContain("</script");
    expect(escaped).toContain("<\\/script");
  });

  test("[正常] 大文字や属性つきの終了タグもエスケープされること", () => {
    expect(escapeForScriptTag("</SCRIPT >")).not.toMatch(/<\/script/i);
  });
});

describe("stripSourceMappingUrl", () => {
  test("[正常] 末尾の sourceMappingURL コメントが取り除かれること", () => {
    const stripped = stripSourceMappingUrl("var a = 1;\n//# sourceMappingURL=lib.js.map\n");
    expect(stripped).not.toContain("sourceMappingURL");
    expect(stripped).toContain("var a = 1;");
  });

  test("[正常] コード中の sourceMappingURL という文字列は残ること", () => {
    const code = 'var msg = "sourceMappingURL is here";';
    expect(stripSourceMappingUrl(code)).toBe(code);
  });
});

describe("parsePageArg", () => {
  test("[正常] ラベルとパスに分解されること", () => {
    expect(parsePageArg("TOP=./markdown/TOP.md")).toEqual({
      label: "TOP",
      file: "./markdown/TOP.md",
    });
  });

  test("[正常] ラベルに = が含まれる場合、最後の = で分割されること", () => {
    expect(parsePageArg("a=b=./x.md")).toEqual({ label: "a=b", file: "./x.md" });
  });

  test("[異常] = がない指定でエラーが送出されること", () => {
    expect(() => parsePageArg("TOP")).toThrow(/形式が不正/);
  });
});

describe("buildHtml", () => {
  test("[正常] 生成された HTML に fetch が含まれず、本文が埋め込まれていること", () => {
    const html = build();
    expect(html).not.toContain("await fetch(");
    expect(html).toContain("const pageContents = ");
    expect(html).toContain("# 見出し");
  });

  test("[正常] CDN 参照が残らず、ライブラリ本体が script 要素として埋め込まれていること", () => {
    const html = build();
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).toContain("window.marked = {};");
  });

  test("[正常] プレースホルダーが残らないこと", () => {
    const html = build();
    expect(html).not.toContain("__LIBS_PLACEHOLDER__");
    expect(html).not.toContain("__DATA_PLACEHOLDER__");
  });

  test("[正常] const pages 宣言が二重に生成されないこと", () => {
    const html = build();
    expect(html.match(/const pages = /g)).toHaveLength(1);
  });

  test("[正常] 本文に </script> を含むレポートでも script 要素が閉じないこと", () => {
    const html = build({
      contents: { "./markdown/TOP.md": '修正前: `<button></button></script>`' },
    });
    // 埋め込み部より後ろにある終了タグは、テンプレート由来の 1 個だけであること
    const dataAt = html.indexOf("const pageContents");
    expect(html.slice(dataAt).match(/<\/script>/g)).toHaveLength(1);
  });

  test("[正常] ライブラリの sourceMappingURL が除去されていること", () => {
    const html = build({ libraries: ["var a = 1;\n//# sourceMappingURL=marked.umd.js.map"] });
    expect(html).not.toContain("sourceMappingURL");
  });

  test("[異常] ライブラリ用プレースホルダーがないテンプレートでエラーが送出されること", () => {
    expect(() => build({ template: "<html><script>// __DATA_PLACEHOLDER__</script></html>" })).toThrow(
      /__LIBS_PLACEHOLDER__/
    );
  });

  test("[異常] データ用プレースホルダーがないテンプレートでエラーが送出されること", () => {
    expect(() => build({ template: "<html><!-- __LIBS_PLACEHOLDER__ --></html>" })).toThrow(
      /__DATA_PLACEHOLDER__/
    );
  });
});
