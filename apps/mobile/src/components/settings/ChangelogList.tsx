/**
 * One release at a time, in a panel. Version chips along the bottom swap
 * the notes. The opening paragraph leads; commands sit in a recessed line.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Linking, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Text, type TextColor } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { Button } from "../ui/Button";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Spinner } from "../ui/Spinner";
import { toast } from "../ui/toast-store";
import {
  changelogMark,
  parseChangelogBody,
  type ChangelogAlign,
  type ChangelogBlock,
  type ChangelogInline,
  type ChangelogListItem,
  type ChangelogMark,
  type ChangelogRelease,
} from "../../lib/changelog";
import { formatDate } from "../../lib/format";
import { haptics } from "../../lib/haptics";
import { useChangelog } from "../../hooks/use-changelog";
import { useBuildInfo } from "../../hooks/use-build-info";
import { useNativeUpdateStore } from "../../store/native-update";
import { useTheme } from "../../theme/ThemeProvider";
import { AppIcon } from "../ui/PinIcon";
import { layout, radius, resolveFont, spacing } from "../../theme/tokens";

const MARK_LABEL: Record<ChangelogMark, string> = {
  installed: "Installed",
  available: "Available",
  early: "Early access",
};

type Piece =
  | { kind: "run"; inlines: ChangelogInline[] }
  | { kind: "command"; text: string }
  | { kind: "image"; alt: string; href: string };

function releaseDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatDate(iso);
}

function isCommand(text: string): boolean {
  return text.includes(" ") || text.length > 42;
}

function splitProse(inlines: ChangelogInline[]): Piece[] {
  const pieces: Piece[] = [];
  let run: ChangelogInline[] = [];
  const flush = () => {
    if (run.length === 0) return;
    pieces.push({ kind: "run", inlines: run });
    run = [];
  };

  for (const part of inlines) {
    if (part.type === "image") {
      flush();
      pieces.push({ kind: "image", alt: part.alt, href: part.href });
      continue;
    }
    if (part.type === "code" && isCommand(part.text)) {
      const last = run[run.length - 1];
      if (last?.type === "text") {
        const trimmed = last.text.replace(/[ \t]+$/, "");
        if (trimmed) run[run.length - 1] = { type: "text", text: trimmed };
        else run.pop();
      }
      flush();
      pieces.push({ kind: "command", text: part.text });
      continue;
    }
    const previous = pieces[pieces.length - 1];
    if (part.type === "text" && run.length === 0 && previous?.kind === "command") {
      const stripped = part.text.replace(/^[.,;:]\s*/, "");
      if (stripped) run.push({ type: "text", text: stripped });
      continue;
    }
    run.push(part);
  }
  flush();
  return pieces;
}

function failureMessage(status: number | null): string {
  if (status === 403 || status === 429) {
    return "GitHub is limiting requests. Try again in a few minutes.";
  }
  return "Check your connection and try again.";
}

function MarkChip({ mark }: { mark: ChangelogMark }) {
  const { palette } = useTheme();
  const tone =
    mark === "installed"
      ? { bg: palette.primaryContainer, fg: palette.onPrimaryContainer }
      : mark === "available"
        ? { bg: palette.secondaryContainer, fg: palette.onSecondaryContainer }
        : { bg: palette.surfaceSecondary, fg: palette.textSecondary };

  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: tone.bg, borderColor: palette.border },
      ]}
    >
      <Text variant="label" style={{ color: tone.fg }}>
        {MARK_LABEL[mark]}
      </Text>
    </View>
  );
}

function CommandLine({ text }: { text: string }) {
  const { palette } = useTheme();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  return (
    <View style={[styles.command, { backgroundColor: palette.background, borderColor: palette.border }]}>
      <Text variant="mono" color="primary" selectable style={styles.commandText}>
        {text}
      </Text>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={copied ? "Copied" : "Copy command"}
        scaleTo={0.92}
        hitSlop={6}
        onPress={() => {
          haptics.light();
          void Clipboard.setStringAsync(text).then(() => {
            setCopied(true);
            toast.success("Copied");
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(false), 1600);
          });
        }}
        style={styles.copy}
      >
        <AppIcon
          name={copied ? "checkmark" : "copy-outline"}
          size={18}
          color={copied ? palette.accent : palette.textTertiary}
        />
      </PressableScale>
    </View>
  );
}

type InlineVariant = "callout" | "body" | "title3" | "headline";

const STRONG_FACE = {
  fontFamily: resolveFont("sans", "700"),
  fontWeight: "700" as const,
};

function openLink(href: string) {
  haptics.light();
  void Linking.openURL(href).catch(() => {});
}

function InlinePiece({
  part,
  variant,
  tone,
  index,
}: {
  part: ChangelogInline;
  variant: InlineVariant;
  tone: TextColor;
  index: number;
}) {
  if (part.type === "text") return part.text;
  if (part.type === "break") return "\n";
  if (part.type === "code") {
    return (
      <Text key={index} variant="mono" color="primary">
        {part.text}
      </Text>
    );
  }
  if (part.type === "image") return part.alt || part.href;
  const children = (
    <InlineChildren inlines={"inlines" in part ? part.inlines : []} variant={variant} tone={tone} />
  );
  if (part.type === "strong") {
    return (
      <Text key={index} variant={variant} color={tone} style={STRONG_FACE}>
        {children}
      </Text>
    );
  }
  if (part.type === "em") {
    return (
      <Text key={index} variant={variant} color={tone} style={{ fontStyle: "italic" }}>
        {children}
      </Text>
    );
  }
  if (part.type === "del") {
    return (
      <Text key={index} variant={variant} color={tone} style={{ textDecorationLine: "line-through" }}>
        {children}
      </Text>
    );
  }
  if (part.type === "link") {
    return (
      <Text
        key={index}
        variant={variant}
        color="accent"
        suppressHighlighting
        accessibilityRole="link"
        onPress={() => openLink(part.href)}
      >
        {children}
      </Text>
    );
  }
  return null;
}

function InlineChildren({
  inlines,
  variant,
  tone,
}: {
  inlines: ChangelogInline[];
  variant: InlineVariant;
  tone: TextColor;
}) {
  return inlines.map((part, index) => (
    <InlinePiece key={index} part={part} variant={variant} tone={tone} index={index} />
  ));
}

function InlineRun({ inlines, variant }: { inlines: ChangelogInline[]; variant: InlineVariant }) {
  const tone: TextColor = variant === "body" ? "secondary" : "primary";
  return (
    <Text variant={variant} color={tone} selectable>
      <InlineChildren inlines={inlines} variant={variant} tone={tone} />
    </Text>
  );
}

function NoteImage({ alt, href }: { alt: string; href: string }) {
  const [failed, setFailed] = useState(false);
  const { palette } = useTheme();
  if (failed) {
    return (
      <Text variant="footnote" color="tertiary">
        {alt || href}
      </Text>
    );
  }
  return (
    <Image
      source={{ uri: href }}
      accessibilityLabel={alt || "Image"}
      resizeMode="contain"
      onError={() => setFailed(true)}
      style={[styles.image, { backgroundColor: palette.background, borderColor: palette.border }]}
    />
  );
}

function Paragraph({ inlines, variant }: { inlines: ChangelogInline[]; variant: InlineVariant }) {
  const pieces = splitProse(inlines);
  if (pieces.length === 1 && pieces[0]?.kind === "run") {
    return <InlineRun inlines={pieces[0].inlines} variant={variant} />;
  }

  return (
    <View style={styles.prose}>
      {pieces.map((piece, index) => {
        if (piece.kind === "command") return <CommandLine key={index} text={piece.text} />;
        if (piece.kind === "image") return <NoteImage key={index} alt={piece.alt} href={piece.href} />;
        return <InlineRun key={index} inlines={piece.inlines} variant={variant} />;
      })}
    </View>
  );
}

function NoteList({ items, nested }: { items: ChangelogListItem[]; nested?: boolean }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.list, nested ? styles.nestedList : null]}>
      {items.map((item, index) => (
        <View key={index} style={styles.listItem}>
          <View style={styles.bulletSlot}>
            {item.kind === "task" ? (
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: palette.outline,
                    backgroundColor: item.checked ? palette.accent : "transparent",
                  },
                ]}
              >
                {item.checked ? <AppIcon name="checkmark" size={12} color={palette.onAccent} /> : null}
              </View>
            ) : item.kind === "number" ? (
              <Text variant="footnote" color="tertiary">
                {item.index}.
              </Text>
            ) : (
              <View style={[styles.bullet, { backgroundColor: palette.accent }]} />
            )}
          </View>
          <View style={styles.listCopy}>
            {item.blocks.map((block, blockIndex) => (
              <BlockView key={blockIndex} block={block} nested />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function NoteTable({
  header,
  rows,
  align,
}: {
  header: ChangelogInline[][];
  rows: ChangelogInline[][][];
  align: ChangelogAlign[];
}) {
  const { palette } = useTheme();
  const columns = Math.max(header.length, ...rows.map((row) => row.length), 1);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          {Array.from({ length: columns }, (_, index) => (
            <View key={index} style={[styles.tableCell, { alignItems: tableAlign(align[index]) }]}>
              <InlineRun inlines={header[index] ?? []} variant="headline" />
            </View>
          ))}
        </View>
        {rows.map((row, rowIndex) => (
          <View
            key={rowIndex}
            style={[styles.tableRow, { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            {Array.from({ length: columns }, (_, index) => (
              <View key={index} style={[styles.tableCell, { alignItems: tableAlign(align[index]) }]}>
                <InlineRun inlines={row[index] ?? []} variant="body" />
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function tableAlign(align: ChangelogAlign | undefined): "flex-start" | "center" | "flex-end" {
  if (align === "center") return "center";
  if (align === "right") return "flex-end";
  return "flex-start";
}

function CodeBlock({ text, lang }: { text: string; lang: string }) {
  const { palette } = useTheme();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  return (
    <View style={[styles.command, { backgroundColor: palette.background, borderColor: palette.border }]}>
      <View style={styles.codeBody}>
        {lang ? (
          <Text variant="caption" color="tertiary">
            {lang}
          </Text>
        ) : null}
        <Text variant="mono" color="primary" selectable>
          {text}
        </Text>
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={copied ? "Copied" : "Copy code"}
        scaleTo={0.92}
        hitSlop={6}
        onPress={() => {
          haptics.light();
          void Clipboard.setStringAsync(text).then(() => {
            setCopied(true);
            toast.success("Copied");
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(false), 1600);
          });
        }}
        style={styles.copy}
      >
        <AppIcon
          name={copied ? "checkmark" : "copy-outline"}
          size={18}
          color={copied ? palette.accent : palette.textTertiary}
        />
      </PressableScale>
    </View>
  );
}

function BlockView({
  block,
  lead,
  nested,
}: {
  block: ChangelogBlock;
  lead?: boolean;
  nested?: boolean;
}) {
  const { palette } = useTheme();
  if (block.type === "heading") {
    const variant = block.level <= 2 ? "title3" : "headline";
    return <InlineRun inlines={block.inlines} variant={variant} />;
  }
  if (block.type === "list") return <NoteList items={block.items} nested={nested} />;
  if (block.type === "quote") {
    return (
      <View style={[styles.quote, { borderLeftColor: palette.accent }]}>
        {block.blocks.map((child, index) => (
          <BlockView key={index} block={child} />
        ))}
      </View>
    );
  }
  if (block.type === "code") return <CodeBlock text={block.text} lang={block.lang} />;
  if (block.type === "rule") {
    return <View style={[styles.rule, { backgroundColor: palette.border }]} />;
  }
  if (block.type === "table") {
    return <NoteTable header={block.header} rows={block.rows} align={block.align} />;
  }
  return <Paragraph inlines={block.inlines} variant={lead ? "callout" : "body"} />;
}

function Notes({ blocks }: { blocks: ChangelogBlock[] }) {
  if (blocks.length === 0) {
    return (
      <Text variant="footnote" color="tertiary">
        No notes for this release.
      </Text>
    );
  }
  const leadIndex = blocks.findIndex((block) => block.type === "paragraph");
  return (
    <View style={styles.notes}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} lead={index === leadIndex} />
      ))}
    </View>
  );
}

function VersionPill({
  label,
  selected,
  marked,
  onPress,
}: {
  label: string;
  selected: boolean;
  marked: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const fg = selected ? palette.onPrimaryContainer : palette.onSurface;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.pill,
        {
          backgroundColor: selected ? palette.accentSoft : palette.surfaceSecondary,
          borderColor: selected ? "transparent" : palette.border,
        },
      ]}
    >
      {marked ? <View style={[styles.dot, { backgroundColor: selected ? fg : palette.primary }]} /> : null}
      <Text variant="label" style={{ color: fg }}>
        {label}
      </Text>
    </PressableScale>
  );
}

function ReleaseBody({
  release,
  currentVersion,
  availableVersion,
  notesMaxHeight,
}: {
  release: ChangelogRelease;
  currentVersion: string;
  availableVersion: string | null;
  notesMaxHeight: number;
}) {
  const mark = changelogMark(release, currentVersion, availableVersion);
  const date = releaseDate(release.publishedAt);
  const { palette } = useTheme();

  return (
    <>
      <PanelHeader
        icon="newspaper-outline"
        iconColor={palette.accent}
        iconBackground={palette.accentSoft}
        title={`v${release.version}`}
        titleVariant="title1"
        subtitle={date || undefined}
        accessory={mark ? <MarkChip mark={mark} /> : undefined}
      />
      <ScrollView
        key={release.tagName}
        style={[styles.notesScroll, { maxHeight: notesMaxHeight }]}
        contentContainerStyle={styles.notesContent}
        showsVerticalScrollIndicator={false}
      >
        <Notes blocks={parseChangelogBody(release.body)} />
      </ScrollView>
    </>
  );
}

function ChangelogSheetBody({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const { palette } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const build = useBuildInfo();
  const changelog = useChangelog();
  const availableVersion = useNativeUpdateStore((state) => state.release?.version ?? null);
  const releases = changelog.releases;
  const [tag, setTag] = useState<string | null>(null);

  const selected =
    releases?.find((release) => release.tagName === tag) ?? releases?.[0] ?? null;

  const panelInner =
    height - insets.top - insets.bottom - spacing[48] - layout.overlayPadding * 2;
  const notesMaxHeight = Math.max(160, Math.min(440, panelInner - 250));

  let body: ReactNode;
  if (releases == null) {
    body = changelog.errorStatus == null ? (
      <View style={styles.loading}>
        <Spinner size="lg" />
      </View>
    ) : (
      <>
        <PanelHeader
          icon="newspaper-outline"
          iconColor={palette.accent}
          iconBackground={palette.accentSoft}
          title="Changelog"
          subtitle={failureMessage(changelog.errorStatus)}
        />
        <Button label="Try again" variant="secondary" block onPress={changelog.reload} />
      </>
    );
  } else if (releases.length === 0 || !selected) {
    body = (
      <PanelHeader
        icon="newspaper-outline"
        iconColor={palette.accent}
        iconBackground={palette.accentSoft}
        title="Changelog"
        subtitle="Published updates will show up here."
      />
    );
  } else {
    body = (
      <>
        <ReleaseBody
          release={selected}
          currentVersion={build.version}
          availableVersion={availableVersion}
          notesMaxHeight={notesMaxHeight}
        />
        {releases.length > 1 ? (
          <View style={styles.versions}>
            <Text variant="label" color="secondary">
              Versions
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pills}
            >
              {releases.map((release) => {
                const mark = changelogMark(release, build.version, availableVersion);
                return (
                  <VersionPill
                    key={release.tagName}
                    label={`v${release.version}`}
                    selected={release.tagName === selected.tagName}
                    marked={mark === "installed"}
                    onPress={() => {
                      haptics.selection();
                      setTag(release.tagName);
                    }}
                  />
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </>
    );
  }

  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss} maxWidth={480}>
      {body}
      <Button label="Done" block size="lg" onPress={onDismiss} style={styles.done} />
    </FloatingPanel>
  );
}

export function ChangelogSheet({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const [seen, setSeen] = useState(visible);
  useEffect(() => {
    if (visible) setSeen(true);
  }, [visible]);
  if (!seen) return null;
  return <ChangelogSheetBody visible={visible} onDismiss={onDismiss} />;
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  notesScroll: { flexGrow: 0, overflow: "hidden" },
  notesContent: { paddingBottom: spacing[4] },
  notes: { gap: spacing[12] },
  prose: { gap: spacing[10] },
  command: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: spacing[12],
    paddingVertical: spacing[4],
  },
  commandText: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing[8],
    lineHeight: 20,
  },
  copy: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chip: {
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[10],
    paddingVertical: spacing[4],
  },
  list: { gap: spacing[10] },
  listItem: { flexDirection: "row", alignItems: "flex-start" },
  bulletSlot: {
    width: spacing[16],
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  bullet: { width: 5, height: 5, borderRadius: radius.full },
  listCopy: { flex: 1, minWidth: 0 },
  versions: { marginTop: spacing[16], gap: spacing[8] },
  pills: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[6],
    minHeight: 32,
    paddingHorizontal: spacing[10],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  checkbox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  quote: {
    borderLeftWidth: 2,
    paddingLeft: spacing[12],
    gap: spacing[8],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing[4],
  },
  table: {},
  tableRow: { flexDirection: "row" },
  tableCell: {
    minWidth: 96,
    paddingVertical: spacing[8],
    paddingRight: spacing[16],
  },
  image: {
    width: "100%",
    height: 180,
    borderRadius: radius.sm,
  },
  nestedList: { marginTop: spacing[8] },
  codeBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing[8],
    gap: spacing[4],
  },
  dot: { width: 6, height: 6, borderRadius: radius.full },
  done: { marginTop: spacing[16] },
});
