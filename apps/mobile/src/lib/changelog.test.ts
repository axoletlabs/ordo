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
  if (blocks[0]?.type === "heading") assert.equal(blocks[0].text, "Reading");
  assert.equal(blocks[1]?.type, "list");
  if (blocks[1]?.type === "list") assert.equal(blocks[1].items.length, 3);
  assert.equal(blocks[2]?.type, "paragraph");
});

test("bold, markdown links, and bare https links", () => {
  const inlines = parseChangelogInlines(
    "See **rows** and [the site](https://ordo.axolet.com/terms) or https://ordo.axolet.com/install.",
  );
  assert.deepEqual(inlines, [
    { type: "text", text: "See " },
    { type: "strong", text: "rows" },
    { type: "text", text: " and " },
    { type: "link", text: "the site", href: "https://ordo.axolet.com/terms" },
    { type: "text", text: " or " },
    { type: "link", text: "https://ordo.axolet.com/install", href: "https://ordo.axolet.com/install" },
    { type: "text", text: "." },
  ]);
});

test("rejects unsafe links and keeps the label", () => {
  assert.equal(changelogHref("http://ordo.axolet.com"), null);
  assert.equal(changelogHref("https://user:pass@ordo.axolet.com"), null);
  assert.equal(changelogHref("javascript:alert(1)"), null);
  const inlines = parseChangelogInlines(
    "[click](http://ordo.axolet.com/terms) and [ok](https://user:pass@ordo.axolet.com/x)",
  );
  assert.deepEqual(inlines, [
    { type: "text", text: "click" },
    { type: "text", text: " and " },
    { type: "text", text: "ok" },
  ]);
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
