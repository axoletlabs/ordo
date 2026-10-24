import React from "react";
import { useSettingsStore } from "../../store/settings";
import { spacing } from "../../theme/tokens";
import { ContextMenuItem } from "../ui/ContextMenu";
import { Text } from "../ui/Text";

export function BrowserAdBlockingMenu({ siteHost, onBack, onDone }: {
  siteHost: string | null; onBack: () => void; onDone: () => void;
}) {
  const enabled = useSettingsStore((s) => s.blockWebsiteAds);
  const allowed = useSettingsStore((s) => !!siteHost && s.adBlockAllowedHosts.includes(siteHost));
  const setEnabled = useSettingsStore((s) => s.setBlockWebsiteAds);
  const setAllowed = useSettingsStore((s) => s.setSiteAdsAllowed);
  return <>
    <ContextMenuItem icon="arrow-back-outline" label="Page actions" onPress={onBack} />
    <ContextMenuItem icon="shield-checkmark-outline" label="Block ads on websites"
      selected={enabled} selectionRole="menuitemcheckbox" onPress={() => { onDone(); setEnabled(!enabled); }} />
    {siteHost ? <ContextMenuItem icon="globe-outline" label={`Allow ads on ${siteHost}`}
      selected={allowed} selectionRole="menuitemcheckbox" onPress={() => { onDone(); setAllowed(siteHost, !allowed); }} /> : null}
    <Text variant="footnote" color="secondary" style={{ paddingHorizontal: spacing[16], paddingVertical: spacing[8] }}>
      {enabled ? "If a page doesn't work as expected, allow ads for this site. Your choice is saved on this device."
        : "Ad blocking is off for all websites. Site exceptions are saved for when you turn it on again."}
    </Text>
  </>;
}
