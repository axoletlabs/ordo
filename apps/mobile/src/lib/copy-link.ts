import * as Clipboard from "expo-clipboard";
import { toast } from "../components/ui/toast-store";
import { haptics } from "./haptics";

export async function copyLink(url: string): Promise<void> {
  return copyLinks([url]);
}

export async function copyLinks(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  haptics.light();
  try {
    await Clipboard.setStringAsync(urls.join("\n"));
    toast.success(urls.length === 1 ? "Link copied" : `${urls.length} links copied`);
  } catch {
    toast.error(urls.length === 1 ? "Couldn't copy the link." : "Couldn't copy the links.");
  }
}

export async function copyText(value: string, success = "Copied"): Promise<void> {
  if (!value) return;
  haptics.light();
  try {
    await Clipboard.setStringAsync(value);
    toast.success(success);
  } catch {
    toast.error("Couldn't copy that.");
  }
}
