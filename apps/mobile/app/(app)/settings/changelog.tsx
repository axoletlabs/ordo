/** Release notes for published updates. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { ChangelogList } from "../../../src/components/settings/ChangelogList";
import {
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Spinner } from "../../../src/components/ui/Spinner";
import { useBuildInfo } from "../../../src/hooks/use-build-info";
import { useChangelog } from "../../../src/hooks/use-changelog";
import { useNativeUpdateStore } from "../../../src/store/native-update";

function failureMessage(status: number | null): string {
  if (status === 403 || status === 429) {
    return "GitHub is limiting requests. Try again in a few minutes.";
  }
  return "Check your connection and try again.";
}

export default function ChangelogScreen() {
  const build = useBuildInfo();
  const changelog = useChangelog();
  const availableVersion = useNativeUpdateStore((state) => state.release?.version ?? null);

  let body: React.ReactNode;
  if (changelog.releases == null) {
    body = changelog.errorStatus == null ? (
      <View style={styles.centered}>
        <Spinner size="lg" />
      </View>
    ) : (
      <View style={styles.centered}>
        <EmptyState
          icon="newspaper-outline"
          title="Couldn't load the changelog"
          message={failureMessage(changelog.errorStatus)}
          action={
            <Button label="Try again" variant="secondary" onPress={changelog.reload} />
          }
        />
      </View>
    );
  } else if (changelog.releases.length === 0) {
    body = (
      <SettingsScrollView refreshing={changelog.refreshing} onRefresh={changelog.reload}>
        <EmptyState
          icon="newspaper-outline"
          title="No releases yet"
          message="Published updates will show up here."
        />
      </SettingsScrollView>
    );
  } else {
    body = (
      <SettingsScrollView refreshing={changelog.refreshing} onRefresh={changelog.reload}>
        <ChangelogList
          releases={changelog.releases}
          currentVersion={build.version}
          availableVersion={availableVersion}
        />
      </SettingsScrollView>
    );
  }

  return <SettingsPage title="Changelog">{body}</SettingsPage>;
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center" },
});
