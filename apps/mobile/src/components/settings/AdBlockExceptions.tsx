import React from "react";
import { FlatList } from "react-native";
import { adBlockExceptionHost } from "../../lib/browser-ad-blocking";
import { useSettingsStore } from "../../store/settings";
import { spacing } from "../../theme/tokens";
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
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
  const [address, setAddress] = React.useState("");
  const [error, setError] = React.useState("");
  const sorted = React.useMemo(() => [...hosts].sort(), [hosts]);
  React.useEffect(() => { if (!visible) setAdding(false); }, [visible]);
  const finishAdding = () => { dismissKeyboard(); setAdding(false); };
  const submit = () => {
    const host = adBlockExceptionHost(address);
    if (!host) { setError("Enter a website address."); return; }
    if (hosts.includes(host)) { setError("Site already added."); return; }
    setAllowed(host, true);
    finishAdding();
  };
  return <FloatingPanel visible={visible} pageKey={adding ? "add" : "list"}
    onDismiss={adding ? finishAdding : onDismiss} scrollBody={adding}>
    {adding ? <>
      <PanelHeader key="add-header" title="Add site" />
      <Input key="address" label="Website" placeholder="example.com" value={address} autoFocus
        autoCapitalize="none" autoCorrect={false} keyboardType="url" autoComplete="off"
        required showRequiredIndicator={false} maxLength={2048} returnKeyType="done"
        onChangeText={(value) => { setAddress(value); setError(""); }}
        error={error || undefined} onSubmitEditing={submit} />
      <PanelActions key="add-actions" confirmLabel="Add" onConfirm={submit} onCancel={finishAdding} />
    </> : <>
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
      <PanelActions confirmLabel="Add site" onConfirm={() => { setAddress(""); setError(""); setAdding(true); }}
        cancelLabel="Done" onCancel={onDismiss} />
    </>}
  </FloatingPanel>;
}
