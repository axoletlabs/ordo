/**
 * A bottom-sheet release reader: tonal release navigation above continuous
 * Markdown notes, with the shared Material sheet and menu treatments.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Linking, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Text, type TextColor } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { Button } from "../ui/Button";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { PanelActions } from "../ui/SheetActionRow";
import { IconButton } from "../ui/IconButton";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { DisclosureChevron } from "../ui/DisclosureChevron";
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
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { useChangelog } from "../../hooks/use-changelog";
import { useTheme } from "../../theme/ThemeProvider";
import { AppIcon } from "../ui/PinIcon";
import { radius, resolveFont, spacing } from "../../theme/tokens";

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

function InlineRun({ inlines, variant, color }: {
  inlines: ChangelogInline[];
  variant: InlineVariant;
  color?: TextColor;
}) {
  const tone: TextColor = color ?? (variant === "callout" ? "secondary" : "primary");
  return (
    <Text variant={variant} color={tone} selectable accessibilityRole={variant === "title3" || variant === "headline" ? "header" : undefined}>
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
    const variant = block.level <= 2 ? "title3" : "headline";
    return <InlineRun inlines={block.inlines} variant={variant} color="accent" />;
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
      {blocks.map((block, index) => {
        return <View key={index} style={block.type === "heading" && index > 0 ? styles.sectionHeading : undefined}>
          <BlockView block={block} lead={index === leadIndex} />
        </View>;
      })}
    </View>
  );
}

function ReleaseSelector({
  visible,
  releases,
  selected,
  onSelect,
}: {
  visible: boolean;
  releases: ChangelogRelease[];
  selected: ChangelogRelease;
  onSelect: (tag: string) => void;
}) {
  const { palette, expressive } = useTheme();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchorRect | null>(null);
  const opening = useRef(0);
  useLayoutEffect(() => {
    if (!visible) setOpen(false);
    // Invalidate a deferred native measurement when the sheet closes, reopens,
    // or unmounts so it cannot publish a menu into a different session.
    return () => { opening.current += 1; };
  }, [visible]);

  return (
    <>
      <View ref={anchorRef} collapsable={false} style={styles.releaseAnchor}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Release history, ${releaseName(selected.version)}`}
          accessibilityState={{ expanded: open && visible }}
          aria-haspopup="menu"
          onPress={() => {
            if (!visible) return;
            const request = ++opening.current;
            measureAnchor(anchorRef.current, (rect) => {
              if (request !== opening.current) return;
              haptics.selection();
              setAnchor(rect);
              setOpen(true);
            });
          }}
          stateLayerColor={palette.onSecondaryContainer}
          shape={{ rest: 24, pressed: expressive ? radius.md : 24 }}
          style={[styles.releaseTrigger, { backgroundColor: palette.secondaryContainer }]}
        >
          <Text variant="labelLarge" numberOfLines={1} style={[styles.releaseLabel, { color: palette.onSecondaryContainer }]}>
            {releaseName(selected.version)}
          </Text>
          <DisclosureChevron expanded={open && visible} size={20} color={palette.onSecondaryContainer} />
        </PressableScale>
      </View>
      <ContextMenu visible={open && visible} onDismiss={() => setOpen(false)} anchor={anchor} width={320}>
        {releases.map((release) => (
          <ContextMenuItem
            key={release.tagName}
            label={releaseName(release.version)}
            selected={release.tagName === selected.tagName}
            selectionRole="menuitemradio"
            onPress={() => {
              onSelect(release.tagName);
              setOpen(false);
            }}
          />
        ))}
      </ContextMenu>
    </>
  );
}

function ReleaseBody({ release }: { release: ChangelogRelease }) {
  const blocks = useMemo(() => parseChangelogBody(release.body), [release.body]);
  return (
    <View style={styles.notesContent}>
      <Notes blocks={blocks} />
    </View>
  );
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
  const { expressive } = useTheme();
  const { width, height } = useWindowDimensions();
  const compactActions = width >= 600 && height < 480;
  const changelog = useChangelog();
  const releases = changelog.releases;
  const [tag, setTag] = useState<string | null>(initialTag ?? null);

  useEffect(() => {
    if (visible) setTag(initialTag ?? null);
  }, [visible, initialTag]);

  const selected =
    releases?.find((release) => release.tagName === tag) ?? releases?.[0] ?? null;
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
    body = <ReleaseBody release={selected} />;
  }

  return (
    <FloatingPanel visible={visible} onDismiss={onDismiss} onShow={onShow} maxWidth={640}
      presentation="bottom-sheet" scrollResetKey={selected?.tagName}>
      <PanelHeader title="What's new" titleVariant={expressive ? "headlineMedium" : "headlineSmall"} align="left"
        accessory={selected ? (
          <View style={styles.releaseNavigation}>
            {releases && releases.length > 1 ? (
              <ReleaseSelector visible={visible} releases={releases} selected={selected} onSelect={setTag} />
            ) : <Text variant="bodyMedium" color="secondary">{releaseName(selected.version)}</Text>}
          </View>
        ) : undefined} />
      {body}
      <PanelActions confirmLabel="Got it" onConfirm={onDismiss} fullWidth={!compactActions} inline={compactActions} />
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
  notesContent: { paddingBottom: spacing[8] },
  notes: { gap: spacing[16] },
  sectionHeading: { marginTop: spacing[16] },
  empty: { gap: spacing[16] },
  prose: { gap: spacing[10] },
  command: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: spacing[12],
    paddingVertical: spacing[4],
  },
  codeText: { fontFamily: resolveFont("mono", "400"), lineHeight: 20, letterSpacing: 0 },
  list: { gap: spacing[16] },
  listItem: { flexDirection: "row", alignItems: "flex-start" },
  bulletSlot: {
    width: spacing[16],
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  bullet: { width: 5, height: 5, borderRadius: radius.full },
  listCopy: { flex: 1, minWidth: 0, gap: spacing[8] },
  releaseNavigation: { marginTop: spacing[12], maxWidth: "100%", alignSelf: "flex-start" },
  releaseAnchor: { maxWidth: "100%" },
  releaseTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    minHeight: 48,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    borderRadius: radius.full,
  },
  releaseLabel: { flexShrink: 1 },
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
