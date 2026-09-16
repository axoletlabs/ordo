/**
 * Native selection for article highlights.
 * Wrapping itself lives in @ordo/shared (TextQuoteSelector → <mark>).
 *
 * Phrases are OS text, never an editor: UITextView on iOS and selectable
 * Text (TextView) on Android. A caret is ignored; only a real range becomes
 * a highlight draft. Long-press selects; the draft bar is the action
 * surface (copy, highlight, remove). Tap still opens links.
 */
import React, { createContext, useCallback, useContext, useMemo } from "react";
import { Linking, Platform, StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { UITextView } from "@bsky.app/react-native-uitextview";
import {
  useRendererProps,
  type CustomBlockRenderer,
  type CustomTextualRenderer,
  type TNode,
} from "@native-html/render";
import { htmlToPlainText, quoteFromBlock, quoteFromRange, type HighlightAnchor } from "@ordo/shared";
import { useAndroidPhraseSelection } from "./android-phrase-selection";
import {
  highlightIdCoveringRange,
  hrefCoveringRange,
  nodeTextContent,
  type HtmlTableNode,
} from "./article-html-table";
import { selectedRange } from "./phrase-selection";

function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href) || /^mailto:/i.test(href);
}

const TEXT_STYLE_KEYS = [
  "backgroundColor",
  "color",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "includeFontPadding",
  "letterSpacing",
  "lineHeight",
  "textAlign",
  "textDecorationColor",
  "textDecorationLine",
  "textDecorationStyle",
  "textTransform",
  "writingDirection",
] as const;

function pickTextStyle(native: Record<string, unknown>): TextStyle {
  const style: TextStyle = {};
  for (const key of TEXT_STYLE_KEYS) {
    const value = native[key];
    if (value != null) (style as Record<string, unknown>)[key] = value;
  }
  return style;
}

function asHtmlNode(node: TNode): HtmlTableNode {
  return node as unknown as HtmlTableNode;
}

function pressPropsFor(node: TNode) {
  if (node.tagName === "a") {
    const href = node.attributes.href ?? "";
    if (!isExternalHref(href)) return undefined;
    return {
      onPress: () => {
        Linking.openURL(href).catch(() => {});
      },
    };
  }
  return undefined;
}

function InlineSpan({
  style,
  children,
  onPress,
}: {
  style: TextStyle;
  children: React.ReactNode;
  onPress?: () => void;
}) {
  if (Platform.OS === "ios") {
    return (
      <UITextView style={style} onPress={onPress}>
        {children}
      </UITextView>
    );
  }
  return (
    <Text selectable={false} style={style} onPress={onPress}>
      {children}
    </Text>
  );
}

/** Rebuild a TNode as inline spans so the OS can select inside one text view. */
function selectableInline(node: TNode): React.ReactNode {
  if (node.type === "text") {
    if (!node.data) return null;
    const style = pickTextStyle(node.getNativeStyles() as Record<string, unknown>);
    const press = pressPropsFor(node);
    if (!press && Object.keys(style).length === 0) return node.data;
    return (
      <InlineSpan style={style} onPress={press?.onPress}>
        {node.data}
      </InlineSpan>
    );
  }
  if (node.tagName === "br") return "\n";
  if (node.type === "empty" || node.tagName === "img") return null;
  if (node.tagName == null) {
    return node.children.map((child, index) => (
      <React.Fragment key={index}>{selectableInline(child)}</React.Fragment>
    ));
  }
  const style = pickTextStyle(node.getNativeStyles() as Record<string, unknown>);
  const press = pressPropsFor(node);
  return (
    <InlineSpan style={style} onPress={press?.onPress}>
      {node.children.map((child, index) => (
        <React.Fragment key={index}>{selectableInline(child)}</React.Fragment>
      ))}
    </InlineSpan>
  );
}

function webSelectedText(): string {
  const selection = (
    globalThis as { getSelection?: () => { toString: () => string } | null }
  ).getSelection?.();
  return selection?.toString() ?? "";
}

/** Selection draft; `highlightId` is set when the range sits inside a mark. */
export type HighlightSelectDraft = HighlightAnchor & { highlightId?: string };

export interface HighlightUiHandlers {
  articlePlain: string;
  selectionColor: string;
  textStyle?: StyleProp<TextStyle>;
  onTextSelect: (draft: HighlightSelectDraft | null) => void;
}

export const HighlightUiContext = createContext<HighlightUiHandlers | null>(null);

export function ignoreTextSelect(_draft: HighlightSelectDraft | null) {}

export function highlightHandlersFromHtml(
  html: string,
  selectionColor: string,
  handlers: Omit<HighlightUiHandlers, "articlePlain" | "selectionColor">,
): HighlightUiHandlers {
  return {
    articlePlain: htmlToPlainText(html),
    selectionColor,
    ...handlers,
  };
}

export function SelectablePhrase({
  tnode,
}: {
  tnode: TNode;
  TNodeChildrenRenderer: React.ComponentType<{ tnode: TNode }>;
}) {
  const ui = useContext(HighlightUiContext);
  const text = useMemo(() => nodeTextContent(asHtmlNode(tnode)), [tnode]);
  const spans = useMemo(() => {
    if (tnode.type === "text") return selectableInline(tnode);
    return tnode.children.map((child, index) => (
      <React.Fragment key={index}>{selectableInline(child)}</React.Fragment>
    ));
  }, [tnode]);

  const publishRange = useCallback(
    (start: number, end: number) => {
      if (!ui) return;
      const range = selectedRange(start, end);
      if (!range) return;
      const quote =
        quoteFromBlock(ui.articlePlain, text, range.start, range.end) ??
        quoteFromRange(text, range.start, range.end);
      if (!quote) return;
      const htmlNode = asHtmlNode(tnode);
      const href = hrefCoveringRange(htmlNode, range.start, range.end);
      const highlightId = highlightIdCoveringRange(htmlNode, range.start, range.end) ?? undefined;
      ui.onTextSelect({
        ...quote,
        ...(href ? { href } : {}),
        ...(highlightId ? { highlightId } : {}),
      });
    },
    [text, tnode, ui],
  );

  const { textRef, onLayout } = useAndroidPhraseSelection(publishRange);

  const onIosSelectionChange = useCallback(
    (event: { nativeEvent: { start: number; end: number } }) => {
      publishRange(event.nativeEvent.start, event.nativeEvent.end);
    },
    [publishRange],
  );

  const onWebSelect = useCallback(() => {
    const selected = webSelectedText();
    if (!selected) return;
    const start = text.indexOf(selected);
    if (start < 0) {
      ui?.onTextSelect(quoteFromRange(selected, 0, selected.length));
      return;
    }
    publishRange(start, start + selected.length);
  }, [publishRange, text, ui]);

  const phraseStyle = [styles.phrase, ui?.textStyle];

  if (Platform.OS === "ios") {
    return (
      <UITextView
        selectable
        uiTextView
        accessibilityRole="text"
        style={phraseStyle}
        onSelectionChange={onIosSelectionChange}
      >
        {spans}
      </UITextView>
    );
  }

  if (Platform.OS === "web") {
    return (
      <Text
        selectable
        accessibilityRole="text"
        selectionColor={ui?.selectionColor}
        style={phraseStyle}
        {...({ onMouseUp: onWebSelect, onKeyUp: onWebSelect } as object)}
      >
        {spans}
      </Text>
    );
  }

  return (
    <Text
      ref={textRef}
      selectable
      accessibilityRole="text"
      selectionColor={ui?.selectionColor}
      style={phraseStyle}
      onLayout={onLayout}
    >
      {spans}
    </Text>
  );
}

export const selectableBlockRenderer: CustomBlockRenderer = ({
  tnode,
  TDefaultRenderer,
  TNodeChildrenRenderer,
  ...props
}) => (
  <TDefaultRenderer tnode={tnode} TNodeChildrenRenderer={TNodeChildrenRenderer} {...props}>
    <SelectablePhrase tnode={tnode} TNodeChildrenRenderer={TNodeChildrenRenderer} />
  </TDefaultRenderer>
);

export const markRenderer: CustomTextualRenderer = (props) => <props.TDefaultRenderer {...props} />;

export const anchorRenderer: CustomTextualRenderer = (props) => {
  const { onPress } = useRendererProps("a");
  const href = props.tnode.attributes.href ?? "";
  return (
    <props.TDefaultRenderer
      {...props}
      onPress={(event) => {
        if (isExternalHref(href)) onPress?.(event, href, props.tnode.attributes, "_self");
      }}
    />
  );
};

const styles = StyleSheet.create({
  phrase: {
    padding: 0,
    margin: 0,
    ...Platform.select({
      android: { textAlignVertical: "top" as const, includeFontPadding: false },
      default: {},
    }),
  },
});
