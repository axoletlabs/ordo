import { provisionalTitle } from "./provisional-title.js";

describe("provisionalTitle", () => {
  it("uses a humanized path slug when it is long enough", () => {
    expect(provisionalTitle("https://example.com/posts/how-we-built-it", "example.com")).toBe(
      "How We Built It",
    );
  });

  it("falls back to the hostname for short or identifier slugs", () => {
    expect(provisionalTitle("https://example.com/article", "example.com")).toBe("example.com");
    expect(provisionalTitle("https://example.com/", "example.com")).toBe("example.com");
    expect(provisionalTitle("https://example.com/posts/1234567", "example.com")).toBe("example.com");
  });
});
