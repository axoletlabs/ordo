import {
  CreateBookmarkSchema,
  CreateHighlightSchema,
  PrefetchBookmarkSchema,
  UpdateBookmarkSchema,
} from "@ordo/shared";

describe("bookmark URL schemas", () => {
  it("create and prefetch accept only http(s) URLs", () => {
    expect(CreateBookmarkSchema.safeParse({ url: "https://example.com/a" }).success).toBe(true);
    expect(PrefetchBookmarkSchema.safeParse({ url: "http://example.com" }).success).toBe(true);
    expect(CreateBookmarkSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(CreateBookmarkSchema.safeParse({ url: "data:text/html,hi" }).success).toBe(false);
    expect(CreateBookmarkSchema.safeParse({ url: "ftp://example.com/a" }).success).toBe(false);
    expect(CreateBookmarkSchema.safeParse({ url: "file:///etc/passwd" }).success).toBe(false);
  });

  it("updates and highlight hrefs reject non-http(s) URLs", () => {
    expect(UpdateBookmarkSchema.safeParse({ isRead: true, url: "https://example.com" }).success).toBe(
      true,
    );
    expect(
      UpdateBookmarkSchema.safeParse({ isRead: true, url: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(CreateHighlightSchema.safeParse({ exact: "quote" }).success).toBe(true);
    expect(
      CreateHighlightSchema.safeParse({ exact: "quote", href: "https://example.com#a" }).success,
    ).toBe(true);
    expect(
      CreateHighlightSchema.safeParse({ exact: "quote", href: "javascript:alert(1)" }).success,
    ).toBe(false);
  });
});
