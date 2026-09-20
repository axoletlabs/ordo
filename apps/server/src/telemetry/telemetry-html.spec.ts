import { renderTelemetryHtml } from "./telemetry-html.js";
import type { TelemetryStatsDto } from "@ordo/shared";

describe("renderTelemetryHtml", () => {
  it("escapes values so a version string cannot inject markup", () => {
    const stats: TelemetryStatsDto = {
      generatedAt: "<script>alert(1)</script>",
      current: {
        total: 1,
        newCount: 0,
        dau: 1,
        wau: 1,
        mau: 1,
        hosting: { cloud: 1 },
        platform: { android: 1 },
        version: { "<img src=x onerror=alert(1)>": 1 },
      },
      history: [
        {
          day: "2026-09-20",
          total: 1,
          newCount: 0,
          dau: 1,
          wau: 1,
          mau: 1,
          hosting: {},
          platform: {},
          version: {},
        },
      ],
    };
    const html = renderTelemetryHtml(stats);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});
