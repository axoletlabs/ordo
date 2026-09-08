import { JSDOM } from "jsdom";
import { bookmarkContentKind } from "@ordo/shared";
import {
  classifyDestination,
  classifyPageSignals,
  collectPageSignals,
  hasArticleEvidence,
  pathnameLooksLikeCommerce,
} from "./reader-classify.js";

describe("reader-classify", () => {
  describe("classifyDestination", () => {
    function reason(url: string) {
      return classifyDestination(new URL(url));
    }

    it("rejects commerce hosts and product paths", () => {
      expect(reason("https://www.amazon.com/something-else")).toBe("not_an_article");
      expect(reason("https://shop.example.com/products/wool")).toBe("not_an_article");
      expect(reason("https://example.com/pricing")).toBe("not_an_article");
    });

    it("keeps article-like paths including site-root essays and Substack /p/", () => {
      expect(reason("https://grugbrain.dev/")).toBeNull();
      expect(reason("https://example.com/")).toBeNull();
      expect(reason("https://example.substack.com/p/a-real-essay")).toBeNull();
      expect(reason("https://jvns.ca/blog/2024/cool-post")).toBeNull();
    });

    it("rejects GitHub repo homepages, profiles, and source trees, not markdown or Pages", () => {
      expect(reason("https://github.com/Azvyl/PMInputAPI")).toBe("not_an_article");
      expect(reason("https://www.github.com/Azvyl/PMInputAPI/")).toBe("not_an_article");
      expect(reason("https://github.com/Cosmoverse/libpmquery?tab=readme-ov-file")).toBe("not_an_article");
      expect(reason("https://github.com/xRookieFight")).toBe("not_an_article");
      expect(reason("https://github.com/Wraith0x10?tab=repositories")).toBe("not_an_article");
      expect(reason("https://github.com/platz1de/EasyEdit/tree/main")).toBe("not_an_article");
      expect(reason("https://github.com/anomalyco/opencode/blob/v2/.opencode/plugins/orchestrator.ts")).toBe(
        "not_an_article",
      );
      expect(reason("https://github.com/ninjaknights/CameraUtils/blob/stable-PM5/Usage.md")).toBeNull();
      expect(reason("https://github.com/platz1de/EasyEdit/wiki/Conditional-Patterns")).toBeNull();
      expect(reason("https://w1zardz.github.io/bedrock-nbt-editor/")).toBeNull();
      expect(reason("https://gist.github.com/user/abc123")).toBeNull();
    });

    it("does not treat private IPs as homepages", () => {
      expect(reason("http://192.168.1.1/")).toBeNull();
      expect(reason("http://127.0.0.1/admin")).toBeNull();
    });
  });

  describe("pathnameLooksLikeCommerce", () => {
    it("matches standardised cart and catalog segments", () => {
      expect(pathnameLooksLikeCommerce("/products/wool-runners")).toBe(true);
      expect(pathnameLooksLikeCommerce("/gp/product/B00")).toBe(true);
      expect(pathnameLooksLikeCommerce("/p/a-real-essay")).toBe(false);
    });
  });

  describe("page signals", () => {
    function signals(html: string) {
      return collectPageSignals(new JSDOM(html).window.document);
    }

    it("treats Article JSON-LD and og:type=article as evidence", () => {
      const article = signals(`<meta property="og:type" content="article">
        <script type="application/ld+json">${JSON.stringify({
          "@type": "NewsArticle",
          headline: "Hello",
        })}</script>`);
      expect(hasArticleEvidence(article)).toBe(true);
      expect(classifyPageSignals(article)).toBeNull();
    });

    it("rejects Product schema even when Article is also present", () => {
      const mixed = signals(`<script type="application/ld+json">${JSON.stringify({
        "@graph": [{ "@type": "Product" }, { "@type": "Article" }],
      })}</script>`);
      expect(classifyPageSignals(mixed)).toBe("not_an_article");
    });

    it("does not treat og:type=website as a rejection or as article evidence", () => {
      const site = signals(`<meta property="og:type" content="website">`);
      expect(hasArticleEvidence(site)).toBe(false);
      expect(classifyPageSignals(site)).toBeNull();
    });
  });

  describe("bookmarkContentKind", () => {
    it("maps extraction outcomes to presentation kinds", () => {
      expect(bookmarkContentKind("pending", null)).toBeNull();
      expect(bookmarkContentKind("ok", null)).toBe("article");
      expect(bookmarkContentKind("unsupported", "social_video_or_app")).toBe("media");
      expect(bookmarkContentKind("unsupported", "non_html_content")).toBe("file");
      expect(bookmarkContentKind("unsupported", "not_an_article")).toBe("web");
      expect(bookmarkContentKind("failed", "fetch_error")).toBe("web");
      expect(bookmarkContentKind("ok", null, "web")).toBe("web");
      expect(bookmarkContentKind("unsupported", "not_an_article", "article")).toBe("article");
      expect(bookmarkContentKind("pending", null, "article")).toBe("article");
    });
  });
});
