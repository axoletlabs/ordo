/** Release notes, one version at a time. */
import { useRouter } from "expo-router";
import { ChangelogSheet } from "../../../src/components/settings/ChangelogList";
import { SettingsPage } from "../../../src/components/settings/SettingsPage";

export default function ChangelogScreen() {
  const router = useRouter();
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  return (
    <SettingsPage title="Changelog">
      <ChangelogSheet visible onDismiss={close} />
    </SettingsPage>
  );
}
