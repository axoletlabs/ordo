import React from "react";
import { useSettingsStore } from "../../store/settings";
import { ContextMenuItem } from "../ui/ContextMenu";
import { Toggle } from "../ui/Toggle";

/** The website menu always controls the global preference. */
export function BrowserAdBlockingToggle() {
  const enabled = useSettingsStore((s) => s.blockWebsiteAds);
  const setEnabled = useSettingsStore((s) => s.setBlockWebsiteAds);
  return <ContextMenuItem icon="shield-checkmark-outline" label="Block ads"
    selectionRole="menuitemcheckbox" selected={enabled} showSelectionIndicator={false}
    trailing={<Toggle value={enabled} onValueChange={setEnabled} displayOnly />}
    onPress={() => setEnabled(!enabled)} />;
}
