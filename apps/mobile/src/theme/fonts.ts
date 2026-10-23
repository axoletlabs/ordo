/**
 * Font loading. Launch waits only for the interface faces (Roboto, the icon
 * subset, JetBrains Mono for codes). Each reading typeface family loads when
 * the reader first needs it, so a cold start no longer copies, hashes and
 * parses ~4 MB of book fonts it may never draw.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Asset } from "expo-asset";
import * as Font from "expo-font";
import { Platform } from "react-native";
import type { ReaderFontFamily } from "@ordo/shared";
import { MaterialIcon } from "../components/ui/MaterialIcon";
// Import individual faces: the package barrels require every TTF and make
// Metro ship unused weights/styles. Mono text only uses 400 and 600.
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono/600SemiBold";
import { Roboto_400Regular } from "@expo-google-fonts/roboto/400Regular";
import { Roboto_500Medium } from "@expo-google-fonts/roboto/500Medium";
import { Roboto_700Bold } from "@expo-google-fonts/roboto/700Bold";

// Reading typefaces ship as local TTFs (see assets/fonts/README.md).
import Libron_400Regular from "../../assets/fonts/Libron-Regular.ttf";
import Libron_400Regular_Italic from "../../assets/fonts/Libron-Italic.ttf";
import Libron_700Bold from "../../assets/fonts/Libron-Bold.ttf";
import Libron_700BoldItalic from "../../assets/fonts/Libron-BoldItalic.ttf";
import NVLegibleNext_400Regular from "../../assets/fonts/NVLegibleNext-Regular.ttf";
import NVLegibleNext_400Regular_Italic from "../../assets/fonts/NVLegibleNext-Italic.ttf";
import NVLegibleNext_700Bold from "../../assets/fonts/NVLegibleNext-Bold.ttf";
import NVLegibleNext_700BoldItalic from "../../assets/fonts/NVLegibleNext-BoldItalic.ttf";
import NVGaramond_400Regular from "../../assets/fonts/NVGaramond-Regular.ttf";
import NVGaramond_400Regular_Italic from "../../assets/fonts/NVGaramond-Italic.ttf";
import NVGaramond_700Bold from "../../assets/fonts/NVGaramond-Bold.ttf";
import NVGaramond_700BoldItalic from "../../assets/fonts/NVGaramond-BoldItalic.ttf";
import NVBitter_400Regular from "../../assets/fonts/NVBitter-Regular.ttf";
import NVBitter_400Regular_Italic from "../../assets/fonts/NVBitter-Italic.ttf";
import NVBitter_700Bold from "../../assets/fonts/NVBitter-Bold.ttf";
import NVBitter_700BoldItalic from "../../assets/fonts/NVBitter-BoldItalic.ttf";
import NVJost_400Regular from "../../assets/fonts/NVJost-Regular.ttf";
import NVJost_400Regular_Italic from "../../assets/fonts/NVJost-Italic.ttf";
import NVJost_700Bold from "../../assets/fonts/NVJost-Bold.ttf";
import NVJost_700BoldItalic from "../../assets/fonts/NVJost-BoldItalic.ttf";

// Preview-only ASCII subsets. They are separate registered families so they can
// never satisfy (or shadow) the article's full reader families. See
// assets/fonts/README.md for regeneration.
import Libron_400Regular_Preview from "../../assets/fonts/Libron-Preview.ttf";
import NVLegibleNext_400Regular_Preview from "../../assets/fonts/NVLegibleNext-Preview.ttf";
import NVGaramond_400Regular_Preview from "../../assets/fonts/NVGaramond-Preview.ttf";
import NVBitter_400Regular_Preview from "../../assets/fonts/NVBitter-Preview.ttf";
import NVJost_400Regular_Preview from "../../assets/fonts/NVJost-Preview.ttf";

/** Faces every screen can draw; the root layout holds the splash for these. */
export const launchFonts = {
  ...MaterialIcon.font,
  Roboto_400Regular,
  Roboto_500Medium,
  Roboto_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_600SemiBold,
};

const READER_FONTS: Record<ReaderFontFamily, Record<string, number>> = {
  serif: { Libron_400Regular, Libron_400Regular_Italic, Libron_700Bold, Libron_700BoldItalic },
  sans: {
    NVLegibleNext_400Regular,
    NVLegibleNext_400Regular_Italic,
    NVLegibleNext_700Bold,
    NVLegibleNext_700BoldItalic,
  },
  garamond: { NVGaramond_400Regular, NVGaramond_400Regular_Italic, NVGaramond_700Bold, NVGaramond_700BoldItalic },
  bitter: { NVBitter_400Regular, NVBitter_400Regular_Italic, NVBitter_700Bold, NVBitter_700BoldItalic },
  jost: { NVJost_400Regular, NVJost_400Regular_Italic, NVJost_700Bold, NVJost_700BoldItalic },
};

/** Full regular face for each family; the article's fontFamily value. */
const READER_REGULAR_FONTS: Record<ReaderFontFamily, string> = {
  serif: "Libron_400Regular",
  sans: "NVLegibleNext_400Regular",
  garamond: "NVGaramond_400Regular",
  bitter: "NVBitter_400Regular",
  jost: "NVJost_400Regular",
};

/** Distinct registered family for the tiny preview subset. Keeping these
 * separate from READER_FONTS is what prevents a preview arrival from marking
 * the article's full family ready (or shadowing its glyph coverage). */
const READER_PREVIEW_FAMILIES: Record<ReaderFontFamily, string> = {
  serif: "Libron_400Regular_Preview",
  sans: "NVLegibleNext_400Regular_Preview",
  garamond: "NVGaramond_400Regular_Preview",
  bitter: "NVBitter_400Regular_Preview",
  jost: "NVJost_400Regular_Preview",
};

/** The one ASCII subset a typeface preview draws. Italic/bold faces only load
 * once the reader actually draws that family; preview labels never need them. */
const READER_PREVIEW_FONTS: Record<ReaderFontFamily, Record<string, number>> = {
  serif: { Libron_400Regular_Preview },
  sans: { NVLegibleNext_400Regular_Preview },
  garamond: { NVGaramond_400Regular_Preview },
  bitter: { NVBitter_400Regular_Preview },
  jost: { NVJost_400Regular_Preview },
};

export const READER_FONT_FAMILY_LIST = Object.keys(READER_FONTS) as ReaderFontFamily[];

type WebPreviewFace = { family: ReaderFontFamily; face: FontFace; fonts: FontFaceSet };
type PendingPreviewFace = {
  loaded: WebPreviewFace;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const ready = new Set<ReaderFontFamily>();
const previewReady = new Set<ReaderFontFamily>();
const loading = new Map<ReaderFontFamily, Promise<void>>();
const previewLoading = new Map<ReaderFontFamily, Promise<void>>();
/** Web face loads only, shared by the single, batch and dormant-prefetch APIs.
 * Registration is separate so prefetch can cache loaded faces without touching
 * document.fonts. */
const previewFaceLoading = new Map<ReaderFontFamily, Promise<WebPreviewFace>>();
const registeredPreviewFaces = new WeakSet<FontFace>();
/** Faces whose load completed and are waiting for the next registration frame. */
const pendingPreviewFaces = new Map<ReaderFontFamily, PendingPreviewFace>();
let previewRegistrationFrame: number | null = null;
const listeners = new Set<() => void>();
const familyListeners = new Map<ReaderFontFamily, Set<() => void>>();
let revision = 0;

function markReady(family: ReaderFontFamily) {
  ready.add(family);
  previewReady.add(family);
  revision += 1;
  familyListeners.get(family)?.forEach((notify) => notify());
  listeners.forEach((notify) => notify());
}

/** Publish a whole batch with one revision/notification. */
function markPreviewReadyBatch(families: readonly ReaderFontFamily[]) {
  let changed = false;
  for (const family of families) {
    if (previewReady.has(family)) continue;
    previewReady.add(family);
    changed = true;
  }
  if (!changed) return;
  revision += 1;
  listeners.forEach((notify) => notify());
}

function markPreviewReady(family: ReaderFontFamily) {
  markPreviewReadyBatch([family]);
}

export function readerFontsReady(family: ReaderFontFamily): boolean {
  return ready.has(family);
}

/** A preview label can draw: either the full regular face (all full faces
 * imply it) or the preview subset is loaded. */
export function readerFontPreviewReady(family: ReaderFontFamily): boolean {
  return previewReady.has(family);
}

/** The fontFamily a preview label should draw right now: the full regular face
 * once the article family is ready, otherwise the loaded preview subset.
 * `undefined` means draw the UI's fallback face (never an unloaded family). */
export function resolveReaderFontPreview(family: ReaderFontFamily): string | undefined {
  if (ready.has(family)) return READER_REGULAR_FONTS[family];
  if (previewReady.has(family)) return READER_PREVIEW_FAMILIES[family];
  return undefined;
}

/** Load one reading family (all four faces). Failures fall back to system text. */
export function loadReaderFonts(family: ReaderFontFamily): Promise<void> {
  if (ready.has(family)) return Promise.resolve();
  let task = loading.get(family);
  if (!task) {
    task = Font.loadAsync(READER_FONTS[family])
      .catch((error: unknown) => console.warn(`Reader font ${family} failed to load`, error))
      .then(() => markReady(family));
    loading.set(family, task);
  }
  return task;
}

function previewFailure(family: ReaderFontFamily, error: unknown): void {
  // Do not mark readiness: a preview subset that failed to register must not
  // make the label draw a missing family. Clear the coalescing entry so the
  // next request can retry.
  previewLoading.delete(family);
  previewFaceLoading.delete(family);
  console.warn(`Reader font preview ${family} failed to load`, error);
}

/**
 * Modern web path: a real FontFace added to document.fonts. Unlike
 * ExpoFontLoader.loadAsync this never creates/replaces the shared
 * `expo-generated-fonts` stylesheet and never polls with FontFaceObserver.
 * The face is fully loaded before it is added or marked ready, so the first
 * React frame that draws the preview family already has the glyphs.
 *
 * Preview families are private: no app code queries Font.isLoaded/isLoading
 * for them, so not populating Expo's web memory cache is intentional. Full
 * families and launch fonts still use Expo's loader/cache unchanged.
 *
 * Native, SSR, old browsers, and unresolved Expo asset URIs return null and
 * use the existing Expo loader unchanged.
 */
function createWebPreviewFontFace(
  family: ReaderFontFamily,
): { face: FontFace; fonts: FontFaceSet } | null {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof document === "undefined") return null;
  if (typeof FontFace === "undefined" || !document.fonts || typeof document.fonts.add !== "function") return null;
  const familyName = READER_PREVIEW_FAMILIES[family];
  const assetModule = READER_PREVIEW_FONTS[family][familyName];
  if (!familyName || assetModule == null) return null;
  let uri: string | null = null;
  try {
    const asset = Asset.fromModule(assetModule);
    uri = asset.uri || asset.localUri || null;
  } catch {
    return null;
  }
  if (!uri) return null;
  try {
    const face = new FontFace(familyName, `url(${JSON.stringify(uri)})`, { display: "swap" });
    if (typeof face.load !== "function") return null;
    return { face, fonts: document.fonts };
  } catch {
    return null;
  }
}

/** Share one FontFace.load() per family between single and batch callers. */
function queueWebPreviewFace(family: ReaderFontFamily): Promise<WebPreviewFace> | null {
  const existing = previewFaceLoading.get(family);
  if (existing) return existing;
  const web = createWebPreviewFontFace(family);
  if (!web) return null;
  let task: Promise<WebPreviewFace>;
  try {
    task = web.face.load()
      .then(() => ({ family, face: web.face, fonts: web.fonts }))
      .catch((error: unknown) => {
        previewFaceLoading.delete(family);
        throw error;
      });
  } catch (error) {
    return Promise.reject(error);
  }
  previewFaceLoading.set(family, task);
  return task;
}

/** Add one loaded face. The WeakSet makes the single/batch race idempotent. */
function registerWebPreviewFace(loaded: WebPreviewFace): void {
  try {
    if (!registeredPreviewFaces.has(loaded.face)) {
      loaded.fonts.add(loaded.face);
      registeredPreviewFaces.add(loaded.face);
    }
  } finally {
    previewFaceLoading.delete(loaded.family);
  }
}

/** One frame for every face that finished loading before it. A slow face joins
 * a later frame instead of holding up the fast faces. */
function flushPreviewRegistration() {
  previewRegistrationFrame = null;
  const entries = Array.from(pendingPreviewFaces.values());
  pendingPreviewFaces.clear();
  const readyFamilies: ReaderFontFamily[] = [];
  const resolved: PendingPreviewFace[] = [];
  const rejected: { entry: PendingPreviewFace; error: unknown }[] = [];
  for (const entry of entries) {
    if (previewReady.has(entry.loaded.family)) {
      previewFaceLoading.delete(entry.loaded.family);
      resolved.push(entry);
      continue;
    }
    try {
      registerWebPreviewFace(entry.loaded);
      readyFamilies.push(entry.loaded.family);
      resolved.push(entry);
    } catch (error) {
      rejected.push({ entry, error });
    }
  }
  try {
    // Readiness is published only after every face in this frame was added.
    markPreviewReadyBatch(readyFamilies);
  } finally {
    // A throwing revision subscriber must not strand the promises that are
    // already backed by registered faces. Settle this frame and keep the queue
    // moving, then let the subscriber error propagate to the frame caller.
    for (const entry of resolved) entry.resolve();
    for (const { entry, error } of rejected) entry.reject(error);
    if (pendingPreviewFaces.size) schedulePreviewRegistration();
  }
}

function schedulePreviewRegistration() {
  if (previewRegistrationFrame !== null) return;
  if (typeof requestAnimationFrame === "function") {
    previewRegistrationFrame = requestAnimationFrame(flushPreviewRegistration);
    return;
  }
  // Non-browser test/SSR-like environments: still coalesce to one microtask.
  previewRegistrationFrame = -1;
  queueMicrotask(flushPreviewRegistration);
}

/** Enqueue a fully loaded face and return its registration promise. */
function enqueuePreviewRegistration(loaded: WebPreviewFace): Promise<void> {
  if (previewReady.has(loaded.family)) {
    previewFaceLoading.delete(loaded.family);
    return Promise.resolve();
  }
  const existing = pendingPreviewFaces.get(loaded.family);
  if (existing) return existing.promise;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  pendingPreviewFaces.set(loaded.family, { loaded, promise, resolve, reject });
  schedulePreviewRegistration();
  return promise;
}

/** Fallback for native and browsers without the modern FontFace API. */
function loadPreviewWithExpo(family: ReaderFontFamily): Promise<void> {
  return Font.loadAsync(READER_PREVIEW_FONTS[family])
    .then(() => markPreviewReady(family))
    .catch((error: unknown) => previewFailure(family, error));
}

/**
 * Load only the preview subset, for the controls panel's typeface labels.
 * A full family request already covers the preview label, so it is reused
 * instead of registering the subset twice. A failed preview load is logged,
 * leaves readiness untouched, and is removed from the in-flight map so a later
 * call retries; it resolves rather than rejecting because existing callers use
 * `void loadReaderFontPreview(...)`.
 */
export function loadReaderFontPreview(family: ReaderFontFamily): Promise<void> {
  if (previewReady.has(family)) return Promise.resolve();
  // A full family load already covers the preview face and is the preferred
  // preview family once it lands.
  const full = loading.get(family);
  if (full) return full;
  let task = previewLoading.get(family);
  if (!task) {
    const faceTask = queueWebPreviewFace(family);
    task = faceTask
      ? faceTask
          .then((loaded) => enqueuePreviewRegistration(loaded))
          .catch((error: unknown) => previewFailure(family, error))
      : loadPreviewWithExpo(family);
    previewLoading.set(family, task);
  }
  return task;
}

/**
 * Web batch path. Load every missing face in parallel (no web stagger). Each
 * loaded face joins the shared next-frame registration queue, so fast faces
 * become usable in the next frame even if another face is slow or hung. The
 * returned promise may await every requested registration, but UI readiness
 * does not wait for the slowest face. Single API callers share the same
 * `previewLoading` registration promises; a failed family is removed from the
 * maps and remains retryable.
 */
export function loadReaderFontPreviews(families: readonly ReaderFontFamily[]): Promise<void> {
  const wanted = Array.from(new Set(families))
    .filter((family) => !previewReady.has(family));
  if (!wanted.length) return Promise.resolve();
  return Promise.allSettled(wanted.map((family) => loadReaderFontPreview(family)))
    .then(() => undefined);
}

/**
 * Dormant web-only prefetch: fetch/decode FontFaces in parallel but never add
 * them to document.fonts or mark readiness. Keeping the loaded faces in
 * previewFaceLoading lets the later visible/entered registration reuse the
 * exact FontFace objects without another fetch or decode. No old-web/Expo
 * fallback runs here; if the modern API is unavailable this is a no-op until
 * the visible registration path takes over.
 */
export function preloadReaderFontPreviews(families: readonly ReaderFontFamily[]): Promise<void> {
  if (Platform.OS !== "web") return Promise.resolve();
  const wanted = Array.from(new Set(families))
    .filter((family) => !previewReady.has(family) && !loading.has(family));
  if (!wanted.length) return Promise.resolve();
  const tasks: Promise<unknown>[] = [];
  for (const family of wanted) {
    const task = queueWebPreviewFace(family);
    if (!task) continue;
    tasks.push(task.catch((error: unknown) => previewFailure(family, error)));
  }
  return Promise.allSettled(tasks).then(() => undefined);
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}
const currentRevision = () => revision;

/** Watch only one reading family. Preview faces for the controls panel must
 * not re-render the article that is already drawing another family. */
function subscribeReaderFont(family: ReaderFontFamily, notify: () => void): () => void {
  let familySet = familyListeners.get(family);
  if (!familySet) {
    familySet = new Set();
    familyListeners.set(family, familySet);
  }
  familySet.add(notify);
  return () => {
    familySet.delete(notify);
    if (!familySet.size) familyListeners.delete(family);
  };
}

/** Re-render when any reading family finishes loading. */
export function useReaderFontRevision(): number {
  return useSyncExternalStore(subscribe, currentRevision, currentRevision);
}

/**
 * The family to draw: `family` once its faces are loaded, otherwise the last
 * family this caller drew (so switching never flashes a fallback face), or
 * null before any family is ready. Native text keeps the face it was laid out
 * with, so callers must not render reading text with an unloaded family.
 *
 * Only this family's readiness is subscribed: the controls panel loads the
 * other preview families in the background, and that must not re-render the
 * article for every face that arrives.
 */
export function useReaderFontFamily(family: ReaderFontFamily): ReaderFontFamily | null {
  const subscribeFamily = useCallback((notify: () => void) => subscribeReaderFont(family, notify), [family]);
  const getSnapshot = useCallback(() => readerFontsReady(family), [family]);
  const isReady = useSyncExternalStore(subscribeFamily, getSnapshot, getSnapshot);
  // The last family this caller drew. A ref, not state: readiness already
  // re-renders through the store, and an extra state update per face batch
  // would reconcile the article twice.
  const shown = useRef<ReaderFontFamily | null>(isReady ? family : null);
  useEffect(() => {
    if (isReady) shown.current = family;
    else void loadReaderFonts(family);
  }, [family, isReady]);
  return isReady ? family : shown.current;
}
