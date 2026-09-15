import { ftsBodyQuery, ftsPrefixQuery } from "./bookmark-fts.js";

describe("bookmark FTS query builder", () => {
  it("builds a prefix MATCH across title/url/domain", () => {
    expect(ftsPrefixQuery(["hel"])).toBe("{title url domain} : hel*");
  });

  it("ANDs dotted tokens and includes body when hidden fields are allowed", () => {
    expect(ftsPrefixQuery(["react.dev"], { includeHidden: true })).toBe(
      "{title url domain extra body} : (react* AND dev*)",
    );
  });

  it("ORs tokens for multi-word recall and adds a fuzzy stem", () => {
    expect(ftsPrefixQuery(["helo", "wrold"], { fuzzy: true, op: "OR" })).toBe(
      "{title url domain} : ((helo* OR hel*) OR (wrold* OR wrol*))",
    );
  });

  it("restricts body-only MATCH to the article column", () => {
    expect(ftsBodyQuery(["vault"])).toBe("{body} : vault*");
  });

  it("returns null when every token is punctuation", () => {
    expect(ftsPrefixQuery(["***"])).toBeNull();
  });
});
