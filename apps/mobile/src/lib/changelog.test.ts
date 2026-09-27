import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import type { GithubReleaseNote } from "./changelog.ts";

// Node's test runner does not resolve extensionless imports. The app modules stay
// extensionless for Metro; this hook only applies to the dynamic import below.
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\\.(?:ts|js|json|mjs|cjs)$/.test(specifier)) {
    return nextResolve(specifier + ".ts", context);
  }
  return nextResolve(specifier, context);
}`),
  { parentURL: import.meta.url },
);

const {
  changelogFromGithubPayload,
  changelogHref,
  changelogMark,
  isChangelogReleaseList,
  parseChangelogBody,
  parseChangelogInlines,
} = await import("./changelog.ts");

const V011 = [
  "Lists and settings share one row. The compact dock is gone. Titles sit on the icon column, and a subtitle sits beside the title.",
  "",
  "Profile photos upload and show. Pull to refresh finishes when you lift your finger.",
  "",
  "Install a server you host with `curl -fsSL https://ordo.axolet.com/install | bash`. Setup explains each question and shows a summary before it installs. Uninstall stops the server and removes the install after you confirm. Update with `./scripts/deploy-server update --yes --release v0.1.1`.",
].join("\n");

test("release notes stay paragraphs, and commands stay code", () => {
  const blocks = parseChangelogBody(V011);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]?.type, "paragraph");
  assert.equal(blocks[2]?.type, "paragraph");
  if (blocks[2]?.type !== "paragraph") return;
  const codes = blocks[2].inlines.filter((part) => part.type === "code");
  assert.deepEqual(
    codes.map((part) => (part.type === "code" ? part.text : "")),
    [
      "curl -fsSL https://ordo.axolet.com/install | bash",
      "./scripts/deploy-server update --yes --release v0.1.1",
    ],
  );
  assert.equal(
    blocks[2].inlines.some((part) => part.type === "link"),
    false,
  );
});

test("wrapped lines join into one paragraph", () => {
  const blocks = parseChangelogBody("Titles sit on\nthe icon column.\n\nNext.");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.type, "paragraph");
  if (blocks[0]?.type !== "paragraph") return;
  assert.equal(blocks[0].inlines[0]?.type, "text");
  if (blocks[0].inlines[0]?.type !== "text") return;
  assert.equal(blocks[0].inlines[0].text, "Titles sit on the icon column.");
});

test("lists, headings, and rules", () => {
  const blocks = parseChangelogBody(
    ["## Reading", "", "- Shared rows", "* Profile photos", "1. Pull to refresh", "", "---", "", "Done."].join(
      "\n",
    ),
  );
  assert.equal(blocks[0]?.type, "heading");
  if (blocks[0]?.type === "heading") {
    assert.equal(blocks[0].level, 2);
    assert.deepEqual(blocks[0].inlines, [{ type: "text", text: "Reading" }]);
  }
  assert.equal(blocks[1]?.type, "list");
  if (blocks[1]?.type === "list") {
    assert.equal(blocks[1].items.length, 3);
    assert.equal(blocks[1].items[0]?.kind, "bullet");
    assert.equal(blocks[1].items[2]?.kind, "number");
    assert.equal(blocks[1].items[2]?.index, 1);
  }
  assert.equal(blocks[2]?.type, "rule");
  assert.equal(blocks[3]?.type, "paragraph");
});

test("bold, markdown links, and bare https links", () => {
  const inlines = parseChangelogInlines(
    "See **rows** and [the site](https://ordo.axolet.com/terms) or https://ordo.axolet.com/install.",
  );
  assert.deepEqual(inlines, [
    { type: "text", text: "See " },
    { type: "strong", inlines: [{ type: "text", text: "rows" }] },
    { type: "text", text: " and " },
    {
      type: "link",
      href: "https://ordo.axolet.com/terms",
      inlines: [{ type: "text", text: "the site" }],
    },
    { type: "text", text: " or " },
    {
      type: "link",
      href: "https://ordo.axolet.com/install",
      inlines: [{ type: "text", text: "https://ordo.axolet.com/install" }],
    },
    { type: "text", text: "." },
  ]);
});

test("emphasis, strike, and escapes", () => {
  assert.deepEqual(parseChangelogInlines("a *lean* **bold** ***both*** ~~gone~~ snake_case \\*nope\\*"), [
    { type: "text", text: "a " },
    { type: "em", inlines: [{ type: "text", text: "lean" }] },
    { type: "text", text: " " },
    { type: "strong", inlines: [{ type: "text", text: "bold" }] },
    { type: "text", text: " " },
    {
      type: "em",
      inlines: [{ type: "strong", inlines: [{ type: "text", text: "both" }] }],
    },
    { type: "text", text: " " },
    { type: "del", inlines: [{ type: "text", text: "gone" }] },
    { type: "text", text: " snake_case *nope*" },
  ]);
});

test("autolinks, reference links, and raw html stay plain", () => {
  const blocks = parseChangelogBody(
    ["See [rows] and <https://ordo.axolet.com/install>.", "", "<b>not html</b>", "", "[rows]: https://ordo.axolet.com/terms"].join(
      "\n",
    ),
  );
  assert.equal(blocks.length, 2);
  if (blocks[0]?.type !== "paragraph" || blocks[1]?.type !== "paragraph") return;
  assert.equal(blocks[0].inlines[1]?.type, "link");
  if (blocks[0].inlines[1]?.type === "link") {
    assert.equal(blocks[0].inlines[1].href, "https://ordo.axolet.com/terms");
  }
  assert.equal(blocks[0].inlines[3]?.type, "link");
  assert.deepEqual(blocks[1].inlines, [{ type: "text", text: "<b>not html</b>" }]);
});

test("fenced code does not link urls, and quotes, tables, tasks, and images parse", () => {
  const blocks = parseChangelogBody(
    [
      "```bash",
      "curl https://ordo.axolet.com/install",
      "```",
      "",
      "> A note",
      "",
      "| Name | Count |",
      "| :--- | ---: |",
      "| rows | 2 |",
      "",
      "- [x] Shipped",
      "- [ ] Next",
      "  - Nested",
      "",
      "![Shot](https://ordo.axolet.com/a.png)",
      "",
      "![Local](http://example.com/a.png)",
      "",
      "Title",
      "=====",
      "",
      "Line one  ",
      "line two",
    ].join("\n"),
  );
  assert.equal(blocks[0]?.type, "code");
  if (blocks[0]?.type === "code") {
    assert.equal(blocks[0].lang, "bash");
    assert.equal(blocks[0].text, "curl https://ordo.axolet.com/install");
  }
  assert.equal(blocks[1]?.type, "quote");
  assert.equal(blocks[2]?.type, "table");
  if (blocks[2]?.type === "table") {
    assert.deepEqual(blocks[2].align, ["left", "right"]);
    assert.equal(blocks[2].rows.length, 1);
  }
  assert.equal(blocks[3]?.type, "list");
  if (blocks[3]?.type === "list") {
    assert.equal(blocks[3].items[0]?.kind, "task");
    assert.equal(blocks[3].items[0]?.checked, true);
    assert.equal(blocks[3].items[1]?.checked, false);
    const nested = blocks[3].items[1]?.blocks.find((block) => block.type === "list");
    assert.equal(nested?.type, "list");
  }
  assert.equal(blocks[4]?.type, "paragraph");
  if (blocks[4]?.type === "paragraph") {
    assert.deepEqual(blocks[4].inlines[0], {
      type: "image",
      alt: "Shot",
      href: "https://ordo.axolet.com/a.png",
    });
  }
  assert.equal(blocks[5]?.type, "paragraph");
  if (blocks[5]?.type === "paragraph") {
    assert.deepEqual(blocks[5].inlines, [{ type: "text", text: "Local" }]);
  }
  assert.equal(blocks[6]?.type, "heading");
  if (blocks[6]?.type === "heading") assert.equal(blocks[6].level, 1);
  assert.equal(blocks[7]?.type, "paragraph");
  if (blocks[7]?.type === "paragraph") {
    assert.deepEqual(
      blocks[7].inlines.map((part) => part.type),
      ["text", "break", "text"],
    );
  }
});

test("rejects unsafe links and keeps the label", () => {
  assert.equal(changelogHref("http://ordo.axolet.com"), null);
  assert.equal(changelogHref("https://user:pass@ordo.axolet.com"), null);
  assert.equal(changelogHref("javascript:alert(1)"), null);
  const inlines = parseChangelogInlines(
    "[click](http://ordo.axolet.com/terms) and [ok](https://user:pass@ordo.axolet.com/x)",
  );
  assert.deepEqual(inlines, [{ type: "text", text: "click and ok" }]);
});

test("blank notes produce no blocks", () => {
  assert.deepEqual(parseChangelogBody("  \n\n"), []);
});

test("orders published versions and drops drafts and other tags", () => {
  const notes: GithubReleaseNote[] = [
    { tag_name: "v0.1.0", published_at: "2026-09-26T18:15:57Z", body: "First", prerelease: false },
    { tag_name: "v0.2.0-beta.1", published_at: "2026-09-27T00:00:00Z", body: "Beta", prerelease: true },
    { tag_name: "v0.1.1", published_at: "2026-09-27T16:49:10Z", body: "Rows", prerelease: false },
    { tag_name: "dev", published_at: "2026-09-28T00:00:00Z", body: "Skip" },
    { tag_name: "v0.3.0", draft: true, published_at: "2026-09-28T00:00:00Z", body: "Hidden" },
    { tag_name: "v0.1.1", published_at: "2026-09-27T16:49:10Z", body: "Rows, revised", prerelease: false },
  ];
  const releases = changelogFromGithubPayload(notes);
  assert.deepEqual(
    releases.map((release) => release.version),
    ["0.2.0-beta.1", "0.1.1", "0.1.0"],
  );
  assert.equal(releases[1]?.body, "Rows, revised");
  assert.equal(releases[0]?.prerelease, true);
  assert.equal(releases[0]?.tagName, "v0.2.0-beta.1");
});

test("a suffix-less GitHub pre-release is still early", () => {
  const [release] = changelogFromGithubPayload([
    { tag_name: "v0.2.0", published_at: "2026-09-01T00:00:00Z", prerelease: true, body: "" },
  ]);
  assert.equal(release?.prerelease, true);
});

test("marks the installed build, then an offered update, then early access", () => {
  const stable = { version: "0.1.0", prerelease: false };
  const next = { version: "0.1.1", prerelease: false };
  const beta = { version: "0.2.0-beta.1", prerelease: true };
  assert.equal(changelogMark(stable, "0.1.0", "0.1.1"), "installed");
  assert.equal(changelogMark(next, "0.1.0", "0.1.1"), "available");
  assert.equal(changelogMark(beta, "0.1.0", "0.1.1"), "early");
  assert.equal(changelogMark(beta, "0.2.0-beta.1", null), "installed");
  assert.equal(changelogMark(next, "—", null), null);
  assert.equal(changelogMark(stable, "0.1.0", "0.1.0"), "installed");
});

test("cache rows need the fields the screen renders", () => {
  assert.equal(
    isChangelogReleaseList([
      {
        version: "0.1.1",
        tagName: "v0.1.1",
        publishedAt: "2026-09-27T16:49:10Z",
        prerelease: false,
        body: "Rows",
      },
    ]),
    true,
  );
  assert.equal(isChangelogReleaseList([{ version: "0.1.1" }]), false);
  assert.equal(isChangelogReleaseList(null), false);
});
