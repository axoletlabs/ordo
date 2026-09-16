/**
 * Debounced live probe of a candidate server URL. Never writes the URL store.
 */
import { useEffect, useRef, useState } from "react";
import type { ServerInfoDto } from "@ordo/shared";
import {
  describeProbeField,
  normalizeServerUrl,
  probeServer,
} from "../lib/server-probe";

const PROBE_DEBOUNCE_MS = 900;

export function useServerProbe(url: string, currentUrl: string, active: boolean) {
  const [probing, setProbing] = useState(false);
  const [up, setUp] = useState(false);
  const [probeDetail, setProbeDetail] = useState<string | null>(null);
  const [probeInfo, setProbeInfo] = useState<Pick<ServerInfoDto, "name" | "version"> | null>(
    null,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const normalized = normalizeServerUrl(url);
    if (!normalized || normalized === normalizeServerUrl(currentUrl)) {
      setUp(false);
      setProbeDetail(null);
      setProbeInfo(null);
      setProbing(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (cancelled) return;
      setProbing(true);
      setUp(false);
      setProbeDetail(null);
      setProbeInfo(null);
      void probeServer(url).then((result) => {
        if (cancelled) return;
        setProbing(false);
        setUp(result.status === "up");
        setProbeDetail(result.detail ?? null);
        setProbeInfo(result.info ?? null);
      });
    }, PROBE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [active, currentUrl, url]);

  const normalized = normalizeServerUrl(url);
  const isUnchanged = !normalized || normalized === normalizeServerUrl(currentUrl);
  const probeCopy = describeProbeField({
    idle: isUnchanged,
    probing,
    reachable: up,
    detail: probeDetail,
    info: probeInfo,
  });
  const canChange = Boolean(normalized) && !isUnchanged && up && !probing;

  return {
    probing,
    up,
    probeDetail,
    probeInfo,
    probeCopy,
    normalized,
    isUnchanged,
    canChange,
    setUp,
    setProbeDetail,
    setProbeInfo,
  };
}
