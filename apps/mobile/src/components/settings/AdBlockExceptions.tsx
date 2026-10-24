import React from "react";
import { FlatList } from "react-native";
import { adBlockExceptionHost } from "../../lib/browser-ad-blocking";
import { useSettingsStore } from "../../store/settings";
import { spacing } from "../../theme/tokens";
import { FloatingPanel } from "../ui/FloatingPanel";
import { IconButton } from "../ui/IconButton";
import { Input } from "../ui/Input";
import { PanelHeader } from "../ui/PanelHeader";
import { PanelActions } from "../ui/SheetActionRow";
import { SettingRow } from "../ui/SettingRow";
import { Text } from "../ui/Text";

export function AdBlockExceptions({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const hosts = useSettingsStore((s) => s.adBlockAllowedHosts);
  const setAllowed = useSettingsStore((s) => s.setSiteAdsAllowed);
  const [adding, setAdding] = React.useState(false);
  const sorted = React.useMemo(() => [...hosts].sort(), [hosts]);
  React.useEffect(() => { if (!visible) setAdding(false); }, [visible]);
  return <>
    <FloatingPanel visible={visible} obscured={adding} onDismiss={onDismiss} scrollBody={false}>
      <PanelHeader title="Site exceptions" subtitle="Ads are allowed on these sites." onClose={onDismiss} />
      <FlatList data={sorted} keyExtractor={(host) => host} keyboardShouldPersistTaps="handled"
        style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ paddingBottom: spacing[8] }}
        renderItem={({ item, index }) => <SettingRow icon="globe-outline" label={item} labelLines={0}
          position={sorted.length === 1 ? "only" : index === 0 ? "first" : index === sorted.length - 1 ? "last" : "middle"}
          rightFit="content" right={<IconButton name="close" variant="standard"
            accessibilityLabel={`Remove ${item}`} onPress={() => setAllowed(item, false)} />} />}
        ListEmptyComponent={<Text variant="bodyMedium" color="secondary" style={{ paddingVertical: spacing[16] }}>
          No site exceptions
        </Text>} />
      <PanelActions confirmLabel="Add site" onConfirm={() => setAdding(true)} cancelLabel="Done" onCancel={onDismiss} />
    </FloatingPanel>
    <AddSiteException visible={visible && adding} onDismiss={() => setAdding(false)} />
  </>;
}

function AddSiteException({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const [address, setAddress] = React.useState("");
  const [error, setError] = React.useState("");
  const setAllowed = useSettingsStore((s) => s.setSiteAdsAllowed);
  React.useEffect(() => { if (visible) { setAddress(""); setError(""); } }, [visible]);
  const submit = () => {
    const host = adBlockExceptionHost(address);
    if (!host) { setError("Enter a website address."); return; }
    if (useSettingsStore.getState().adBlockAllowedHosts.includes(host)) { setError("Site already added."); return; }
    setAllowed(host, true);
    onDismiss();
  };
  return <FloatingPanel visible={visible} onDismiss={onDismiss}>
    <PanelHeader title="Add site" />
    <Input label="Website" placeholder="example.com" value={address} autoFocus
      autoCapitalize="none" autoCorrect={false} keyboardType="url" autoComplete="off"
      required showRequiredIndicator={false} maxLength={2048} returnKeyType="done"
      onChangeText={(value) => { setAddress(value); setError(""); }}
      error={error || undefined} onSubmitEditing={submit} />
    <PanelActions confirmLabel="Add" onConfirm={submit} onCancel={onDismiss} />
  </FloatingPanel>;
}
