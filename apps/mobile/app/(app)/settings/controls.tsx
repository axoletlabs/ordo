/** Preferences for shortcuts, gestures, and where websites open. */
import React from "react";
import {
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import {
  SettingsSelect,
  type SettingsSelectOption,
} from "../../../src/components/settings/SettingsSelect";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { APP_NAME } from "@ordo/shared";
import {
  useSettingsStore,
  type CreateButtonAction,
  type WebsiteBrowser,
} from "../../../src/store/settings";

const tapOptions: readonly SettingsSelectOption<CreateButtonAction>[] = [
  { value: "menu", label: "Show create menu", shortLabel: "Show menu", icon: "apps-outline" },
  { value: "bookmark", label: "Save bookmark", shortLabel: "Bookmark", icon: "bookmark-outline" },
  { value: "folder", label: "New folder", icon: "folder-outline" },
];

const websiteBrowserOptions: readonly SettingsSelectOption<WebsiteBrowser>[] = [
  { value: "ordo", label: APP_NAME, icon: "phone-portrait-outline" },
  { value: "inApp", label: "In-app browser", shortLabel: "In-app", icon: "browsers-outline" },
  { value: "external", label: "External browser", shortLabel: "External", icon: "open-outline" },
];

export default function ControlsScreen() {
  const tapAction = useSettingsStore((s) => s.createButtonTapAction);
  const websiteBrowser = useSettingsStore((s) => s.websiteBrowser);
  const setTapAction = useSettingsStore((s) => s.setCreateButtonTapAction);
  const setWebsiteBrowser = useSettingsStore((s) => s.setWebsiteBrowser);

  return (
    <SettingsPage title="Controls">
      <SettingsScrollView>
        <SettingsGroup
          label="Create button"
          compact
          footer="On the Bookmarks screen. Press and hold the create button to select items."
        >
          <SettingRow
            icon="hand-left-outline"
            label="Tap"
            right={
              <SettingsSelect
                title="Tap action"
                options={tapOptions}
                value={tapAction}
                onChange={setTapAction}
              />
            }
            divider={false}
          />
        </SettingsGroup>
        <SettingsGroup
          label="Browser"
          footer={`${APP_NAME} stays in this app with a separate login. In-app uses Safari or Chrome as a sheet. External leaves ${APP_NAME}.`}
        >
          <SettingRow
            icon="globe-outline"
            label="Open websites in"
            right={
              <SettingsSelect
                title="Open websites in"
                options={websiteBrowserOptions}
                value={websiteBrowser}
                onChange={setWebsiteBrowser}
              />
            }
            divider={false}
          />
        </SettingsGroup>
      </SettingsScrollView>
    </SettingsPage>
  );
}
