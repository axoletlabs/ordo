/**
 * One release at a time, with a content-sized sheet and anchored navigation.
 * The top edge animates between releases; typography and actions stay stable.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Linking, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { Text, type TextColor } from "../ui/Text";
import { Button } from "../ui/Button";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { PanelActions } from "../ui/SheetActionRow";
import { IconButton } from "../ui/IconButton";
import { Segmented } from "../ui/Segmented";
import { Spinner } from "../ui/Spinner";
import { toast } from "../ui/toast-store";
import {
  parseChangelogBody,
  type ChangelogAlign,
  type ChangelogBlock,
  type ChangelogInline,
  type ChangelogListItem,
  type ChangelogRelease,
} from "../../lib/changelog";
import { haptics } from "../../lib/haptics";
import { releaseName } from "../../lib/release-name";
import { useChangelog } from "../../hooks/use-changelog";
import { useTheme } from "../../theme/ThemeProvider";
import { AppIcon } from "../ui/PinIcon";
import { radius, resolveFont, spacing } from "../../theme/tokens";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { recordDiagnosticEvent } from "../../lib/local-diagnostics";

type Piece =
  | { kind: "run"; inlines: ChangelogInline[] }
  | { kind: "command"; text: string }
  | { kind: "image"; alt: string; href: string };

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
      <ScrollView horizontal style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ paddingVertical: spacing[12], paddingRight: spacing[8] }}>
        <Text variant="bodyMedium" color="primary" selectable style={styles.codeText}>{text}</Text>
      </ScrollView>
      <IconButton variant="standard" name={copied ? "checkmark" : "copy-outline"}
        accessibilityLabel={copied ? "Copied" : "Copy command"}
        onPress={() => {
          haptics.light();
          void Clipboard.setStringAsync(text).then(() => {
            setCopied(true);
            toast.success("Copied");
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(false), 1600);
           }).catch(() => toast.error("Couldn't copy the command."));
        }}
        color={copied ? palette.primary : palette.onSurfaceVariant}
      />
    </View>
  );
}

type InlineVariant = "callout" | "body" | "title3" | "headline" | "bodyMedium" | "titleSmall";

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
      <Text key={index} variant="mono" color={tone}>
        {part.text}
      </Text>
    );
  }
  if (part.type === "image") return part.alt || part.href;
  const children = (
    <InlineChildren inlines={"inlines" in part ? part.inlines : []} variant={variant} tone={part.type === "link" ? "accent" : tone} />
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
        style={styles.link}
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

function InlineRun({ inlines, variant, color }: {
  inlines: ChangelogInline[];
  variant: InlineVariant;
  color?: TextColor;
}) {
  const tone: TextColor = color ?? (variant === "callout" ? "secondary" : "primary");
  return (
    <Text variant={variant} color={tone} selectable accessibilityRole={variant === "title3" || variant === "headline" || variant === "titleSmall" ? "header" : undefined}>
      <InlineChildren inlines={inlines} variant={variant} tone={tone} />
    </Text>
  );
}

function NoteImage({ alt, href }: { alt: string; href: string }) {
  const [failed, setFailed] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const { palette } = useTheme();
  useEffect(() => {
    let active = true;
    setFailed(false);
    Image.getSize(href, (width, height) => { if (active && width > 0 && height > 0) setAspectRatio(width / height); }, () => {});
    return () => { active = false; };
  }, [href]);
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
      style={[styles.image, { aspectRatio, backgroundColor: palette.surfaceContainerLowest }]}
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
  // Named highlights use ordinary Markdown, so the same notes remain readable
  // on GitHub. Keep them together on one tonal surface, not a card per point.
  const highlights = !nested && items.length > 0 && items.every((item) =>
    item.kind === "bullet" && item.blocks[0]?.type === "paragraph" && item.blocks[0].inlines[0]?.type === "strong");
  if (highlights) {
    return <View testID="changelog-highlights" style={[styles.highlights, { backgroundColor: palette.surfaceContainerHigh }]}>
      {items.map((item, index) => {
        const first = item.blocks[0];
        if (first.type !== "paragraph" || first.inlines[0]?.type !== "strong") return null;
        const description = first.inlines.slice(1).map((part, partIndex) => partIndex === 0 && part.type === "text"
          ? { ...part, text: part.text.replace(/^\s*[—–:-]?\s*/, "") } : part);
        const title = first.inlines[0].inlines.map((part, partIndex, all) =>
          partIndex === all.length - 1 && part.type === "text"
            ? { ...part, text: part.text.replace(/:\s*$/, "") } : part);
        return <View key={index} style={styles.highlight}>
          <InlineRun inlines={title} variant="headline" />
          {description.length ? <InlineRun inlines={description} variant="bodyMedium" color="secondary" /> : null}
          {item.blocks.slice(1).map((block, blockIndex) => <BlockView key={blockIndex} block={block} nested />)}
        </View>;
      })}
    </View>;
  }
  return (
    <View testID="changelog-list" style={[styles.list, nested ? styles.nestedList : null]}>
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
              <View style={[styles.bullet, { backgroundColor: palette.onSurfaceVariant }]} />
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
        <ScrollView horizontal contentContainerStyle={{ paddingVertical: spacing[8], paddingRight: spacing[8] }}>
          <Text variant="bodyMedium" color="primary" selectable style={styles.codeText}>{text}</Text>
        </ScrollView>
      </View>
      <IconButton variant="standard" name={copied ? "checkmark" : "copy-outline"}
        accessibilityLabel={copied ? "Copied" : "Copy code"}
        onPress={() => {
          haptics.light();
          void Clipboard.setStringAsync(text).then(() => {
            setCopied(true);
            toast.success("Copied");
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(false), 1600);
           }).catch(() => toast.error("Couldn't copy the code."));
        }}
        color={copied ? palette.primary : palette.onSurfaceVariant}
        style={{ alignSelf: "flex-start", marginTop: spacing[4] }}
      />
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
    return <InlineRun inlines={block.inlines} variant="titleSmall" color="accent" />;
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
  return <Paragraph inlines={block.inlines} variant={lead ? "callout" : "bodyMedium"} />;
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
    <View>
      {blocks.map((block, index) => {
        return <View key={index} style={index === 0 ? undefined : block.type === "heading" ? styles.sectionHeading
          : blocks[index - 1]?.type === "heading" ? styles.sectionBody : styles.noteBlock}>
          <BlockView block={block} lead={index === leadIndex} />
        </View>;
      })}
    </View>
  );
}

function ReleaseSelector({
  releases,
  selected,
  onSelect,
}: {
  releases: ChangelogRelease[];
  selected: ChangelogRelease;
  onSelect: (tag: string) => void;
}) {
  return (
    <Segmented accessibilityLabel="Releases" scrollable compact selectionScroll="reveal"
      options={releases.map((release) => ({
        value: release.tagName,
        label: releaseName(release.version),
      }))}
      value={selected.tagName} onChange={onSelect} />
  );
}

function inlineText(inlines: ChangelogInline[]): string {
  return inlines.map((part) => {
    if (part.type === "text" || part.type === "code") return part.text;
    if (part.type === "break") return " ";
    if (part.type === "image") return part.alt;
    return inlineText(part.inlines);
  }).join("");
}

function ChangelogSheetBody({
  visible,
  onDismiss,
  initialTag,
  onShow,
}: {
  visible: boolean;
  onDismiss: () => void;
  initialTag?: string;
  onShow?: () => void;
}) {
  const changelog = useChangelog();
  const releases = changelog.releases;
  const [tag, setTag] = useState<string | null>(initialTag ?? null);
  const { width, height } = useWindowDimensions();
  const compactActions = height < 500 && width > height;

  useEffect(() => {
    recordDiagnosticEvent(visible ? "changelog.open" : "changelog.close");
  }, [visible]);

  useEffect(() => {
    if (visible) setTag(initialTag ?? null);
  }, [visible, initialTag]);

  const selected =
    releases?.find((release) => release.tagName === tag) ?? releases?.[0] ?? null;
  const { headline, blocks } = useMemo(() => {
    const parsed = parseChangelogBody(selected?.body ?? "");
    const first = parsed[0];
    const hasHeadline = first?.type === "heading" && first.level <= 3;
    return { headline: hasHeadline ? inlineText(first.inlines) : null, blocks: hasHeadline ? parsed.slice(1) : parsed };
  }, [selected?.body]);
  const date = selected && !Number.isNaN(Date.parse(selected.publishedAt))
    ? new Date(selected.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
  const releaseDetails = [headline && selected ? releaseName(selected.version) : null, date].filter(Boolean).join(" · ");
  const motion = useMaterialMotion();
  const contentOpacity = useSharedValue(1);
  const previousTag = useRef(selected?.tagName);
  useLayoutEffect(() => {
    const changed = previousTag.current != null && previousTag.current !== selected?.tagName;
    previousTag.current = selected?.tagName;
    if (visible && changed && !motion.reducedMotion) {
      contentOpacity.value = 0;
      contentOpacity.value = withSpring(1, materialMotion.effects.fast);
    } else contentOpacity.value = 1;
  }, [visible, selected?.tagName, motion, contentOpacity]);
  const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));
  let body: ReactNode;
  if (releases == null) {
    body = changelog.errorStatus == null ? (
      <View style={styles.loading}>
        <Spinner size="lg" />
        <Text variant="bodyMedium" color="secondary">Loading release notes…</Text>
      </View>
    ) : (
      <View style={styles.empty}>
        <Text variant="titleMedium">Couldn't load release notes</Text>
        <Text variant="bodyMedium" color="secondary">{failureMessage(changelog.errorStatus)}</Text>
        <Button label="Try again" variant="secondary" block onPress={changelog.reload} />
      </View>
    );
  } else if (releases.length === 0 || !selected) {
    body = (
      <Text variant="body" color="secondary">Published updates will show up here.</Text>
    );
  } else {
    body = <Animated.View style={contentStyle}><Notes blocks={blocks} /></Animated.View>;
  }

  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss} onShow={onShow} maxWidth={640}
      presentation="bottom-sheet" sheetSizing="adaptive" sheetBodyTopPadding={spacing[8]} scrollResetKey={selected?.tagName}>
      <PanelHeader title="What's new" titleVariant="labelLarge" titleColor="accent" align="left"
        accessory={selected ? <Animated.View style={[styles.releaseHeading, contentStyle]}>
          <Text variant="headlineSmall" accessibilityRole="header" numberOfLines={2}>{headline || releaseName(selected.version)}</Text>
          {releaseDetails ? <Text variant="bodyMedium" color="secondary" numberOfLines={1}>{releaseDetails}</Text> : null}
        </Animated.View> : undefined} />
      {body}
      <PanelActions confirmLabel="Got it" size={compactActions ? "sm" : "md"} fullWidth={!compactActions}
        inline={compactActions} onConfirm={onDismiss}>
        {selected && releases && releases.length > 1 ? <View style={[styles.releaseNavigation, compactActions ? { paddingTop: 0 } : null]}>
          {!compactActions ? <Text variant="titleSmall" color="secondary">Release history</Text> : null}
          <ReleaseSelector releases={releases} selected={selected} onSelect={(next) => {
            recordDiagnosticEvent("changelog.select", next);
            setTag(next);
          }} />
        </View> : null}
      </PanelActions>
    </FloatingPanel>
  );
}

export function ChangelogSheet({
  visible,
  onDismiss,
  initialTag,
  onShow,
}: {
  visible: boolean;
  onDismiss: () => void;
  initialTag?: string;
  onShow?: () => void;
}) {
  const [seen, setSeen] = useState(visible);
  useEffect(() => {
    if (visible) setSeen(true);
  }, [visible]);
  if (!seen) return null;
  return <ChangelogSheetBody visible={visible} onDismiss={onDismiss} initialTag={initialTag} onShow={onShow} />;
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 120,
    gap: spacing[16],
    alignItems: "center",
    justifyContent: "center",
  },
  noteBlock: { marginTop: spacing[16] },
  highlights: { padding: spacing[16], borderRadius: radius.xl, gap: spacing[16] },
  highlight: { gap: spacing[4] },
  releaseHeading: { marginTop: spacing[4], width: "100%", gap: spacing[4] },
  sectionHeading: { marginTop: spacing[24] },
  sectionBody: { marginTop: spacing[8] },
  empty: { gap: spacing[16] },
  prose: { gap: spacing[10] },
  link: { textDecorationLine: "underline" },
  command: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: spacing[12],
    paddingVertical: spacing[4],
  },
  codeText: { fontFamily: resolveFont("mono", "400"), lineHeight: 20, letterSpacing: 0 },
  list: { gap: spacing[8] },
  listItem: { flexDirection: "row", alignItems: "flex-start" },
  bulletSlot: {
    width: spacing[16],
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  bullet: { width: 5, height: 5, borderRadius: radius.full },
  listCopy: { flex: 1, minWidth: 0, gap: spacing[8] },
  releaseNavigation: { paddingTop: spacing[8], gap: spacing[8], width: "100%" },
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
    borderRadius: radius.sm,
  },
  nestedList: { marginTop: spacing[8] },
  codeBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing[8],
    gap: spacing[4],
  },
});
