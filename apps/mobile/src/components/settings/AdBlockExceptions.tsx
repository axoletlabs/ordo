import React from "react";
import { FlatList } from "react-native";
import { useSettingsStore } from "../../store/settings";
import { spacing } from "../../theme/tokens";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { PanelActions } from "../ui/SheetActionRow";
import { SettingRow } from "../ui/SettingRow";
import { Text } from "../ui/Text";
import { Toggle } from "../ui/Toggle";

export function AdBlockExceptions({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const hosts = useSettingsStore((s) => s.adBlockAllowedHosts);
  const enabled = useSettingsStore((s) => s.blockWebsiteAds);
  const setAllowed = useSettingsStore((s) => s.setSiteAdsAllowed);
  const clear = useSettingsStore((s) => s.clearAdBlockAllowedHosts);
  const sorted = React.useMemo(() => [...hosts].sort(), [hosts]);
  return <FloatingPanel visible={visible} onDismiss={onDismiss} scrollBody={false}>
    <PanelHeader title="Site exceptions" onClose={onDismiss}
      subtitle={enabled ? "Ads are allowed on these exact website addresses. Turn off an exception to block ads there again."
        : "Ad blocking is off for all websites. These exceptions will apply when you turn it on again."} />
    <FlatList data={sorted} keyExtractor={(host) => host} keyboardShouldPersistTaps="handled"
      style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ paddingBottom: spacing[8] }}
      renderItem={({ item, index }) => <SettingRow icon="globe-outline" label={`Allow ads on ${item}`} labelLines={0}
        position={sorted.length === 1 ? "only" : index === 0 ? "first" : index === sorted.length - 1 ? "last" : "middle"}
        rightFit="content" right={<Toggle value onValueChange={() => setAllowed(item, false)} />} />}
      ListEmptyComponent={<Text variant="bodyMedium" color="secondary" style={{ paddingVertical: spacing[16] }}>
        No site exceptions. To allow ads on a website, open its page menu and choose Ad blocking.
      </Text>} />
    <PanelActions confirmLabel="Done" onConfirm={onDismiss} cancelLabel="Reset all" onCancel={clear}
      cancelDisabled={hosts.length === 0} />
  </FloatingPanel>;
}
