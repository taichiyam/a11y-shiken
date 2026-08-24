import { describe, expect, test } from "bun:test";
import {
  assertEmbeddableScript,
  buildHtml,
  escapeJsonForScriptTag,
  parsePageArg,
  stripSourceMappingUrl,
} from "./generate-report-html";

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

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

describe("escapeJsonForScriptTag", () => {
  test("[正常] 終了タグの < がエスケープされ、script 要素が途中で閉じないこと", () => {
    const escaped = escapeJsonForScriptTag('"</script>"');
    expect(escaped).not.toContain("<");
    expect(escaped).toContain("\\u003C");
  });

  test("[正常] <!--<script> がエスケープされること（double escaped state に入らせない）", () => {
    // </script だけを潰す実装ではこのパターンを防げず、ページ全体が描画されなくなる
    const escaped = escapeJsonForScriptTag('"<!--<script>"');
    expect(escaped).not.toContain("<");
  });

  test("[正常] 行区切り文字 U+2028 / U+2029 がエスケープされること", () => {
    const escaped = escapeJsonForScriptTag(`"a${LS}b${PS}c"`);
    expect(escaped).not.toContain(LS);
    expect(escaped).not.toContain(PS);
    expect(escaped).toContain("\\u2028");
    expect(escaped).toContain("\\u2029");
  });

  test("[正常] エスケープ後も JSON として同じ値に戻ること", () => {
    const original = { text: `<!--<script>${LS}</script>` };
    const escaped = escapeJsonForScriptTag(JSON.stringify(original));
    expect(JSON.parse(escaped)).toEqual(original);
  });
});

describe("assertEmbeddableScript", () => {
  test("[正常] 通常の JavaScript は通ること", () => {
    expect(() => assertEmbeddableScript("var a = 1 < 2;", "lib")).not.toThrow();
  });

  test("[異常] </script> を含むライブラリが拒否されること", () => {
    expect(() => assertEmbeddableScript('var s = "</script>";', "lib")).toThrow(/lib/);
  });

  test("[正常] <!-- を含むが <script を含まないライブラリは通ること", () => {
    // marked は HTML コメントを扱うため <!-- を含む。単体では閉じタグは効くので埋め込める
    expect(() => assertEmbeddableScript('var re = /<!--/;', "lib")).not.toThrow();
  });

  test("[異常] <!-- と <script を両方含むライブラリが拒否されること", () => {
    expect(() => assertEmbeddableScript('var a = "<!--"; var b = "<script";', "lib")).toThrow(/lib/);
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

  test("[正常] ブロックコメント形式も取り除かれること", () => {
    const stripped = stripSourceMappingUrl("var a = 1;\n/*# sourceMappingURL=lib.js.map */\n");
    expect(stripped).not.toContain("sourceMappingURL");
  });

  test("[正常] 直前の空行が巻き込まれないこと", () => {
    // 行頭の空白に \s を使うと改行まで食べて前の空行を消してしまう
    const stripped = stripSourceMappingUrl("var a = 1;\n\n//# sourceMappingURL=lib.js.map");
    expect(stripped).toBe("var a = 1;\n\n");
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

  test("[正常] 本文に <!--<script> を含むレポートでも埋め込み部に生の < が出ないこと", () => {
    // </script だけを潰す実装だと HTML の script tokenizer が double escaped state に入り、
    // 以降の </script> が閉じタグとして扱われずページ全体が描画されなくなる
    const html = build({
      contents: { "./markdown/TOP.md": "コメントアウトされた例: <!--<script>alert(1)</script>-->" },
    });
    const dataAt = html.indexOf("const pageContents");
    const embedded = html.slice(dataAt, html.indexOf("</script>", dataAt));
    expect(embedded).not.toContain("<");
  });

  test("[正常] ラベル経由でも生の < が埋め込まれないこと", () => {
    const html = build({ pages: [{ label: "<!--<script>", file: "./markdown/TOP.md" }] });
    const dataAt = html.indexOf("const pages");
    const embedded = html.slice(dataAt, html.indexOf("</script>", dataAt));
    expect(embedded).not.toContain("<");
  });

  test("[正常] 本文の行区切り文字がエスケープされること", () => {
    const html = build({ contents: { "./markdown/TOP.md": `見出し${LS}本文` } });
    expect(html).not.toContain(LS);
    expect(html).toContain("\\u2028");
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
