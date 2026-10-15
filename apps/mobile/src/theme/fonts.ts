/**
 * Font loading. Launch waits only for the interface faces (Roboto, the icon
 * subset, JetBrains Mono for codes). Each reading typeface family loads when
 * the reader first needs it, so a cold start no longer copies, hashes and
 * parses ~4 MB of book fonts it may never draw.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import * as Font from "expo-font";
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

export const READER_FONT_FAMILY_LIST = Object.keys(READER_FONTS) as ReaderFontFamily[];

const ready = new Set<ReaderFontFamily>();
const loading = new Map<ReaderFontFamily, Promise<void>>();
const listeners = new Set<() => void>();
let revision = 0;

function markReady(family: ReaderFontFamily) {
  ready.add(family);
  revision += 1;
  listeners.forEach((notify) => notify());
}

export function readerFontsReady(family: ReaderFontFamily): boolean {
  return ready.has(family);
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

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}
const currentRevision = () => revision;

/** Re-render when any reading family finishes loading. */
export function useReaderFontRevision(): number {
  return useSyncExternalStore(subscribe, currentRevision, currentRevision);
}

/**
 * The family to draw: `family` once its faces are loaded, otherwise the last
 * family this caller drew (so switching never flashes a fallback face), or
 * null before any family is ready. Native text keeps the face it was laid out
 * with, so callers must not render reading text with an unloaded family.
 */
export function useReaderFontFamily(family: ReaderFontFamily): ReaderFontFamily | null {
  const fontRevision = useReaderFontRevision();
  const [shown, setShown] = useState<ReaderFontFamily | null>(() => (ready.has(family) ? family : null));
  const current = ready.has(family) ? family : shown;
  useEffect(() => {
    if (ready.has(family)) setShown(family);
    else void loadReaderFonts(family);
  }, [family, fontRevision]);
  return current;
}
