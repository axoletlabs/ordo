/** Preferences for shortcuts, gestures, the share sheet, and the in-app website browser. */
import React from "react";
import { Platform } from "react-native";
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
import { Toggle } from "../../../src/components/ui/Toggle";
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
  const forceWebsiteDark = useSettingsStore((s) => s.forceWebsiteDark);
  const shareQuickBookmark = useSettingsStore((s) => s.shareQuickBookmark);
  const shareShowQuickAction = useSettingsStore((s) => s.shareShowQuickAction);
  const setTapAction = useSettingsStore((s) => s.setCreateButtonTapAction);
  const setHoldAction = useSettingsStore((s) => s.setCreateButtonHoldAction);
  const setWebsiteBrowser = useSettingsStore((s) => s.setWebsiteBrowser);
  const setForceWebsiteDark = useSettingsStore((s) => s.setForceWebsiteDark);
  const setShareQuickBookmark = useSettingsStore((s) => s.setShareQuickBookmark);
  const setShareShowQuickAction = useSettingsStore((s) => s.setShareShowQuickAction);

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
        {Platform.OS === "android" ? (
          <SettingsGroup
            label="Share sheet"
            footer={
              shareShowQuickAction
                ? "The share sheet lists Quick Bookmark next to ordo. Quick Bookmark saves as unfiled and returns you to the other app."
                : shareQuickBookmark
                  ? "Sharing to ordo saves the link as unfiled and returns you to the other app."
                  : "Off by default. Quick Bookmark saves a shared link as unfiled without the save form."
            }
          >
            <SettingRow
              icon="flash-outline"
              label="Quick Bookmark"
              description="Save shared links as unfiled and return to the other app."
              right={
                <Toggle value={shareQuickBookmark} onValueChange={setShareQuickBookmark} />
              }
              rightFit="content"
              divider={shareQuickBookmark}
            />
            {shareQuickBookmark ? (
              <SettingRow
                icon="share-outline"
                label="Show alongside Save"
                description="Keep the normal Save action and add Quick Bookmark as a second share target."
                right={
                  <Toggle value={shareShowQuickAction} onValueChange={setShareShowQuickAction} />
                }
                rightFit="content"
                divider={false}
              />
            ) : null}
          </SettingsGroup>
        ) : null}
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
          />
          <SettingRow
            icon="moon-outline"
            label="Force dark mode"
            right={
              <Toggle value={forceWebsiteDark} onValueChange={setForceWebsiteDark} />
            }
            rightFit="content"
            divider={false}
          />
        </SettingsGroup>
      </SettingsScrollView>
    </SettingsPage>
  );
}
