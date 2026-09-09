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
  type CreateButtonHoldAction,
  type WebsiteBrowser,
} from "../../../src/store/settings";

const tapOptions: readonly SettingsSelectOption<CreateButtonAction>[] = [
  { value: "menu", label: "Show create menu", shortLabel: "Show menu", icon: "apps-outline" },
  { value: "bookmark", label: "Save bookmark", shortLabel: "Bookmark", icon: "bookmark-outline" },
  { value: "folder", label: "New folder", icon: "folder-outline" },
];

const holdOptions: readonly SettingsSelectOption<CreateButtonHoldAction>[] = [
  ...tapOptions,
  { value: "none", label: "No action", icon: "remove-circle-outline" },
];

const websiteBrowserOptions: readonly SettingsSelectOption<WebsiteBrowser>[] = [
  { value: "ordo", label: APP_NAME, icon: "phone-portrait-outline" },
  { value: "inApp", label: "In-app browser", shortLabel: "In-app", icon: "browsers-outline" },
  { value: "external", label: "External browser", shortLabel: "External", icon: "open-outline" },
];

export default function ControlsScreen() {
  const tapAction = useSettingsStore((s) => s.createButtonTapAction);
  const holdAction = useSettingsStore((s) => s.createButtonHoldAction);
  const websiteBrowser = useSettingsStore((s) => s.websiteBrowser);
  const setTapAction = useSettingsStore((s) => s.setCreateButtonTapAction);
  const setHoldAction = useSettingsStore((s) => s.setCreateButtonHoldAction);
  const setWebsiteBrowser = useSettingsStore((s) => s.setWebsiteBrowser);

  return (
    <SettingsPage title="Controls">
      <SettingsScrollView>
        <SettingsGroup label="Create button" compact>
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
          />
          <SettingRow
            icon="finger-print-outline"
            label="Press and hold"
            right={
              <SettingsSelect
                title="Press and hold action"
                options={holdOptions}
                value={holdAction}
                onChange={setHoldAction}
              />
            }
            divider={false}
          />
        </SettingsGroup>
        <SettingsGroup label="Browser">
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
