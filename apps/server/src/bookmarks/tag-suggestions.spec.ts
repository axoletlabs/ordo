import { scoreTagSuggestions } from "./tag-suggestions.js";

describe("scoreTagSuggestions", () => {
  const content = {
    title: "Rust in production",
    description: "Notes on the toolchain",
    domain: "example.com",
    body: "We use rust and webassembly for performance.",
  };

  it("ranks title phrase matches above description phrase matches", () => {
    const scored = scoreTagSuggestions(
      [
        { id: "rust", name: "rust" },
        { id: "notes", name: "notes" },
      ],
      content,
    );
    expect(scored.map((s) => s.id)).toEqual(["rust", "notes"]);
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });

  it("requires token boundaries so substrings do not match", () => {
    const scored = scoreTagSuggestions(
      [
        { id: "rust", name: "rust" },
        { id: "art", name: "art" },
      ],
      {
        title: "Frustrating articles about crustaceans",
        description: null,
        domain: null,
        body: "No relevant terms here.",
      },
    );
    expect(scored).toEqual([]);
  });

  it("matches multi-word tags as phrases and individual tokens", () => {
    const phrase = scoreTagSuggestions([{ id: "ml", name: "machine learning" }], {
      title: "Machine learning at scale",
      description: null,
      domain: null,
      body: null,
    });
    expect(phrase).toHaveLength(1);
    expect(phrase[0].score).toBe(10);

    // two title token hits are together strong enough to suggest
    const tokenOnly = scoreTagSuggestions([{ id: "ml", name: "machine learning" }], {
      title: "A learning machine",
      description: null,
      domain: null,
      body: null,
    });
    expect(tokenOnly).toHaveLength(1);

    // a single weak body hit stays below the threshold
    const weak = scoreTagSuggestions([{ id: "ml", name: "machine learning" }], {
      title: "Unrelated headline",
      description: null,
      domain: null,
      body: "somewhere the word machine appears",
    });
    expect(weak).toEqual([]);
  });

  it("caps output at three suggestions with deterministic ordering", () => {
    const tags = ["alpha", "beta", "gamma", "delta", "epsilon"].map((name) => ({ id: name, name }));
    const scored = scoreTagSuggestions(tags, {
      title: "alpha beta gamma delta epsilon",
      description: null,
      domain: null,
      body: null,
    });
    expect(scored).toHaveLength(3);
    // equal scores break ties by name
    expect(scored.map((s) => s.name)).toEqual(["alpha", "beta", "delta"]);
  });

  it("matches short phrases verbatim but not as substrings", () => {
    const verbatim = scoreTagSuggestions([{ id: "ai", name: "ai" }], {
      title: "The AI winter",
      description: null,
      domain: null,
      body: null,
    });
    expect(verbatim).toHaveLength(1);
    expect(verbatim[0].score).toBe(10);

    const substring = scoreTagSuggestions([{ id: "ai", name: "ai" }], {
      title: "Aiming high",
      description: null,
      domain: null,
      body: null,
    });
    expect(substring).toEqual([]);
  });

  it("treats domain matches as too weak to surface alone", () => {
    const scored = scoreTagSuggestions([{ id: "example", name: "example" }], {
      title: "An unrelated headline",
      description: null,
      domain: "example.com",
      body: null,
    });
    expect(scored).toEqual([]);
  });

  it("uses body matches to break equal title scores", () => {
    const scored = scoreTagSuggestions(
      [
        { id: "a", name: "alpha" },
        { id: "b", name: "bravo" },
      ],
      {
        title: "alpha and bravo",
        description: null,
        domain: null,
        body: "bravo appears in the body too",
      },
    );
    expect(scored[0]?.id).toBe("b");
  });
});
