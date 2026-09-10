/**
 * Stepped import overlay: pick a file → preview → confirm → done.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DuplicatePolicy, FolderDto, ImportJobDto, ImportPreviewDto } from "@ordo/shared";
import { IMPORT_EXPORT, normalizeImportPreview } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { PanelHeader } from "../ui/PanelHeader";
import { SettingRow } from "../ui/SettingRow";
import { SettingsGroup } from "./SettingsPage";
import { Segmented } from "../ui/Segmented";
import { Toggle } from "../ui/Toggle";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { PanelActions } from "../ui/SheetActionRow";
import { toast } from "../ui/toast-store";
import { importExportApi } from "../../lib/api/import-export";
import { qk } from "../../lib/api/query-keys";
import { prefsDelete, prefsGet, prefsSet, StorageKeys } from "../../lib/storage";
import { errorMessage } from "../../lib/error-message";
import { importedToast } from "../../lib/copy";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";

const POLICY_OPTIONS: ReadonlyArray<{ value: DuplicatePolicy; label: string }> = [
  { value: "skip", label: "Skip" },
  { value: "update", label: "Update" },
  { value: "copy", label: "Add copies" },
];

type Phase = "idle" | "uploading" | "active";

function plannedCount(preview: ImportPreviewDto, policy: DuplicatePolicy): number {
  const uniqueNew = preview.uniqueNew ?? Math.max(0, preview.validRows - (preview.uniqueDuplicates ?? preview.duplicates));
  const uniqueDuplicates = preview.uniqueDuplicates ?? preview.duplicates;
  if (policy === "copy") return preview.validRows;
  if (policy === "update") return uniqueNew + uniqueDuplicates;
  return uniqueNew;
}

export function ImportFlow({
  folders,
  tokenFor,
  onUnlock,
}: {
  folders: FolderDto[];
  tokenFor: (id: string) => string | null | undefined;
  onUnlock: (folder: FolderDto) => void;
}) {
  const qc = useQueryClient();
  const toasted = useRef<string | null>(null);
  const prevStatus = useRef<string | undefined>(undefined);

  const [phase, setPhase] = useState<Phase>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<DuplicatePolicy>("skip");
  const [atomic, setAtomic] = useState(true);
  const [advanced, setAdvanced] = useState(false);

  const persistJob = (id: string | null) => {
    setJobId(id);
    if (id) void prefsSet(StorageKeys.IMPORT_JOB, id);
    else void prefsDelete(StorageKeys.IMPORT_JOB);
  };

  useEffect(() => {
    void prefsGet<string>(StorageKeys.IMPORT_JOB).then((id) => {
      if (id) {
        setJobId(id);
        setPhase("active");
      }
    });
  }, []);

  const jobQuery = useQuery({
    queryKey: qk.importJob(jobId ?? "none"),
    queryFn: () => importExportApi.getImport(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data?.status === "parsing" || query.state.data?.status === "committing" ? 600 : false,
    retry: false,
  });

  const job: ImportJobDto | undefined = jobQuery.data;
  const preview = job?.status === "ready" ? normalizeImportPreview(job.preview) : null;

  const lockedMatches = useMemo(() => {
    if (!preview) return [] as FolderDto[];
    const names = new Set(preview.lockedFolderMatches.map((n) => n.trim().toLowerCase()));
    return folders.filter((f) => names.has(f.name.trim().toLowerCase()));
  }, [preview, folders]);

  const reset = (cancel = true) => {
    if (cancel && jobId) void importExportApi.cancelImport(jobId).catch(() => undefined);
    persistJob(null);
    setPhase("idle");
    setPolicy("skip");
    setAtomic(true);
    setAdvanced(false);
    toasted.current = null;
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
      type: [
        "text/*",
        "text/html",
        "text/csv",
        "application/json",
        "application/xhtml+xml",
        "application/octet-stream",
        "*/*",
      ],
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    if ((asset.size ?? 0) > IMPORT_EXPORT.MAX_FILE_BYTES) {
      toast.error("That file is larger than 50 MB.");
      return;
    }
    setPhase("uploading");
    try {
      const { jobId: id } = await importExportApi.uploadImport({
        uri: asset.uri,
        file: asset.file,
        name: asset.name || "import",
        size: asset.size,
      });
      persistJob(id);
      setPhase("active");
    } catch (err) {
      toast.error(errorMessage(err, "The upload failed."));
      setPhase("idle");
    }
  };

  const commitMutation = useMutation({
    mutationFn: () =>
      importExportApi.commitImport(
        jobId as string,
        { duplicatePolicy: policy, atomic },
        lockedMatches.map((f) => tokenFor(f.id)).filter((t): t is string => Boolean(t)),
      ),
    onSuccess: (updated) => {
      qc.setQueryData(qk.importJob(jobId as string), updated);
    },
    onError: (err) => toast.error(errorMessage(err, "The import could not be confirmed.")),
  });

  useEffect(() => {
    const status = job?.status;
    if (status === "completed" && job?.result) {
      void qc.invalidateQueries({ queryKey: ["bookmarks"] });
      void qc.invalidateQueries({ queryKey: qk.folders });
      void qc.invalidateQueries({ queryKey: ["tags"] });
      void qc.invalidateQueries({ queryKey: qk.extractionProgress });
    }
    const becameCompleted =
      Boolean(prevStatus.current) && prevStatus.current !== "completed" && status === "completed";
    prevStatus.current = status;
    if (!job || !becameCompleted || !job.result) return;
    if (toasted.current === job.id) return;
    toasted.current = job.id;
    haptics.success();
    toast.success(importedToast(job.result));
  }, [job, qc]);

  const overlayOpen = phase === "uploading" || phase === "active";
  const busy = job?.status === "committing" || commitMutation.isPending;
  const canScrimDismiss =
    job?.status === "completed" || job?.status === "failed" || jobQuery.isError;

  return (
    <>
      <SettingsGroup label="Import">
        <SettingRow
          icon="download-outline"
          label="Import from file"
          onPress={pickFile}
          showChevron
          divider={false}
        />
      </SettingsGroup>

      <FloatingPanel
        visible={overlayOpen}
        onDismiss={() => {
          if (canScrimDismiss) reset(true);
        }}
        dismissible={canScrimDismiss}
        maxWidth={440}
      >
        <ThemedScrollView
          bounces={false}
          keyboardShouldPersistTaps="handled"
        >
          {phase === "uploading" || (phase === "active" && !job && !jobQuery.isError) ? (
            <BusyState title="Reading file" />
          ) : jobQuery.isError ? (
            <ErrorState
              message={errorMessage(jobQuery.error, "This import no longer exists.")}
              onRetry={() => reset(false)}
            />
          ) : job?.status === "parsing" ? (
            <BusyState title="Reading file" subtitle={job.fileName || undefined} />
          ) : job?.status === "failed" ? (
            <ErrorState
              message={job.failure ?? "The file could not be read."}
              onRetry={() => reset(true)}
            />
          ) : job?.status === "committing" ? (
            <BusyState title="Saving bookmarks" />
          ) : job?.status === "completed" && job.result ? (
            <SuccessState result={job.result} onDone={() => reset(true)} />
          ) : preview ? (
            <PreviewState
              preview={preview}
              fileName={job?.fileName}
              policy={policy}
              atomic={atomic}
              advanced={advanced}
              lockedMatches={lockedMatches}
              tokenFor={tokenFor}
              onUnlock={onUnlock}
              onPolicy={setPolicy}
              onAtomic={setAtomic}
              onAdvanced={() => setAdvanced((v) => !v)}
              onConfirm={() => commitMutation.mutate()}
              onDiscard={() => reset(true)}
              confirming={busy}
            />
          ) : (
            <BusyState title="Reading file" />
          )}
        </ThemedScrollView>
      </FloatingPanel>
    </>
  );
}

function BusyState({ title, subtitle }: { title: string; subtitle?: string }) {
  const { palette } = useTheme();
  return (
    <View>
      <PanelHeader title={title} subtitle={subtitle} />
      <View style={styles.busy}>
        <ActivityIndicator color={palette.accent} />
      </View>
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { palette } = useTheme();
  return (
    <View>
      <PanelHeader
        icon="alert-circle-outline"
        iconColor={palette.danger}
        iconBackground={palette.dangerSoft}
        title="Couldn't import"
        subtitle={message}
      />
      <Button label="Try again" variant="secondary" block onPress={onRetry} />
    </View>
  );
}

function SuccessState({
  result,
  onDone,
}: {
  result: NonNullable<ImportJobDto["result"]>;
  onDone: () => void;
}) {
  const { palette } = useTheme();
  const failures = result.failures ?? [];
  const lines: string[] = [];
  if (result.imported > 0) {
    lines.push(result.imported === 1 ? "1 added" : `${result.imported} added`);
  }
  if (result.updated > 0) {
    lines.push(result.updated === 1 ? "1 updated" : `${result.updated} updated`);
  }
  if (result.skipped > 0) {
    lines.push(result.skipped === 1 ? "1 already saved" : `${result.skipped} already saved`);
  }
  if (result.foldersCreated > 0) {
    lines.push(result.foldersCreated === 1 ? "1 folder created" : `${result.foldersCreated} folders created`);
  }
  if (result.failed > 0) {
    lines.push(result.failed === 1 ? "1 couldn't be saved" : `${result.failed} couldn't be saved`);
  }

  return (
    <View>
      <PanelHeader
        icon="checkmark-circle-outline"
        iconColor={palette.success}
        iconBackground={palette.accentSoft}
        title="Import complete"
        subtitle={lines.length > 0 ? lines.join(" · ") : "Nothing new to add."}
      />
      {failures.length > 0 ? (
        <View style={styles.samples}>
          {failures.slice(0, 4).map((failure, i) => (
            <Text key={i} variant="caption" color="tertiary" numberOfLines={2}>
              {failure.url ? `${failure.url} — ` : ""}
              {failure.reason}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button label="Done" block onPress={onDone} />
      </View>
    </View>
  );
}

function PreviewState({
  preview,
  fileName,
  policy,
  atomic,
  advanced,
  lockedMatches,
  tokenFor,
  onUnlock,
  onPolicy,
  onAtomic,
  onAdvanced,
  onConfirm,
  onDiscard,
  confirming,
}: {
  preview: ImportPreviewDto;
  fileName: string | null | undefined;
  policy: DuplicatePolicy;
  atomic: boolean;
  advanced: boolean;
  lockedMatches: FolderDto[];
  tokenFor: (id: string) => string | null | undefined;
  onUnlock: (folder: FolderDto) => void;
  onPolicy: (value: DuplicatePolicy) => void;
  onAtomic: (value: boolean) => void;
  onAdvanced: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  confirming: boolean;
}) {
  const { palette } = useTheme();
  const count = plannedCount(preview, policy);
  const empty = preview.validRows === 0;
  const alreadyAll = !empty && count === 0 && policy === "skip";

  return (
    <View>
      <PanelHeader
        icon="download-outline"
        iconColor={palette.accent}
        iconBackground={palette.accentSoft}
        title={empty ? "No bookmarks in this file" : alreadyAll ? "Already in your library" : `${count} new bookmark${count === 1 ? "" : "s"}`}
        subtitle={
          empty
            ? "No http(s) links in this file."
            : alreadyAll
              ? "Everything here is already saved."
              : fileName ?? undefined
        }
      />

      <View style={styles.metrics}>
        <Metric label="New" value={preview.uniqueNew} />
        <Metric label="Already saved" value={preview.uniqueDuplicates} />
        {preview.invalidRows > 0 ? <Metric label="Skipped" value={preview.invalidRows} /> : null}
      </View>

      {preview.newFolders.length > 0 ? (
        <Text variant="footnote" color="tertiary" style={styles.note} numberOfLines={3}>
          New folders: {preview.newFolders.join(", ")}
        </Text>
      ) : null}

      {preview.withinFileDuplicates > 0 ? (
        <Text variant="footnote" color="tertiary" style={styles.note}>
          {preview.withinFileDuplicates === 1
            ? "1 repeat in the file will be imported once."
            : `${preview.withinFileDuplicates} repeats in the file will be imported once.`}
        </Text>
      ) : null}

      {preview.invalidSamples.length > 0 ? (
        <View style={styles.samples}>
          {preview.invalidSamples.slice(0, 3).map((sample, i) => (
            <Text key={i} variant="caption" color="tertiary" numberOfLines={2}>
              {sample.url ? `${sample.url} — ` : ""}
              {sample.reason}
            </Text>
          ))}
        </View>
      ) : null}

      {lockedMatches.length > 0 ? (
        <View style={styles.lockBox}>
          <Text variant="footnote" color="secondary">
            Unlock to import into these folders.
          </Text>
          {lockedMatches.map((folder) => {
            const unlocked = Boolean(tokenFor(folder.id));
            return (
              <SettingRow
                key={folder.id}
                icon={unlocked ? "lock-open-outline" : "lock-closed-outline"}
                iconColor={unlocked ? palette.success : undefined}
                label={folder.name}
                onPress={() => onUnlock(folder)}
                value={unlocked ? "Unlocked" : "Unlock"}
                divider={false}
              />
            );
          })}
        </View>
      ) : null}

      <View style={styles.actions}>
        {empty || count === 0 ? (
          <Button label="Done" block onPress={onDiscard} disabled={confirming} />
        ) : (
          <PanelActions
            confirmLabel={count === 1 ? "Import 1 bookmark" : `Import ${count} bookmarks`}
            cancelLabel="Discard"
            onConfirm={onConfirm}
            onCancel={onDiscard}
            loading={confirming}
          />
        )}
      </View>

      {!empty ? (
        <View style={styles.advancedWrap}>
          <SettingRow
            icon="options-outline"
            label="Advanced"
            onPress={onAdvanced}
            value={advanced ? "Hide" : "Show"}
            divider={false}
          />
          {advanced ? (
            <View style={styles.advancedBody}>
              <Text variant="label" color="secondary">
                Duplicates
              </Text>
              <Segmented options={POLICY_OPTIONS} value={policy} onChange={onPolicy} />
              <SettingRow
                icon="shield-checkmark-outline"
                label="All at once"
                description={atomic ? "Everything or nothing" : "Keep rows that succeed"}
                right={<Toggle value={atomic} onValueChange={onAtomic} />}
                rightFit="content"
                divider={false}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: palette.surfaceSecondary }]}>
      <Text variant="title2">{value}</Text>
      <Text variant="caption" color="tertiary">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  busy: { alignItems: "center", paddingVertical: spacing[8] },
  metrics: {
    flexDirection: "row",
    gap: spacing[8],
    marginBottom: spacing[8],
  },
  metric: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing[8],
    alignItems: "center",
    gap: spacing[2],
  },
  note: { marginTop: spacing[4] },
  samples: { marginTop: spacing[8], gap: spacing[4] },
  lockBox: { marginTop: spacing[10] },
  actions: { gap: spacing[4], marginTop: spacing[12] },
  advancedWrap: { marginTop: spacing[8] },
  advancedBody: { gap: spacing[10], paddingBottom: spacing[4] },
});
