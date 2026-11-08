/**
 * Connectivity awareness. A tiny store updated by an expo-network subscription
 * drives the full-screen offline gate and pauses React Query retries.
 */
import { create } from "zustand";
import { onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import { networkStateIsOnline } from "./network-state";

interface OnlineState {
  online: boolean;
  init: () => Promise<void>;
}

function applyNetworkState(
  state: Network.NetworkState,
  set: (partial: Partial<OnlineState>) => void,
) {
  const online = networkStateIsOnline(state);
  set({ online });
  onlineManager.setOnline(online);
}

/** Guards the native subscription against effect re-runs (StrictMode, fast
 * refresh, a remounted provider): one listener per process. */
let networkInit: Promise<void> | null = null;

export const useOnlineStore = create<OnlineState>((set) => ({
  online: true,
  init: () => {
    if (networkInit) return networkInit;
    networkInit = (async () => {
      try {
        applyNetworkState(await Network.getNetworkStateAsync(), set);
      } catch {
        set({ online: true });
        onlineManager.setOnline(true);
      }
      try {
        Network.addNetworkStateListener((state) => applyNetworkState(state, set));
      } catch {
        /* keep the last known state; retry on the next init call */
        networkInit = null;
      }
    })();
    return networkInit;
  },
}));

export const useOnline = () => useOnlineStore((s) => s.online);
