import { ReaderService, UnsupportedContentError } from "./reader.service.js";

const P = (i: number) =>
  `<p>Paragraph ${i} with plenty of words to satisfy the quality gates that the reader applies before accepting content. It talks about distributed systems, caching layers, and the tradeoffs engineers make every day when they ship software people actually use.</p>`;

const SAMPLE_HTML = `<!DOCTYPE html>
<html><head>
  <title>Example Article — My Site</title>
  <meta property="og:type" content="article">
  <meta property="og:title" content="The Real Title">
  <meta name="description" content="A short summary of the article.">
  <meta name="author" content="Jane Doe">
  <meta property="article:published_time" content="2024-05-01T10:00:00Z">
</head><body>
  <nav>Home About Contact</nav>
  <article>
    <h1>The Real Title</h1>
    <p>A short summary of the article.</p>
    ${P(1)}${P(2)}${P(3)}${P(4)}
    <h2>A Section</h2>
    ${P(5)}${P(6)}
    <figure><img src="https://example.com/cat.png" alt="A cat"><figcaption>A cat caption</figcaption></figure>
    ${P(7)}
    <iframe src="https://www.youtube.com/embed/abc123"></iframe>
    ${P(8)}
    <img src="data:image/png;base64,secret">
    <script>evil()</script>
  </article>
  <footer>Copyright</footer>
</body></html>`;

/** A real article whose text is kept under Readability's readerable threshold
 *  (no paragraph reaches 140 chars and the article scores below 20), forcing
 *  the narrow `<article>` fallback path. */
const SHORT_ARTICLE_HTML = `<!DOCTYPE html>
<html><head><title>Fallback Piece — Site</title>
  <meta property="og:title" content="Fallback Piece">
  <meta property="og:type" content="article">
</head><body>
  <article>
    <h1>Fallback Piece</h1>
    <p>Intro line about reading very carefully here now today</p>
    <p>Second short line about the clearly stated topic at hand</p>
    <p>Third short line adding a little more real bulk now</p>
    <p>Fourth short line included for the word gate and padding</p>
    <p>Fifth short line continuing the tiny written piece today</p>
    <p>Sixth short line with additional plain words here too</p>
    <p>Seventh short line still discussing the same thing now</p>
    <p>Eighth short line that finally wraps the piece nicely</p>
  </article>
</body></html>`;

describe("ReaderService", () => {
  let reader: ReaderService;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    reader = new ReaderService();
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(html: string, contentType = "text/html", ok = true, status = 200): void {
    globalThis.fetch = (async () =>
      ({
        ok,
        status,
        headers: {
          get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null),
        },
        text: async () => html,
      }) as unknown as Response) as typeof globalThis.fetch;
  }

  function mockFetchNeverCalled(): void {
    globalThis.fetch = (() => {
      throw new Error("fetch must not be called for pre-bypassed destinations");
    }) as typeof globalThis.fetch;
  }

  async function expectUnsupported(url: string, reason: string): Promise<UnsupportedContentError> {
    try {
      await reader.extract(url);
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedContentError);
      const unsupported = err as UnsupportedContentError;
      expect(unsupported.reason).toBe(reason);
      return unsupported;
    }
    throw new Error(`Expected ${url} to be rejected as ${reason}`);
  }

  describe("successful extraction", () => {
    it("extracts the article body as sanitized semantic html and text", async () => {
      mockFetch(SAMPLE_HTML);
      const result = await reader.extract("https://www.example.com/article/123");

      expect(result.contentHtml).toContain("<p>Paragraph 1");
      expect(result.contentHtml).toContain("<figure>");
      expect(result.contentHtml).toContain("A cat caption");
      expect(result.contentHtml).toContain('alt="A cat"');
      expect(result.contentHtml.toLowerCase()).toContain("<h2");
      expect(result.contentText).toMatch(/Paragraph 5/);
      expect(result.contentMarkdown).toBe("");
      // scripts, iframes and data: urls never survive
      expect(result.contentHtml).not.toContain("<script");
      expect(result.contentHtml).not.toContain("evil()");
      expect(result.contentHtml).not.toContain("<iframe");
      expect(result.contentHtml).not.toContain("data:");
    });

    it("prefers the Readability title and captures description, byline, publishedTime and domain", async () => {
      mockFetch(SAMPLE_HTML);
      const result = await reader.extract("https://www.example.com/article/123");

      expect(result.title).toBe("The Real Title");
      expect(result.description).toBe("A short summary of the article.");
      expect(result.author).toBe("Jane Doe");
      expect(result.publishedAt).toBe("2024-05-01T10:00:00.000Z");
      expect(result.domain).toBe("example.com");
    });

    it("computes a positive reading time from the extracted text", async () => {
      mockFetch(SAMPLE_HTML);
      const result = await reader.extract("https://example.com/x");
      expect(result.readingTimeMinutes).toBeGreaterThanOrEqual(1);
    });

    it("converts embeds into safe link paragraphs", async () => {
      mockFetch(SAMPLE_HTML);
      const result = await reader.extract("https://example.com/x");
      expect(result.contentHtml).toContain(
        '<a href="https://www.youtube.com/embed/abc123">https://www.youtube.com/embed/abc123</a>',
      );
    });

    it("falls back to the document title when og:title is absent", async () => {
      mockFetch(SAMPLE_HTML.replace('<meta property="og:title" content="The Real Title">', ""));
      const result = await reader.extract("https://example.com/y");
      expect(result.title).toBe("Example Article — My Site");
    });

    it("normalizes the www prefix while preserving the source domain", async () => {
      mockFetch(SAMPLE_HTML);
      const result = await reader.extract("https://www.example.com/path?x=1");
      expect(result.domain).toBe("example.com");
    });
  });

  describe("duplicate leading blocks", () => {
    it("removes a leading paragraph that repeats the description", async () => {
      mockFetch(SAMPLE_HTML);
      const result = await reader.extract("https://example.com/x");
      expect(result.description).toBe("A short summary of the article.");
      expect(result.contentHtml.startsWith("<p>Paragraph 1")).toBe(true);
    });

    it("keeps a longer lede that contains the metadata description", async () => {
      const html = SAMPLE_HTML.replace(
        "<p>A short summary of the article.</p>",
        "<p>A short summary of the article. This additional context belongs to the article body.</p>",
      );
      mockFetch(html);

      const result = await reader.extract("https://example.com/longer-lede");

      expect(result.contentHtml).toContain("This additional context belongs to the article body.");
    });

    it("removes a leading heading that repeats the extracted title (narrow fallback path)", async () => {
      mockFetch(SHORT_ARTICLE_HTML);
      const result = await reader.extract("https://example.com/short");

      expect(result.title).toBe("Fallback Piece");
      // the duplicated h1 is gone, the article body itself remains
      expect(result.contentHtml).not.toContain("<h1");
      expect(result.contentHtml).not.toContain("Fallback Piece");
      expect(result.contentHtml).toContain("Intro line about reading very carefully");
      expect(result.contentText).toContain("Fifth short line");
    });

    it("removes duplicate metadata after linked lead media", async () => {
      const html = SHORT_ARTICLE_HTML
        .replace(
          '<meta property="og:title" content="Fallback Piece">',
          '<meta property="og:title" content="Fallback Piece"><meta name="description" content="A concise fallback summary.">',
        )
        .replace(
          "<h1>Fallback Piece</h1>",
          '<a href="https://example.com/art"><img src="https://example.com/art.png" style="float:left; height:120px; margin-right:20px"></a><h1>Fallback Piece</h1><p>A concise fallback summary.</p>',
        );
      mockFetch(html);

      const result = await reader.extract("https://example.com/media-first");

      expect(result.contentHtml).toContain('height="120"');
      expect(result.contentHtml).not.toContain("style=");
      expect(result.contentHtml).not.toContain("<h1");
      expect(result.contentHtml).not.toContain("A concise fallback summary.");
      expect(result.contentHtml).toContain("Intro line about reading very carefully");
    });

    it("keeps the opening body when the source has no heading", async () => {
      mockFetch(
        SHORT_ARTICLE_HTML.replace(
          "<h1>Fallback Piece</h1>",
          "<p>Opening body copy provides enough additional words for this heading-free article</p>",
        ),
      );

      const result = await reader.extract("https://example.com/no-heading");

      expect(result.title).toBe("Fallback Piece");
      expect(result.contentHtml).toContain("Intro line about reading very carefully");
    });
  });

  describe("image dimension hints", () => {
    it("normalizes safe dimensions and falls back to bounded pixel styles", async () => {
      const html = SHORT_ARTICLE_HTML.replace(
        "<h1>Fallback Piece</h1>",
        '<img src="https://example.com/art.png" width="0320" height="99999999" style="width:640px; height:120px; float:left"><h1>Fallback Piece</h1>',
      );
      mockFetch(html);

      const result = await reader.extract("https://example.com/image-dimensions");

      expect(result.contentHtml).toContain('width="320"');
      expect(result.contentHtml).toContain('height="120"');
      expect(result.contentHtml).not.toContain("99999999");
      expect(result.contentHtml).not.toContain("style=");
    });
  });

  describe("typed rejections", () => {
    it("rejects a JavaScript-required shell with reason js_required", async () => {
      mockFetch(`<!DOCTYPE html><html><body>
        <noscript><p>Please enable JavaScript to continue using this site.</p></noscript>
        <div id="root"></div>
      </body></html>`);
      await expectUnsupported("https://example.com/app", "js_required");
    });

    it("recognizes variants of the JavaScript-required wording", async () => {
      mockFetch(`<html><body><p>JavaScript is not enabled in your browser. Turn on JavaScript.</p></body></html>`);
      await expectUnsupported("https://example.com/js-off", "js_required");
    });

    it("rejects the Google Sites cookie disclosure shown instead of an article", async () => {
      mockFetch(`<html><body><main>
        <h1>Home</h1>
        <p>This site uses cookies from Google to deliver its services and to analyze traffic.
        Information about your use of this site is shared with Google. By using this site,
        you agree to its use of cookies.</p><a href="/learn-more">Learn more</a><p>Got it</p>
      </main></body></html>`);
      await expectUnsupported("https://liech.space/home", "consent_wall");
    });

    it("detects noscript warnings even when a large inline bundle is present", async () => {
      mockFetch(`<html><body>
        <script>${"const bundledCode = true;".repeat(200)}</script>
        <noscript>Please enable JavaScript to continue using this site.</noscript>
        <div id="root"></div>
      </body></html>`);
      await expectUnsupported("https://example.com/app-shell", "js_required");
    });

    it("rejects bot challenges and login/paywall shells", async () => {
      mockFetch(`<html><body><p>Checking your browser before accessing the site.</p></body></html>`);
      await expectUnsupported("https://example.com/bot", "bot_challenge");

      mockFetch(`<html><body><p>Sign in to continue reading this article.</p></body></html>`);
      await expectUnsupported("https://example.com/login", "login_or_paywall");
    });

    it("rejects a link-heavy listing page with reason not_an_article", async () => {
      const entries = Array.from(
        { length: 10 },
        (_, i) => `<p><a href="/item/${i}">Item ${i} — a listed link entry with a blurb</a></p>`,
      ).join("");
      mockFetch(`<!DOCTYPE html><html><head><title>All posts</title></head><body>
        <main><h1>All posts</h1>${entries}</main>
      </body></html>`);
      await expectUnsupported("https://example.com/all-posts", "not_an_article");
    });

    it("rejects Google-Sites-style home/app shells through quality checks, not hostnames", async () => {
      mockFetch(`<!DOCTYPE html><html><head><title>Liech</title></head><body>
        <header><h1>Liech</h1></header>
        <nav><a href="/">Home</a> <a href="/apps">Apps</a> <a href="/blog">Blog</a> <a href="/contact">Contact</a></nav>
        <main>
          <section><h2>Welcome</h2><p>Thanks for visiting. Use the links above.</p></section>
          <section><h2>Links</h2><p><a href="/a">Project A</a></p><p><a href="/b">Project B</a></p></section>
        </main>
        <footer><p>© 2026</p></footer>
      </body></html>`);
      await expectUnsupported("https://liech.space/welcome", "not_an_article");
    });

    it("rejects empty pages with reason too_short", async () => {
      mockFetch("<html><head><title>Empty</title></head><body><div></div></body></html>");
      await expectUnsupported("https://example.com/empty", "too_short");
    });

    it("throws a typed unsupported error for non-HTML content types", async () => {
      mockFetch("raw bytes", "application/pdf", true, 200);
      await expectUnsupported("https://example.com/file", "non_html_content");
    });

    it("pre-bypasses non-HTML file extensions without fetching", async () => {
      mockFetchNeverCalled();
      await expectUnsupported("https://example.com/files/report.pdf", "non_html_content");
      await expectUnsupported("https://example.com/photo.JPG", "non_html_content");
      await expectUnsupported("https://example.com/archive.tar.gz", "non_html_content");
    });

    it("pre-bypasses social/video/app destinations without fetching", async () => {
      mockFetchNeverCalled();
      await expectUnsupported("https://www.youtube.com/watch?v=abc", "social_video_or_app");
      await expectUnsupported("https://x.com/user/status/123", "social_video_or_app");
      await expectUnsupported("https://open.spotify.com/track/xyz", "social_video_or_app");
      await expectUnsupported("https://app.example.com/dashboard", "social_video_or_app");
      await expectUnsupported("https://docs.google.com/document/d/xyz/edit", "social_video_or_app");
    });

    it("pre-bypasses commerce hosts and product paths without fetching", async () => {
      mockFetchNeverCalled();
      await expectUnsupported("https://www.amazon.com/dp/B00TEST123", "not_an_article");
      await expectUnsupported("https://store.example.com/products/wool-runners", "not_an_article");
      await expectUnsupported("https://shop.example.com/collections/mens", "not_an_article");
      await expectUnsupported("https://example.com/pricing", "not_an_article");
    });

    it("extracts a long essay published at the site root when it declares itself an article", async () => {
      mockFetch(SAMPLE_HTML);
      const result = await reader.extract("https://grugbrain.dev/");
      expect(result.title).toBe("The Real Title");
    });

    it("does not auto-classify an unmarked long essay as an article", async () => {
      mockFetch(`<!DOCTYPE html><html><head>
        <title>Example Article — My Site</title>
        <meta property="og:title" content="The Real Title">
        <meta name="description" content="A short summary of the article.">
      </head><body>
        <article><h1>The Real Title</h1>${P(1)}${P(2)}${P(3)}${P(4)}${P(5)}${P(6)}${P(7)}${P(8)}</article>
      </body></html>`);
      await expectUnsupported("https://grugbrain.dev/", "not_an_article");
    });

    it("extracts an unmarked essay when the user forced article classification", async () => {
      mockFetch(`<!DOCTYPE html><html><head>
        <title>Example Article — My Site</title>
        <meta property="og:title" content="The Real Title">
      </head><body>
        <article><h1>The Real Title</h1>${P(1)}${P(2)}${P(3)}${P(4)}${P(5)}${P(6)}${P(7)}${P(8)}</article>
      </body></html>`);
      const result = await reader.extract("https://grugbrain.dev/", { forceArticle: true });
      expect(result.title).toBe("The Real Title");
      expect(result.contentText).toMatch(/Paragraph 2/);
    });

    it("fetches a commerce URL when the user forced article classification", async () => {
      mockFetch(SAMPLE_HTML);
      const result = await reader.extract("https://www.amazon.com/dp/B00TEST123", { forceArticle: true });
      expect(result.title).toBe("The Real Title");
    });

    it("still rejects social destinations when article classification is forced", async () => {
      mockFetchNeverCalled();
      await expect(reader.extract("https://www.youtube.com/watch?v=abc", { forceArticle: true })).rejects.toMatchObject({
        reason: "social_video_or_app",
      });
    });

    it("rejects a link-heavy site root after fetching, not by URL alone", async () => {
      mockFetch(`<!DOCTYPE html><html><head><title>Acme</title></head><body>
        <nav><a href="/">Home</a> <a href="/shop">Shop</a> <a href="/about">About</a></nav>
        <main><p>Welcome. Use the links above.</p></main>
      </body></html>`);
      await expectUnsupported("https://example.com/", "not_an_article");
    });

    it("does not treat article paths like Substack /p/ as commerce", async () => {
      mockFetch(SAMPLE_HTML);
      const result = await reader.extract("https://example.substack.com/p/a-real-essay");
      expect(result.title).toBe("The Real Title");
    });

    it("pre-bypasses recognizable search result pages", async () => {
      mockFetchNeverCalled();
      await expectUnsupported("https://example.com/search?q=shoes", "not_an_article");
    });

    it("blocks loopback and private-network destinations without fetching", async () => {
      mockFetchNeverCalled();
      await expectUnsupported("http://localhost/admin", "non_html_content");
      await expectUnsupported("http://127.0.0.1/admin", "non_html_content");
      await expectUnsupported("http://169.254.169.254/latest/meta-data", "non_html_content");
      await expectUnsupported("http://192.168.1.1/", "non_html_content");
      await expectUnsupported("http://[::1]/", "non_html_content");
    });

    it("rejects JSON-LD Product pages even when the body is long enough to parse", async () => {
      mockFetch(`<!DOCTYPE html><html><head>
        <script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Wool Runner",
        })}</script>
      </head><body><article>${P(1)}${P(2)}${P(3)}${P(4)}</article></body></html>`);
      await expectUnsupported("https://example.com/shoes/wool-runner", "not_an_article");
    });

    it("rejects og:type product pages", async () => {
      mockFetch(`<!DOCTYPE html><html><head>
        <meta property="og:type" content="product.group">
      </head><body><article>${P(1)}${P(2)}${P(3)}${P(4)}</article></body></html>`);
      await expectUnsupported("https://example.com/catalog/chairs", "not_an_article");
    });

    it("aborts the body download once the head declares a product", async () => {
      const head =
        `<!DOCTYPE html><html><head><meta property="og:type" content="product"><title>Shoes</title>${" ".repeat(8_200)}</head>`;
      const rest = `<body><article>${P(1)}${P(2)}${P(3)}${P(4)}</article></body></html>`;
      let cancelled = false;
      globalThis.fetch = (async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(head));
          },
          pull(controller) {
            if (cancelled) {
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(rest));
            controller.close();
          },
          cancel() {
            cancelled = true;
          },
        });
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html" : null),
          },
          body: stream,
        } as unknown as Response;
      }) as typeof fetch;

      await expectUnsupported("https://example.com/shoes/streamed", "not_an_article");
      expect(cancelled).toBe(true);
    });

    it("rejects unmarked pages with buy/cart CTAs", async () => {
      mockFetch(`<!DOCTYPE html><html><head><title>Wool Runner</title></head><body>
        <h1>Wool Runner</h1>
        ${P(1)}${P(2)}${P(3)}${P(4)}${P(5)}${P(6)}
        <button>Add to cart</button>
      </body></html>`);
      await expectUnsupported("https://example.com/shoes/wool-runner-cta", "not_an_article");
    });

    it("does not fall back to <main> chrome when Readability declines", async () => {
      mockFetch(`<!DOCTYPE html><html><head><title>Outlet</title></head><body>
        <main>
          <p>Skip to top navigation Skip to shopping bag Skip to footer links</p>
          <p>Gap Gap Factory Old Navy Banana Republic Athleta</p>
          <p>The Biggest Little Sale ends in 02h 28m 06s off all kids and baby styles</p>
          <p>Sorry! This was so wanted, it sold out.</p>
        </main>
      </body></html>`);
      await expectUnsupported("https://example.com/olive/sold-out-tee", "not_an_article");
    });
  });

  describe("fetch failures", () => {
    it("throws plain (non-unsupported) errors on non-2xx responses", async () => {
      mockFetch("", "text/html", false, 404);
      await expect(reader.extract("https://example.com/missing")).rejects.toThrow(/status 404/);
    });

    it("does not pre-bypass normal article URLs", async () => {
      mockFetch(SAMPLE_HTML);
      const result = await reader.extract("https://example.com/posts/2026/how-we-built-it");
      expect(result.title).toBe("The Real Title");
    });

    it("sends a Chrome user-agent and accept-language", async () => {
      let headers: Record<string, string> | undefined;
      globalThis.fetch = (async (_input, init) => {
        headers = init?.headers as Record<string, string>;
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html" : null),
          },
          text: async () => SAMPLE_HTML,
        } as unknown as Response;
      }) as typeof fetch;

      await reader.extract("https://example.com/article");
      expect(headers?.["user-agent"]).toMatch(/Chrome\/140/);
      expect(headers?.["accept-language"]).toMatch(/en-US/);
    });

    it("retries once on a 503 then extracts", async () => {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            status: 503,
            headers: { get: () => "text/html" },
            text: async () => "",
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html" : null),
          },
          text: async () => SAMPLE_HTML,
        } as unknown as Response;
      }) as typeof fetch;

      const result = await reader.extract("https://example.com/article");
      expect(calls).toBe(2);
      expect(result.title).toBe("The Real Title");
    });

    it("reports page metadata before the body is parsed", async () => {
      mockFetch(SAMPLE_HTML);
      const onMetadata = jest.fn();
      await reader.extract("https://example.com/article", { onMetadata });
      expect(onMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "The Real Title",
          author: "Jane Doe",
          description: "A short summary of the article.",
        }),
      );
    });

    it("extracts AMP HTML when the page advertises rel=amphtml", async () => {
      const original = `<!DOCTYPE html><html><head>
        <link rel="amphtml" href="https://example.com/amp">
        <title>Original</title>
      </head><body><p>Thin original shell</p></body></html>`;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const href = String(input);
        const html = href.includes("/amp") ? SAMPLE_HTML : original;
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html" : null),
          },
          text: async () => html,
        } as unknown as Response;
      }) as typeof fetch;

      const result = await reader.extract("https://example.com/wired-story");
      expect(result.title).toBe("The Real Title");
      expect(result.contentText).toMatch(/Paragraph 5/);
    });
  });
});
