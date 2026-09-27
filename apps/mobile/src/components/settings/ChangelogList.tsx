/** One release per block: version, date, and the notes, on the settings column. */
import { Linking, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import {
  changelogMark,
  parseChangelogBody,
  type ChangelogBlock,
  type ChangelogInline,
  type ChangelogMark,
  type ChangelogRelease,
} from "../../lib/changelog";
import { formatDate } from "../../lib/format";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { fontSize, layout, lineHeight, spacing } from "../../theme/tokens";

const MARK_LABEL: Record<ChangelogMark, string> = {
  installed: "Installed",
  available: "Available",
  early: "Early access",
};

const BODY_LINE = Math.round(fontSize.md * lineHeight.normal);

function releaseDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatDate(iso);
}

function isCommand(text: string): boolean {
  return text.includes(" ") || text.length > 42;
}

function Paragraph({ inlines }: { inlines: ChangelogInline[] }) {
  const pieces: Array<{ kind: "run"; inlines: ChangelogInline[] } | { kind: "command"; text: string }> = [];
  let run: ChangelogInline[] = [];
  const flush = () => {
    if (run.length === 0) return;
    pieces.push({ kind: "run", inlines: run });
    run = [];
  };

  for (const part of inlines) {
    if (part.type === "code" && isCommand(part.text)) {
      const last = run[run.length - 1];
      if (last?.type === "text") last.text = last.text.replace(/[ \t]+$/, "");
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

  if (pieces.length === 1 && pieces[0]?.kind === "run") {
    return <InlineRun inlines={pieces[0].inlines} />;
  }

  return (
    <View style={styles.prose}>
      {pieces.map((piece, index) =>
        piece.kind === "command" ? (
          <Text key={index} variant="mono" color="primary" selectable style={styles.command}>
            {piece.text}
          </Text>
        ) : (
          <InlineRun key={index} inlines={piece.inlines} />
        ),
      )}
    </View>
  );
}

function InlineRun({ inlines }: { inlines: ChangelogInline[] }) {
  return (
    <Text variant="body" color="secondary" selectable>
      {inlines.map((part, index) => {
        if (part.type === "code") {
          return (
            <Text key={index} variant="mono" color="primary" style={styles.code}>
              {part.text}
            </Text>
          );
        }
        if (part.type === "strong") {
          return (
            <Text key={index} variant="bodyStrong" color="secondary">
              {part.text}
            </Text>
          );
        }
        if (part.type === "link") {
          return (
            <Text
              key={index}
              variant="body"
              color="accent"
              suppressHighlighting
              accessibilityRole="link"
              onPress={() => {
                haptics.light();
                void Linking.openURL(part.href).catch(() => {});
              }}
            >
              {part.text}
            </Text>
          );
        }
        return part.text;
      })}
    </Text>
  );
}

function NoteList({ items }: { items: ChangelogInline[][] }) {
  const { palette } = useTheme();
  return (
    <View style={styles.list}>
      {items.map((item, index) => (
        <View key={index} style={styles.listItem}>
          <View style={styles.bulletSlot}>
            <View style={[styles.bullet, { backgroundColor: palette.textTertiary }]} />
          </View>
          <View style={styles.listCopy}>
            <InlineRun inlines={item} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Notes({ blocks }: { blocks: ChangelogBlock[] }) {
  if (blocks.length === 0) {
    return (
      <Text variant="footnote" color="tertiary" style={styles.notes}>
        No notes for this release.
      </Text>
    );
  }
  return (
    <View style={styles.notes}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <Text key={index} variant="title3">
              {block.text}
            </Text>
          );
        }
        if (block.type === "list") return <NoteList key={index} items={block.items} />;
        return <Paragraph key={index} inlines={block.inlines} />;
      })}
    </View>
  );
}

export function ChangelogList({
  releases,
  currentVersion,
  availableVersion,
}: {
  releases: ChangelogRelease[];
  currentVersion: string;
  availableVersion: string | null;
}) {
  const { palette } = useTheme();

  return (
    <View>
      {releases.map((release) => {
        const mark = changelogMark(release, currentVersion, availableVersion);
        const date = releaseDate(release.publishedAt);
        return (
          <View
            key={release.tagName}
            style={[styles.entry, { borderBottomColor: palette.border }]}
          >
            <View style={styles.heading}>
              <Text
                variant="headline"
                numberOfLines={1}
                color={mark === "installed" ? "accent" : "primary"}
                style={styles.version}
              >
                v{release.version}
              </Text>
              {date ? (
                <Text variant="footnote" color="tertiary" style={styles.date}>
                  {date}
                </Text>
              ) : null}
            </View>
            {mark ? (
              <Text
                variant="footnote"
                color={mark === "early" ? "tertiary" : "accent"}
                style={styles.mark}
              >
                {MARK_LABEL[mark]}
              </Text>
            ) : null}
            <Notes blocks={parseChangelogBody(release.body)} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  entry: {
    paddingTop: spacing[14],
    paddingBottom: spacing[16],
    paddingHorizontal: layout.rowInset,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heading: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing[12],
  },
  version: { flexGrow: 1, flexShrink: 1 },
  date: { flexShrink: 0 },
  mark: { marginTop: spacing[2] },
  notes: { marginTop: spacing[10], gap: spacing[12] },
  prose: { gap: spacing[8] },
  command: { fontSize: fontSize.md, lineHeight: BODY_LINE },
  code: {
    fontSize: fontSize.md,
    lineHeight: BODY_LINE,
  },
  list: { gap: spacing[8] },
  listItem: { flexDirection: "row", alignItems: "flex-start", gap: spacing[10] },
  bulletSlot: {
    width: spacing[12],
    height: BODY_LINE,
    alignItems: "center",
    justifyContent: "center",
  },
  bullet: { width: 4, height: 4, borderRadius: 2 },
  listCopy: { flex: 1, minWidth: 0 },
});
