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
  const [checkedUrl, setCheckedUrl] = useState<string | null>(null);
  const [probeDetail, setProbeDetail] = useState<string | null>(null);
  const [probeInfo, setProbeInfo] = useState<Pick<ServerInfoDto, "name" | "version"> | null>(
    null,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const normalized = normalizeServerUrl(url);
    setCheckedUrl(null);
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
        setCheckedUrl(normalized);
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
  const isUnchanged = normalized === normalizeServerUrl(currentUrl);
  // A successful response belongs only to the address it checked. During the
  // debounce, the previous result must never enable a different destination.
  const verified = normalized !== null && checkedUrl === normalized;
  const pending = active && Boolean(normalized) && !isUnchanged && (!verified || probing);
  const probeCopy = describeProbeField({
    idle: !url.trim() || isUnchanged,
    probing: pending,
    reachable: verified && up,
    detail: normalized ? probeDetail : "Invalid URL",
    info: verified ? probeInfo : null,
  });
  const canChange = active && verified && !isUnchanged && up && !probing;

  return {
    probing: pending,
    up: verified && up,
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
