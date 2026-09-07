/**
 * Edit a bookmark's tags: toggle assignments from the catalogue, accept or
 * dismiss pending suggestions, and create tags inline. Saving applies the
 * full assignment (plus dismissals) atomically.
 */
import React, { useEffect, useMemo, useState, type ComponentProps } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type BookmarkDto, type TagSummaryDto } from "@ordo/shared";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { TagChip } from "./TagChip";
import { TagSelectList } from "./TagSelectList";
import { CreateTagPanel } from "./CreateTagPanel";
import { useUpdateBookmarkTags } from "../../hooks/use-tags";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";

export interface EditTagsSheetProps {
  visible: boolean;
  onDismiss: () => void;
  bookmark: BookmarkDto | null;
}

export function EditTagsSheet({ visible, onDismiss, bookmark }: EditTagsSheetProps) {
  const { palette } = useTheme();
  const updateTags = useUpdateBookmarkTags();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (visible && bookmark) {
      setSelectedIds(bookmark.tags.map((t) => t.id));
      setDismissed([]);
      setCreateTagOpen(false);
      setError("");
    }
  }, [visible, bookmark]);

  const toggle = (tagId: string) => {
    haptics.selection();
    setSelectedIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  const suggestions = useMemo(
    () =>
      (bookmark?.suggestedTags ?? []).filter(
        (t) => !dismissed.includes(t.id) && !selectedIds.includes(t.id),
      ),
    [bookmark?.suggestedTags, dismissed, selectedIds],
  );

  const accept = (tagId: string) => {
    haptics.light();
    setSelectedIds((prev) => [...prev, tagId]);
  };

  const dismiss = (tagId: string) => {
    haptics.light();
    setDismissed((prev) => [...prev, tagId]);
  };

  const save = async () => {
    if (!bookmark) return;
    try {
      await updateTags.mutateAsync({
        id: bookmark.id,
        tagIds: selectedIds,
        dismissedSuggestionIds: dismissed,
        folderId: bookmark.folderId,
      });
      haptics.success();
      onDismiss();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
    }
  };

  if (!bookmark) return null;

  const assigned = selectedIds
    .map((id) => {
      const known = [...bookmark.tags, ...bookmark.suggestedTags].find((t) => t.id === id);
      return known ? { id, name: known.name, color: known.color } : null;
    })
    .filter((t): t is { id: string; name: string; color: TagSummaryDto["color"] } => t !== null);

  return (
    <>
      <FloatingPanel visible={visible} onDismiss={onDismiss}>
        <PanelHeader title="Edit tags" />

      {assigned.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {assigned.map((tag) => (
            <TagChip
              key={tag.id}
              name={tag.name}
              color={tag.color}
              selected
              onPress={() => toggle(tag.id)}
              accessibilityLabel={`Remove tag ${tag.name}`}
            />
          ))}
        </ScrollView>
      ) : (
        <Text variant="footnote" color="secondary" style={styles.hint}>
          Pick tags below.
        </Text>
      )}

      {suggestions.length > 0 ? (
        <View style={styles.section}>
          <Text variant="label" color="tertiary">Suggested</Text>
          <View style={styles.chipWrap}>
            {suggestions.map((tag) => (
              <View key={tag.id} style={styles.suggestionChip}>
                <TagChip name={tag.name} color={tag.color} onPress={() => accept(tag.id)} accessibilityLabel={`Add suggested tag ${tag.name}`} />
                <View style={styles.suggestionActions}>
                  <PressableIconButton
                    icon="add"
                    label={`Accept suggested tag ${tag.name}`}
                    color={palette.accent}
                    onPress={() => accept(tag.id)}
                  />
                  <PressableIconButton
                    icon="close"
                    label={`Dismiss suggested tag ${tag.name}`}
                    color={palette.textTertiary}
                    onPress={() => dismiss(tag.id)}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="label" color="tertiary">Tags</Text>
        <TagSelectList
          selectedIds={selectedIds}
          onToggle={toggle}
          extraTags={bookmark.tags}
          onRequestCreateTag={() => setCreateTagOpen(true)}
        />
      </View>

      {error ? (
        <Text variant="footnote" color="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button label="Cancel" variant="secondary" onPress={onDismiss} style={{ flex: 1 }} />
        <Button
          label="Save"
          onPress={save}
          loading={updateTags.isPending}
          style={{ flex: 1.4 }}
        />
      </View>
      </FloatingPanel>
      {/* Sibling of the edit sheet: nested modals are not supported on Android. */}
      <CreateTagPanel
        visible={visible && createTagOpen}
        onDismiss={() => setCreateTagOpen(false)}
        onCreated={(tag) => toggle(tag.id)}
      />
    </>
  );
}

function PressableIconButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      scaleTo={0.85}
    >
      <Ionicons name={icon} size={16} color={color} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: spacing[6] },
  chipRow: { flexDirection: "row", gap: spacing[8], paddingVertical: spacing[6], flexWrap: "wrap" },
  chipWrap: { flexDirection: "row", gap: spacing[8], flexWrap: "wrap", marginTop: spacing[6] },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
  },
  suggestionActions: { flexDirection: "row", gap: spacing[2] },
  section: { marginTop: spacing[10] },
  error: { marginTop: spacing[8] },
  actions: { flexDirection: "row", gap: spacing[8], marginTop: spacing[12] },
});
