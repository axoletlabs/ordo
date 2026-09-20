import type { TelemetryStatsDto } from "@ordo/shared";

const BG = "#11110F";
const FG = "#F4F1E8";
const MUTED = "#AAA79F";
const LINE = "#3A3934";
const CARD = "#1A1916";
const DAU = "#E8C07A";
const WAU = "#8FA37A";
const TOTAL = "#D9D4C8";

export function renderTelemetryHtml(stats: TelemetryStatsDto): string {
  const { current, history } = stats;
  const chart = sparkline(history);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>ordo installs</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: ${BG};
      color: ${FG};
      font: 15px/1.45 ui-sans-serif, system-ui, sans-serif;
    }
    main { max-width: 920px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 4px; }
    .sub { color: ${MUTED}; font-size: 13px; margin-bottom: 28px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .card {
      background: ${CARD};
      border: 1px solid ${LINE};
      border-radius: 14px;
      padding: 14px 16px;
    }
    .card .k { color: ${MUTED}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
    .card .v { font-size: 28px; font-weight: 600; letter-spacing: -0.03em; margin-top: 6px; }
    section { margin-top: 28px; }
    h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: ${MUTED}; margin: 0 0 12px; }
    svg { width: 100%; height: 160px; display: block; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid ${LINE}; }
    th { color: ${MUTED}; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
    .legend { display: flex; gap: 16px; color: ${MUTED}; font-size: 12px; margin: 8px 0 0; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 99px; margin-right: 6px; vertical-align: -1px; }
    .split { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; }
  </style>
</head>
<body>
  <main>
    <h1>ordo installs</h1>
    <p class="sub">Anonymous app installs. UTC days. Generated ${escapeHtml(stats.generatedAt)}.</p>
    <div class="cards">
      ${metric("Total", current.total)}
      ${metric("New today", current.newCount)}
      ${metric("Daily", current.dau)}
      ${metric("Weekly", current.wau)}
      ${metric("Monthly", current.mau)}
    </div>
    <section>
      <h2>History</h2>
      ${chart}
      <div class="legend">
        <span><i class="sw" style="background:${TOTAL}"></i>Total</span>
        <span><i class="sw" style="background:${DAU}"></i>Daily</span>
        <span><i class="sw" style="background:${WAU}"></i>Weekly</span>
      </div>
    </section>
    <section class="split">
      ${table("Hosting", current.hosting)}
      ${table("Platform", current.platform)}
      ${table("Version", current.version)}
    </section>
    <section>
      <h2>Days</h2>
      <table>
        <thead>
          <tr><th>Day</th><th>Total</th><th>New</th><th>Daily</th><th>Weekly</th><th>Monthly</th></tr>
        </thead>
        <tbody>
          ${[...history].reverse().map((row) => `
            <tr>
              <td>${escapeHtml(row.day)}</td>
              <td>${row.total}</td>
              <td>${row.newCount}</td>
              <td>${row.dau}</td>
              <td>${row.wau}</td>
              <td>${row.mau}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function metric(label: string, value: number): string {
  return `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${value}</div></div>`;
}

function table(title: string, breakdown: Record<string, number>): string {
  const rows = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const body =
    rows.length === 0
      ? `<tr><td colspan="2" style="color:${MUTED}">None yet</td></tr>`
      : rows
          .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${value}</td></tr>`)
          .join("");
  return `<div><h2>${escapeHtml(title)}</h2><table><thead><tr><th>Name</th><th>Active today</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function sparkline(history: TelemetryStatsDto["history"]): string {
  if (history.length === 0) {
    return `<p style="color:${MUTED}">No days recorded yet.</p>`;
  }
  const width = 900;
  const height = 160;
  const pad = 8;
  const totals = history.map((row) => row.total);
  const daus = history.map((row) => row.dau);
  const waus = history.map((row) => row.wau);
  const max = Math.max(1, ...totals, ...daus, ...waus);
  const path = (values: number[]) => {
    if (values.length === 1) {
      const y = pad + (1 - values[0] / max) * (height - pad * 2);
      return `M ${pad} ${y} L ${width - pad} ${y}`;
    }
    return values
      .map((value, index) => {
        const x = pad + (index / (values.length - 1)) * (width - pad * 2);
        const y = pad + (1 - value / max) * (height - pad * 2);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  };
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Install history">
    <path d="${path(totals)}" fill="none" stroke="${TOTAL}" stroke-width="2" />
    <path d="${path(waus)}" fill="none" stroke="${WAU}" stroke-width="2" />
    <path d="${path(daus)}" fill="none" stroke="${DAU}" stroke-width="2.5" />
  </svg>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
