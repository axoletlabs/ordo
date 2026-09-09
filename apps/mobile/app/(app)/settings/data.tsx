/** Data: export the library to a file, import from Ordo/HTML/CSV exports. */
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { ExportFormat, FolderDto } from "@ordo/shared";
import { TOKEN_TTL } from "@ordo/shared";
import { SettingsPage, SettingsScrollView, SettingsGroup } from "../../../src/components/settings/SettingsPage";
import { ImportFlow } from "../../../src/components/settings/ImportFlow";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Segmented } from "../../../src/components/ui/Segmented";
import { Button } from "../../../src/components/ui/Button";
import { LockPrompt } from "../../../src/components/bookmarks/LockPrompt";
import { toast } from "../../../src/components/ui/toast-store";
import { useFolders } from "../../../src/hooks/use-folders";
import { useFolderTokenStore } from "../../../src/store/folder-tokens";
import { importExportApi } from "../../../src/lib/api/import-export";
import {
  downloadExportFile,
  filenameFromDisposition,
  isExportSaveCanceled,
  mimeForExportFormat,
} from "../../../src/lib/import-export-file";
import { errorMessage } from "../../../src/lib/error-message";
import { haptics } from "../../../src/lib/haptics";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { spacing } from "../../../src/theme/tokens";

const FORMAT_OPTIONS: ReadonlyArray<{ value: ExportFormat; label: string }> = [
  { value: "json", label: "JSON" },
  { value: "html", label: "HTML" },
  { value: "csv", label: "CSV" },
];

export default function DataScreen() {
  const { palette } = useTheme();
  const { data: folders = [] } = useFolders();

  const accessRevision = useFolderTokenStore((s) => s.accessRevision);
  const tokenFor = (id: string) => {
    void accessRevision;
    return useFolderTokenStore.getState().get(id);
  };

  const [format, setFormat] = useState<ExportFormat>("json");
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<{ folder: FolderDto; source: "export" | "import" } | null>(
    null,
  );

  const isLibrary = selectedFolderIds.length === 0;
  const protectedFolders = useMemo(() => folders.filter((f) => f.protected), [folders]);

  const tokensFor = (ids: string[]): string[] =>
    ids.map((id) => tokenFor(id)).filter((t): t is string => Boolean(t));

  const radio = (selected: boolean) => (
    <Ionicons
      name={selected ? "checkmark-circle" : "ellipse-outline"}
      size={22}
      color={selected ? palette.accent : palette.textFaint}
    />
  );

  const check = (selected: boolean) => (
    <Ionicons
      name={selected ? "checkbox" : "square-outline"}
      size={22}
      color={selected ? palette.accent : palette.textFaint}
    />
  );

  const toggleFolder = (id: string) => {
    setSelectedFolderIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const exportLabel = (() => {
    const fmt = format.toUpperCase();
    if (isLibrary) return more ? `Export as ${fmt}` : "Export library";
    if (selectedFolderIds.length === 1) {
      const name =
        folders.find((f) => f.id === selectedFolderIds[0])?.name.split(" / ").pop() ?? "folder";
      return more ? `Export ${name} as ${fmt}` : `Export ${name}`;
    }
    return more
      ? `Export ${selectedFolderIds.length} as ${fmt}`
      : `Export ${selectedFolderIds.length} folders`;
  })();

  const exportMutation = useMutation({
    mutationFn: async () => {
      const tokens = tokensFor(isLibrary ? protectedFolders.map((f) => f.id) : selectedFolderIds);
      const res = await importExportApi.requestExport(format, selectedFolderIds, tokens);
      const filename = filenameFromDisposition(
        res.headers.get("content-disposition"),
        format === "json" ? "json" : format,
      );
      await downloadExportFile(await res.text(), filename, mimeForExportFormat(format));
    },
    onSuccess: () => {
      haptics.success();
      toast.success("Export saved");
    },
    onError: (err) => {
      if (isExportSaveCanceled(err)) return;
      toast.error(errorMessage(err, "The export failed."));
    },
  });

  return (
    <SettingsPage title="Data">
      <SettingsScrollView>
        <SettingsGroup label="Export" compact>
          <View style={styles.pad}>
            <Button
              label={exportLabel}
              block
              size="lg"
              loading={exportMutation.isPending}
              onPress={() => exportMutation.mutate()}
            />
          </View>
          <SettingRow
            icon="ellipsis-horizontal"
            label="More options"
            onPress={() => setMore((open) => !open)}
            value={more ? "Hide" : "Show"}
            divider={more}
          />
          {more ? (
            <>
              <SettingRow
                icon="library-outline"
                label="Entire library"
                right={radio(isLibrary)}
                rightFit="content"
                onPress={() => setSelectedFolderIds([])}
              />
              {folders.map((folder, index) => {
                const unlocked = !folder.protected || Boolean(tokenFor(folder.id));
                const last = index === folders.length - 1;
                if (!unlocked) {
                  return (
                    <SettingRow
                      key={folder.id}
                      icon="lock-closed-outline"
                      label={folder.name}
                      value="Unlock"
                      onPress={() => setUnlockTarget({ folder, source: "export" })}
                      divider={!last}
                    />
                  );
                }
                return (
                  <SettingRow
                    key={folder.id}
                    icon={folder.protected ? "lock-open-outline" : "folder-outline"}
                    label={folder.name}
                    description={`${folder.bookmarkCount} ${folder.bookmarkCount === 1 ? "bookmark" : "bookmarks"}`}
                    right={check(selectedFolderIds.includes(folder.id))}
                    rightFit="content"
                    onPress={() => toggleFolder(folder.id)}
                    divider={!last}
                  />
                );
              })}
              <View style={styles.pad}>
                <Segmented options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
              </View>
            </>
          ) : null}
        </SettingsGroup>

        <ImportFlow
          folders={folders}
          tokenFor={tokenFor}
          onUnlock={(folder) => setUnlockTarget({ folder, source: "import" })}
        />
      </SettingsScrollView>

      <LockPrompt
        visible={unlockTarget !== null}
        folderId={unlockTarget?.folder.id ?? ""}
        folderName={unlockTarget?.folder.name}
        lockType={unlockTarget?.folder.lockType ?? "password"}
        pinLength={unlockTarget?.folder.pinLength}
        onDismiss={() => setUnlockTarget(null)}
        onUnlocked={() => {
          const target = unlockTarget;
          setUnlockTarget(null);
          if (target?.source === "export") {
            setSelectedFolderIds((current) =>
              current.includes(target.folder.id) ? current : [...current, target.folder.id],
            );
          }
          toast.success(`Folder unlocked for ${Math.round(TOKEN_TTL.FOLDER_MS / 60_000)} minutes`);
        }}
      />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing[16] },
});
