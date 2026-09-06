import { normalizeImportPreview, normalizeUrlForMatch } from "@ordo/shared";
import { detectImportFormat } from "./index.js";
import { parseNetscapeHtml } from "./html.parser.js";
import { detectCsvProfile, parseCsv, splitCsv } from "./csv.parser.js";
import { looksLikeOrdoJson, parseOrdoJson } from "./json.parser.js";

describe("normalizeImportPreview", () => {
  it("turns a pre-revamp preview into a UI-safe shape", () => {
    const preview = normalizeImportPreview({
      format: "netscape-html",
      totalRows: 96,
      validRows: 96,
      invalidRows: 0,
      duplicates: 1,
      withinFileDuplicates: 0,
    });
    expect(preview?.duplicateSamples).toEqual([]);
    expect(preview?.newFolders).toEqual([]);
    expect(preview?.uniqueNew).toBe(95);
    expect(preview?.uniqueDuplicates).toBe(1);
  });
});

describe("normalizeUrlForMatch", () => {
  it("lowercases scheme and host and drops default ports", () => {
    expect(normalizeUrlForMatch("HTTPS://Example.COM:443/path")).toBe("https://example.com/path");
    expect(normalizeUrlForMatch("http://example.com:80")).toBe("http://example.com");
  });

  it("drops a trailing slash on the root path but keeps deeper paths intact", () => {
    expect(normalizeUrlForMatch("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrlForMatch("https://example.com/a/")).toBe("https://example.com/a/");
  });

  it("preserves query strings and non-default ports", () => {
    expect(normalizeUrlForMatch("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeUrlForMatch("https://example.com:8443/")).toBe("https://example.com:8443");
  });

  it("returns the trimmed input when the URL is unparseable", () => {
    expect(normalizeUrlForMatch("  not a url  ")).toBe("not a url");
  });
});

describe("detectImportFormat", () => {
  it("detects an Ordo JSON envelope", () => {
    expect(detectImportFormat('{"format":"ordo-export","version":1}')).toBe("ordo-json");
  });

  it("detects Netscape HTML by shape", () => {
    expect(detectImportFormat("<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p></DL><p>")).toBe(
      "netscape-html",
    );
    expect(detectImportFormat('<DT><A HREF="https://example.com">x</A>')).toBe("netscape-html");
  });

  it("detects known CSV profiles by header", () => {
    expect(detectImportFormat("url,title,folder\nhttps://a.com,A,A\n")).toBe("csv");
  });

  it("throws IMPORT_UNSUPPORTED_FORMAT for anything else", () => {
    expect(() => detectImportFormat("just some text\nmore text\n")).toThrow(
      /Could not recognise this file/,
    );
  });
});

describe("parseNetscapeHtml", () => {
  const sample = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<DL><p>
    <DT><H3 ADD_DATE="1700000000">Research</H3>
    <DL><p>
        <DT><H3>AI</H3>
        <DL><p>
            <DT><A HREF="https://example.com/paper?x=1" ADD_DATE="1700000001" TAGS="ml,ethics">A &amp; Study</A>
        </DL><p>
        <DT><A HREF="https://example.com/flat">Flat in Research</A>
    </DL><p>
    <DT><A HREF="https://example.com/root">Root link</A>
    <DT><A HREF="ftp://example.com/nope">Not http</A>
    <DT><A ADD_DATE="1">No href</A>
</DL><p>`;

  it("builds nested folder paths and decodes entities", () => {
    const result = parseNetscapeHtml(sample);
    expect(result.format).toBe("netscape-html");
    const urls = result.entries.map((e) => e.url);
    expect(urls).toEqual([
      "https://example.com/paper?x=1",
      "https://example.com/flat",
      "https://example.com/root",
    ]);
    expect(result.entries[0].folderPath).toEqual(["Research", "AI"]);
    expect(result.entries[0].title).toBe("A & Study");
    expect(result.entries[0].tags).toEqual(["ml", "ethics"]);
    expect(result.entries[1].folderPath).toEqual(["Research"]);
    expect(result.entries[2].folderPath).toEqual([]);
    expect(result.entries[0].createdAt).toBe(new Date(1700000001 * 1000).toISOString());
  });

  it("strips Brave/Chrome toolbar and Other bookmarks wrappers", () => {
    const brave = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/bar">On the bar</A>
        <DT><H3>Work</H3>
        <DL><p>
            <DT><A HREF="https://example.com/job">Job</A>
        </DL><p>
    </DL><p>
    <DT><H3>Other bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://example.com/other">Loose</A>
        <DT><H3>Recipes</H3>
        <DL><p>
            <DT><A HREF="https://example.com/soup">Soup</A>
        </DL><p>
    </DL><p>
</DL><p>`;
    const result = parseNetscapeHtml(brave);
    expect(result.entries.map((e) => e.folderPath)).toEqual([[], ["Work"], [], ["Recipes"]]);
  });

  it("decodes numeric HTML entities in titles", () => {
    const html = `<DL><p><DT><A HREF="https://example.com/x">A &#38; B &#x27;s</A></DL>`;
    const result = parseNetscapeHtml(html);
    expect(result.entries[0].title).toBe("A & B 's");
  });

  it("collects unusable rows with reasons", () => {
    const result = parseNetscapeHtml(sample);
    expect(result.invalid).toHaveLength(2);
    expect(result.invalid[0].reason).toContain("http(s)");
    expect(result.invalid[1].reason).toContain("Missing URL");
  });
});

describe("splitCsv", () => {
  it("handles quoted cells, escaped quotes, and CRLF", () => {
    const rows = splitCsv('a,"b,1","say ""hi"""\r\nplain,x,y\n');
    expect(rows).toEqual([
      ["a", "b,1", 'say "hi"'],
      ["plain", "x", "y"],
    ]);
  });
});

describe("detectCsvProfile", () => {
  it("recognises Ordo, Raindrop, Pocket, and Instapaper headers", () => {
    expect(detectCsvProfile(["url", "title", "folder", "readProgress"])).toBe("ordo");
    expect(detectCsvProfile(["title", "link", "folder", "tags", "created_at"])).toBe("raindrop");
    expect(detectCsvProfile(["title", "url", "time_added", "status"])).toBe("pocket");
    expect(detectCsvProfile(["URL", "Title", "Folder"])).toBe("instapaper");
    expect(detectCsvProfile(["a", "b", "c"])).toBeNull();
  });
});

describe("parseCsv", () => {
  it("maps an Ordo CSV round-trip", () => {
    const result = parseCsv(
      [
        "url,title,folder,tags,isRead,readProgress,completedAt,createdAt,updatedAt,description,author,publishedAt,readingTimeMinutes",
        'https://a.com/x,"Title, with comma",Reading,"one,two",true,0.5,,,,"An essay","Ada Lovelace",1843-01-01,7',
      ].join("\n"),
    );
    expect(result.format).toBe("csv");
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry.title).toBe("Title, with comma");
    expect(entry.folderPath).toEqual(["Reading"]);
    expect(entry.tags).toEqual(["one", "two"]);
    expect(entry.isRead).toBe(true);
    expect(entry.readProgress).toBe(0.5);
    expect(entry.author).toBe("Ada Lovelace");
    expect(entry.readingTimeMinutes).toBe(7);
  });

  it("maps a Raindrop.io export", () => {
    const result = parseCsv(
      "title,link,folder,tags,created_at\nPaper,https://a.com/p,ML,\"ai,ethics\",1700000000\n",
    );
    expect(result.entries[0].url).toBe("https://a.com/p");
    expect(result.entries[0].folderPath).toEqual(["ML"]);
    expect(result.entries[0].tags).toEqual(["ai", "ethics"]);
    expect(result.entries[0].createdAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("maps a Pocket export with archive status", () => {
    const result = parseCsv(
      "title,url,time_added,status\nRead one,https://a.com/1,1700000000,archive\nLater,https://a.com/2,1700000001,unread\n",
    );
    expect(result.entries[0].isRead).toBe(true);
    expect(result.entries[1].isRead).toBe(false);
    expect(result.entries[1].createdAt).toBe(new Date(1700000001 * 1000).toISOString());
  });

  it("maps an Instapaper export with Archive/Unread sentinels", () => {
    const result = parseCsv(
      "URL,Title,Folder\nhttps://a.com/1,Done,Archive\nhttps://a.com/2,Later,Unread\nhttps://a.com/3,Kept,Recipes\n",
    );
    expect(result.entries[0].isRead).toBe(true);
    expect(result.entries[0].folderPath).toEqual([]);
    expect(result.entries[2].folderPath).toEqual(["Recipes"]);
  });

  it("records invalid rows", () => {
    const result = parseCsv("url,title,folder\nnot-a-url,Nope,A\n,Empty,A\nhttps://a.com,Good,A\n");
    expect(result.entries).toHaveLength(1);
    expect(result.invalid).toHaveLength(2);
    expect(result.invalid[0].line).toBe(2);
  });

  it("throws for unknown headers", () => {
    expect(() => parseCsv("a,b,c\n1,2,3\n")).toThrow(/Unrecognised CSV columns/);
  });
});

describe("parseOrdoJson", () => {
  const file = {
    format: "ordo-export",
    version: 1,
    exportedAt: "2026-08-30T00:00:00.000Z",
    folders: [{ name: "Reading", icon: "book-outline", pinned: true }],
    bookmarks: [
      {
        url: "https://example.com/a",
        title: "A",
        folder: "Reading",
        tags: ["ai"],
        isRead: true,
        readProgress: 1,
        createdAt: 1700000000,
      },
      { url: "javascript:alert(1)", title: "Bad" },
      { url: "https://example.com/b", title: "B", folder: "Reading" },
    ],
  };

  it("parses entries and folder metadata", () => {
    const result = parseOrdoJson(JSON.stringify(file));
    expect(result.format).toBe("ordo-json");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].folderPath).toEqual(["Reading"]);
    expect(result.entries[0].isRead).toBe(true);
    expect(result.entries[0].createdAt).toBe(new Date(1700000000 * 1000).toISOString());
    expect(result.folders).toEqual([{ name: "Reading", icon: "book-outline", pinned: true }]);
  });

  it("rejects unsupported schemes row-by-row", () => {
    const result = parseOrdoJson(JSON.stringify(file));
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].reason).toContain("http(s)");
  });

  it("rejects foreign JSON and wrong versions", () => {
    expect(looksLikeOrdoJson('{"hello":1}')).toBe(false);
    expect(() => parseOrdoJson('{"hello":1}')).toThrow(/not an ordo export/);
    expect(() =>
      parseOrdoJson(JSON.stringify({ ...file, version: 2 })),
    ).toThrow(/Unsupported ordo export version/);
  });
});
