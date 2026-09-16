/**
 * Native selection for article highlights.
 * Wrapping itself lives in @ordo/shared (TextQuoteSelector → <mark>).
 *
 * Phrases are OS text, never an editor: UITextView on iOS and selectable
 * Text (TextView) on Android. A caret is ignored; only a real range becomes
 * a highlight draft. Cancel on the action bar dismisses it.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { UITextView } from "@bsky.app/react-native-uitextview";
import {
  getNativePropsForTNode,
  useRendererProps,
  type CustomBlockRenderer,
  type CustomTextualRenderer,
  type TNode,
} from "@native-html/render";
import {
  htmlToPlainText,
  highlightIdFromMark,
  quoteFromBlock,
  quoteFromRange,
  type HighlightAnchor,
} from "@ordo/shared";
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

function dummyPressEvent(): GestureResponderEvent {
  return { nativeEvent: { pageX: 0, pageY: 0 } } as GestureResponderEvent;
}

function gestureEvent(event?: GestureResponderEvent): GestureResponderEvent {
  return event && Number.isFinite(event.nativeEvent?.pageX) ? event : dummyPressEvent();
}

function pressPropsFor(node: TNode, ui: HighlightUiHandlers | null) {
  if (node.tagName === "a") {
    const href = node.attributes.href ?? "";
    if (!isExternalHref(href)) return undefined;
    return {
      onPress: () => {
        Linking.openURL(href).catch(() => {});
      },
      onLongPress: (event?: GestureResponderEvent) => {
        if (!ui) return;
        const text = nodeTextContent(asHtmlNode(node));
        const quote =
          quoteFromBlock(ui.articlePlain, text, 0, text.length) ?? quoteFromRange(text, 0, text.length);
        if (!quote) return;
        ui.onLinkLongPress({ ...quote, href }, gestureEvent(event));
      },
    };
  }
  const id = highlightIdFromMark(node.id);
  if (id && ui) {
    return {
      onLongPress: (event?: GestureResponderEvent) => ui.onHighlightPress(id, gestureEvent(event)),
    };
  }
  return undefined;
}

function InlineSpan({
  style,
  children,
  onPress,
  onLongPress,
}: {
  style: TextStyle;
  children: React.ReactNode;
  onPress?: (event?: GestureResponderEvent) => void;
  onLongPress?: (event?: GestureResponderEvent) => void;
}) {
  if (Platform.OS === "ios") {
    return (
      <UITextView style={style} onPress={onPress} onLongPress={onLongPress}>
        {children}
      </UITextView>
    );
  }
  return (
    <Text selectable={false} style={style} onPress={onPress} onLongPress={onLongPress}>
      {children}
    </Text>
  );
}

/** Rebuild a TNode as inline spans so the OS can select inside one text view. */
function selectableInline(node: TNode, ui: HighlightUiHandlers | null): React.ReactNode {
  if (node.type === "text") {
    if (!node.data) return null;
    const style = pickTextStyle(node.getNativeStyles() as Record<string, unknown>);
    const press = pressPropsFor(node, ui);
    if (!press && Object.keys(style).length === 0) return node.data;
    return (
      <InlineSpan style={style} onPress={press?.onPress} onLongPress={press?.onLongPress}>
        {node.data}
      </InlineSpan>
    );
  }
  if (node.tagName === "br") return "\n";
  if (node.type === "empty" || node.tagName === "img") return null;
  if (node.tagName == null) {
    return node.children.map((child, index) => (
      <React.Fragment key={index}>{selectableInline(child, ui)}</React.Fragment>
    ));
  }
  const style = pickTextStyle(node.getNativeStyles() as Record<string, unknown>);
  const press = pressPropsFor(node, ui);
  return (
    <InlineSpan style={style} onPress={press?.onPress} onLongPress={press?.onLongPress}>
      {node.children.map((child, index) => (
        <React.Fragment key={index}>{selectableInline(child, ui)}</React.Fragment>
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
  onHighlightPress: (id: string, event: GestureResponderEvent) => void;
  onLinkLongPress: (draft: HighlightAnchor & { href: string }, event: GestureResponderEvent) => void;
}

export const HighlightUiContext = createContext<HighlightUiHandlers | null>(null);

export function ignoreTextSelect(_draft: HighlightSelectDraft | null) {}
export function ignoreHighlightPress(_id: string, _event: GestureResponderEvent) {}
export function ignoreLinkLongPress(
  _draft: HighlightAnchor & { href: string },
  _event: GestureResponderEvent,
) {}

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
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const text = useMemo(() => nodeTextContent(asHtmlNode(tnode)), [tnode]);
  const spans = useMemo(() => {
    const handlers = uiRef.current;
    if (tnode.type === "text") return selectableInline(tnode, handlers);
    return tnode.children.map((child, index) => (
      <React.Fragment key={index}>{selectableInline(child, handlers)}</React.Fragment>
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
      collapsable={false}
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

export const markRenderer: CustomTextualRenderer = (props) => {
  const ui = useContext(HighlightUiContext);
  const id = highlightIdFromMark(props.tnode.id);
  if (!id || !ui) return <props.TDefaultRenderer {...props} />;
  const native = getNativePropsForTNode(props);
  return <Text {...native} onPress={(event) => ui.onHighlightPress(id, event)} />;
};

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
