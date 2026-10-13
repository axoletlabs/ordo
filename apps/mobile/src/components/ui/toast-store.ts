/**
 * Toast store + hook. A single notification primitive for the whole app:
 * queued, auto-dismissing, with an optional inline action and swipe-to-dismiss.
 */
import { create } from "zustand";

export type ToastTone = "default" | "success" | "danger";

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  /** Optional inline action (e.g. "Restart"). Dismisses the toast on tap. */
  action?: ToastAction;
  duration: number;
  /** Allow swipe-to-dismiss. */
  swipeable: boolean;
  onDismiss?: () => void;
}

export interface ShowToastOptions {
  tone?: ToastTone;
  action?: ToastAction;
  duration?: number;
  swipeable?: boolean;
  /** Called once when the toast leaves, including after its action is pressed. */
  onDismiss?: () => void;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, opts?: ShowToastOptions) => string;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, opts) => {
    const id = `t${++counter}`;
    const toast: Toast = {
      id,
      message,
      tone: opts?.tone ?? "default",
      action: opts?.action,
      duration: opts?.duration ?? 4000,
      swipeable: opts?.swipeable ?? true,
      onDismiss: opts?.onDismiss,
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    return id;
  },
  dismiss: (id) => {
    const current = get().toasts.find((item) => item.id === id);
    if (!current) return;
    set((s) => ({ toasts: s.toasts.filter((item) => item.id !== id) }));
    current.onDismiss?.();
  },
}));

/** Imperative API for non-React call sites (mutations, watchers). */
export const toast = {
  show: (message: string, opts?: ShowToastOptions) => useToastStore.getState().show(message, opts),
  success: (message: string, opts?: Omit<ShowToastOptions, "tone">) =>
    useToastStore.getState().show(message, { ...opts, tone: "success" }),
  error: (message: string, opts?: Omit<ShowToastOptions, "tone">) =>
    useToastStore.getState().show(message, { ...opts, tone: "danger" }),
};
