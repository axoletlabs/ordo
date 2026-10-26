import { boundedNumber, DETAIL_MS, MAX_AGE_MS, normalizeBuild, normalizeError, normalizeEvent, normalizeFrameStats, normalizeRenderState, normalizeSavedError, own, POLICY_VERSION, utf8Bytes, type DiagnosticEventName, type ErrorKind, type SafeBuild, type SafeError, type SafeEvent } from "./schema";

export interface RecorderAdapter {
  wall(): number; monotonic(): number;
  read(key: string): string | undefined; write(key: string, value: string): void; remove(key: string): void;
  schedule(callback: () => void, ms: number): unknown; cancel(timer: unknown): void;
}
type Event = SafeEvent & { atMs: number };
interface Session { number: number; createdAt: number; build: SafeBuild; events: Event[]; dropped: number }
interface Issue extends SafeError { session: number; atMs: number; lastMs: number; count: number }
interface Measurement { kind: "frames" | "render"; atMs: number; session: number; value: ReturnType<typeof normalizeFrameStats> | ReturnType<typeof normalizeRenderState> }
export interface RecorderStatus {
  enabled: boolean; mode: "off" | "basic" | "detailed"; generation: number; cutoff: number; remainingSeconds: number;
  overlays: { status: boolean; performance: boolean; rendering: boolean; layout: boolean };
  events: number; issues: number; bytes: number; storageAvailable: boolean; dropped: number;
}
export function createDiagnosticRecorder(adapter: RecorderAdapter, buildInput: unknown, initialGeneration = 0, initialCutoff?: number) {
  const build = normalizeBuild(buildInput);
  const listeners = new Set<() => void>();
  const now = adapter.wall();
  const nativeCutoff = Math.max(0, now - MAX_AGE_MS, Math.min(now, boundedNumber(initialCutoff, Number.MAX_SAFE_INTEGER) ?? 0));
  let enabled = true, generation = initialGeneration, cutoff = initialCutoff === undefined ? now : nativeCutoff, storageAvailable = true;
  let detailedUntil = 0, start = adapter.monotonic(), flushTimer: unknown;
  let overlays = { status: false, performance: false, rendering: false, layout: false };
  let sessions: Session[] = [], issues: Issue[] = [], measurements: Measurement[] = [], bytes = 0;
  let cachedStatus: RecorderStatus;
  const safeRead = (key: string) => { try { return adapter.read(key); } catch { storageAvailable = false; return undefined; } };
  const safeWrite = (key: string, value: string) => { try { adapter.write(key, value); } catch { storageAvailable = false; } };
  const remove = (key: string) => { try { adapter.remove(key); } catch { storageAvailable = false; } };
  const rawPolicy = safeRead("policy-v2");
  if (!storageAvailable) enabled = false;
  if (rawPolicy !== undefined) {
    try {
      const policy = JSON.parse(rawPolicy);
      const savedCutoff = boundedNumber(own(policy, "cutoff"), Number.MAX_SAFE_INTEGER);
      enabled = typeof own(policy, "enabled") === "boolean" && savedCutoff !== undefined && Number.isInteger(savedCutoff) && savedCutoff <= now
        ? own(policy, "enabled") as boolean : false;
      cutoff = Math.max(nativeCutoff, savedCutoff === undefined || savedCutoff > now ? now : savedCutoff);
    } catch { enabled = false; }
  }
  if (rawPolicy === undefined && storageAvailable) {
    safeWrite("policy-v2", JSON.stringify({ enabled, cutoff }));
    if (!storageAvailable) enabled = false;
  }
  // Legacy reports contain unrestricted text: never import them into v2.
  remove("report-v1");
  const raw = enabled ? safeRead("records-v2") : undefined;
  if (raw && utf8Bytes(raw) < 700_000) try {
    const saved = JSON.parse(raw);
    if (own(saved, "version") === 2 && Array.isArray(own(saved, "sessions"))) {
      for (const source of (own(saved, "sessions") as unknown[]).slice(0, 2)) {
        const createdAt = boundedNumber(own(source, "createdAt"), Number.MAX_SAFE_INTEGER);
        const number = boundedNumber(own(source, "number"), 1_000_000_000);
        if (createdAt === undefined || number === undefined || createdAt < cutoff || adapter.wall() < createdAt || adapter.wall() - createdAt > MAX_AGE_MS) continue;
        const events: Event[] = [], input = own(source, "events");
        if (Array.isArray(input)) for (const item of input.slice(-256)) {
          const name = own(item, "event"), detail = own(item, "detail");
          // Preferences are already formatted from finite enums. Reconstruct
          // their original input rather than trusting saved strings.
          let patch: Record<string, unknown> | undefined;
          if (name === "reader.preference" && typeof detail === "string" && detail.length < 256) {
            const parsed: Record<string, unknown> = Object.fromEntries(detail.split(", ").map(pair => pair.split("=")));
            if (parsed.amoled === "true" || parsed.amoled === "false") parsed.amoled = parsed.amoled === "true";
            patch = parsed;
          }
          const event = normalizeEvent(name, patch ?? detail), atMs = boundedNumber(own(item, "atMs"), MAX_AGE_MS);
          if (event && atMs !== undefined) events.push({ ...event, atMs });
        }
        sessions.push({ number, createdAt, build: normalizeBuild(own(source, "build")), events, dropped: boundedNumber(own(source, "dropped")) ?? 0 });
      }
      sessions = sessions.slice(0, 2);
      const sourceIssues = own(saved, "issues");
      if (Array.isArray(sourceIssues)) for (const source of sourceIssues.slice(-20)) {
        const error = normalizeSavedError(source), session = boundedNumber(own(source, "session"), 1_000_000_000);
        if (error && session !== undefined && sessions.some(s => s.number === session)) issues.push({ ...error, session,
          atMs: boundedNumber(own(source, "atMs"), MAX_AGE_MS) ?? 0, lastMs: boundedNumber(own(source, "lastMs"), MAX_AGE_MS) ?? 0,
          count: boundedNumber(own(source, "count"), 10_000) ?? 1 });
      }
      // Old measurements are validated again, never spread from disk.
      const input = own(saved, "measurements");
      if (Array.isArray(input)) for (const source of input.slice(-4)) {
        const kind = own(source, "kind"), session = boundedNumber(own(source, "session"), 1_000_000_000);
        if ((kind === "frames" || kind === "render") && session !== undefined && sessions.some(s => s.number === session)) measurements.push({ kind, session,
          atMs: boundedNumber(own(source, "atMs"), MAX_AGE_MS) ?? 0,
          value: kind === "frames" ? normalizeFrameStats(own(source, "value")) : normalizeRenderState(own(source, "value")) });
      }
    }
  } catch { /* Discard corrupted records, keeping the separate policy. */ }
  function newSession() { sessions.unshift({ number: (sessions[0]?.number ?? 0) + 1, createdAt: adapter.wall(), build, events: [], dropped: 0 }); sessions = sessions.slice(0, 3); start = adapter.monotonic(); }
  const elapsed = () => Math.max(0, Math.min(MAX_AGE_MS, adapter.monotonic() - start));
  function publish() {
    cachedStatus = { enabled, mode: !enabled ? "off" : detailedUntil > adapter.monotonic() ? "detailed" : "basic", generation, cutoff,
      remainingSeconds: Math.max(0, Math.ceil((detailedUntil - adapter.monotonic()) / 1000)), overlays: { ...overlays },
      events: sessions.reduce((sum, s) => sum + s.events.length, 0), issues: issues.length, bytes, storageAvailable,
      dropped: sessions.reduce((sum, s) => sum + s.dropped, 0) };
    listeners.forEach(listener => { try { listener(); } catch { /* Subscriber isolation. */ } });
  }
  function snapshot() {
    prune();
    // Only allowlisted records ever reach this point. Clone to prevent UI or
    // report code from mutating the live ring; omit local wall-clock anchors.
    return JSON.parse(JSON.stringify({ version: 2, policyVersion: POLICY_VERSION, build, sessions: sessions.map(({ createdAt, ...session }) => ({ ...session, startedAgoMs: Math.max(0, adapter.wall() - createdAt) })), issues, measurements })) as {
      version: number; policyVersion: number; build: SafeBuild; sessions: (Omit<Session, "createdAt"> & { startedAgoMs: number })[]; issues: Issue[]; measurements: Measurement[];
    };
  }
  function prune() {
    sessions = sessions.filter(s => s.createdAt >= cutoff && adapter.wall() >= s.createdAt && adapter.wall() - s.createdAt <= MAX_AGE_MS);
    const keep = new Set(sessions.map(s => s.number)); issues = issues.filter(e => keep.has(e.session)); measurements = measurements.filter(m => keep.has(m.session));
  }
  function flush() {
    if (flushTimer !== undefined) adapter.cancel(flushTimer);
    flushTimer = undefined;
    if (!enabled) return;
    prune();
    let value = JSON.stringify({ version: 2, sessions, issues, measurements });
    while (utf8Bytes(value) > 700_000 && sessions.length > 1) { sessions.pop(); prune(); value = JSON.stringify({ version: 2, sessions, issues, measurements }); }
    bytes = utf8Bytes(value); safeWrite("records-v2", value); publish();
  }
  function schedule() { if (flushTimer === undefined && enabled) flushTimer = adapter.schedule(flush, 1000); }
  function error(error: unknown, kind: ErrorKind, fatal = false) {
    if (!enabled) return null;
    if (!sessions.length) newSession();
    let normalized: SafeError;
    try { normalized = normalizeError(error, kind, fatal); } catch { return null; }
    const atMs = elapsed(), session = sessions[0].number;
    const previous = issues.find(e => e.session === session && e.code === normalized.code && e.kind === kind && e.fatal === fatal);
    if (previous) { previous.count = Math.min(10_000, previous.count + 1); previous.lastMs = atMs; }
    else { issues.push({ ...normalized, session, atMs, lastMs: atMs, count: 1 }); issues = issues.slice(-20); }
    if (fatal && !previous) safeWrite("fatal-v2", JSON.stringify({ ...normalized, session, atMs, createdAt: sessions[0].createdAt, build }));
    schedule(); publish(); return normalized;
  }
  const fatal = enabled ? safeRead("fatal-v2") : undefined;
  if (fatal) try {
    const value = JSON.parse(fatal), normalized = normalizeSavedError(value), session = boundedNumber(own(value, "session"), 1_000_000_000);
    const createdAt = boundedNumber(own(value, "createdAt"), Number.MAX_SAFE_INTEGER);
    if (normalized && session !== undefined && createdAt !== undefined && createdAt >= cutoff && adapter.wall() >= createdAt && adapter.wall() - createdAt <= MAX_AGE_MS) {
      if (!sessions.some(s => s.number === session)) sessions.unshift({ number: session, createdAt, build: normalizeBuild(own(value, "build")), events: [], dropped: 0 });
      if (!issues.some(e => e.session === session && e.code === normalized.code && e.fatal)) {
      const atMs = boundedNumber(own(value, "atMs"), MAX_AGE_MS) ?? 0;
      issues.push({ ...normalized, session, atMs, lastMs: atMs, count: 1 });
      }
    }
  } catch { /* No unvalidated recovery data. */ }
  if (enabled) newSession(); else { remove("records-v2"); remove("fatal-v2"); }
  function stop() { detailedUntil = 0; overlays = { status: false, performance: false, rendering: false, layout: false }; generation++; publish(); }
  function clear() {
    stop(); cutoff = Math.max(cutoff, adapter.wall()); sessions = []; issues = []; measurements = []; bytes = 0;
    if (flushTimer !== undefined) adapter.cancel(flushTimer); flushTimer = undefined;
    remove("records-v2"); remove("fatal-v2"); remove("report-v1");
    safeWrite("policy-v2", JSON.stringify({ enabled, cutoff }));
    if (enabled) newSession(); publish();
  }
  publish();
  return {
    status: () => cachedStatus, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, snapshot,
    flush, clear, error,
    setEnabled(value: boolean) { enabled = value === true; clear(); },
    event(name: DiagnosticEventName, detail?: unknown) {
      if (!enabled) return;
      const event = normalizeEvent(name, detail); if (!event) return;
      if (!sessions.length) newSession();
      const ring = sessions[0].events; ring.push({ ...event, atMs: elapsed() });
      if (ring.length > 256) { ring.shift(); sessions[0].dropped = Math.min(1_000_000, sessions[0].dropped + 1); }
      schedule();
    },
    startDetailed() { if (!enabled) return; prune(); if (!sessions.length) newSession(); detailedUntil = adapter.monotonic() + DETAIL_MS; generation++; publish(); },
    stopDetailed: stop,
    background() { stop(); if (flushTimer !== undefined) { adapter.cancel(flushTimer); flushTimer = undefined; } if (enabled) flush(); },
    tick() { if (detailedUntil && detailedUntil <= adapter.monotonic()) stop(); else publish(); },
    overlay(key: keyof typeof overlays, value: boolean) {
      if (!["status", "performance", "rendering", "layout"].includes(key)) return;
      if (!enabled || (key !== "status" && detailedUntil <= adapter.monotonic())) return;
      overlays = { ...overlays, [key]: value === true }; publish();
    },
    measurement(kind: "frames" | "render", value: unknown, token: number) {
      if (kind !== "frames" && kind !== "render") return;
      if (!enabled || token !== generation || !sessions.length) return;
      measurements.push({ kind, session: sessions[0].number, atMs: elapsed(), value: kind === "frames" ? normalizeFrameStats(value) : normalizeRenderState(value) });
      measurements = measurements.slice(-4); schedule(); publish();
    },
  };
}
