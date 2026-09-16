/**
 * Native selection for article highlights.
 * Wrapping itself lives in @ordo/shared (TextQuoteSelector → <mark>).
 *
 * Phrases are OS text, never an editor: UITextView on iOS and selectable
 * Text (TextView) on Android. A caret is ignored; only a real range opens
 * the selection menu. Tap still opens links.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { UITextView } from "@bsky.app/react-native-uitextview";
import {
  useRendererProps,
  type CustomBlockRenderer,
  type CustomTextualRenderer,
  type TNode,
} from "@native-html/render";
import { htmlToPlainText, quoteFromBlock, quoteFromRange, type HighlightAnchor } from "@ordo/shared";
import { isMenuAnchorRect, type MenuAnchorRect } from "../../lib/menu-anchor";
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

function touchAnchor(event: GestureResponderEvent): MenuAnchorRect {
  return {
    x: event.nativeEvent.pageX - 16,
    y: event.nativeEvent.pageY - 20,
    width: 32,
    height: 28,
  };
}

function stripAnchor(x: number, y: number, width: number, height: number): MenuAnchorRect {
  const stripH = 28;
  const stripY = y + Math.min(Math.max(0, height / 2 - stripH / 2), Math.max(0, height - stripH));
  return { x, y: stripY, width: Math.max(1, width), height: stripH };
}

function webSelectionAnchor(): MenuAnchorRect | undefined {
  const selection = (
    globalThis as {
      getSelection?: () => {
        rangeCount: number;
        getRangeAt: (i: number) => {
          getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
        };
      } | null;
    }
  ).getSelection?.();
  if (!selection || selection.rangeCount === 0) return undefined;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const anchor = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  return isMenuAnchorRect(anchor) ? anchor : undefined;
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
export type HighlightSelectDraft = HighlightAnchor & {
  highlightId?: string;
  anchor?: MenuAnchorRect;
};

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
  const hostRef = useRef<View>(null);
  const lastTouch = useRef<MenuAnchorRect | null>(null);
  const text = useMemo(() => nodeTextContent(asHtmlNode(tnode)), [tnode]);
  const spans = useMemo(() => {
    if (tnode.type === "text") return selectableInline(tnode);
    return tnode.children.map((child, index) => (
      <React.Fragment key={index}>{selectableInline(child)}</React.Fragment>
    ));
  }, [tnode]);

  const recordTouch = useCallback((event: GestureResponderEvent) => {
    lastTouch.current = touchAnchor(event);
  }, []);

  const publishRange = useCallback(
    (start: number, end: number, nativeRect?: MenuAnchorRect) => {
      if (!ui) return;
      const range = selectedRange(start, end);
      if (!range) {
        ui.onTextSelect(null);
        return;
      }
      const quote =
        quoteFromBlock(ui.articlePlain, text, range.start, range.end) ??
        quoteFromRange(text, range.start, range.end);
      if (!quote) {
        ui.onTextSelect(null);
        return;
      }
      const htmlNode = asHtmlNode(tnode);
      const href = hrefCoveringRange(htmlNode, range.start, range.end);
      const highlightId = highlightIdCoveringRange(htmlNode, range.start, range.end) ?? undefined;
      const draft: HighlightSelectDraft = {
        ...quote,
        ...(href ? { href } : {}),
        ...(highlightId ? { highlightId } : {}),
      };
      const finish = (anchor?: MenuAnchorRect) => {
        ui.onTextSelect(isMenuAnchorRect(anchor) ? { ...draft, anchor } : draft);
      };
      if (isMenuAnchorRect(nativeRect)) {
        finish(nativeRect);
        return;
      }
      if (lastTouch.current) {
        finish(lastTouch.current);
        return;
      }
      const host = hostRef.current;
      if (host && typeof host.measureInWindow === "function") {
        host.measureInWindow((x, y, width, height) => {
          finish(stripAnchor(x, y, width, height));
        });
        return;
      }
      finish();
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
    if (!selected) {
      ui?.onTextSelect(null);
      return;
    }
    const start = text.indexOf(selected);
    if (start < 0) {
      const quote = quoteFromRange(selected, 0, selected.length);
      if (!quote) {
        ui?.onTextSelect(null);
        return;
      }
      ui?.onTextSelect({ ...quote, anchor: webSelectionAnchor() });
      return;
    }
    publishRange(start, start + selected.length, webSelectionAnchor());
  }, [publishRange, text, ui]);

  const phraseStyle = [styles.phrase, ui?.textStyle];
  const phrase =
    Platform.OS === "ios" ? (
      <UITextView
        selectable
        uiTextView
        accessibilityRole="text"
        style={phraseStyle}
        onSelectionChange={onIosSelectionChange}
      >
        {spans}
      </UITextView>
    ) : Platform.OS === "web" ? (
      <Text
        selectable
        accessibilityRole="text"
        selectionColor={ui?.selectionColor}
        style={phraseStyle}
        {...({ onMouseUp: onWebSelect, onKeyUp: onWebSelect } as object)}
      >
        {spans}
      </Text>
    ) : (
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

  return (
    <View
      ref={hostRef}
      collapsable={false}
      pointerEvents="box-none"
      onTouchStart={recordTouch}
      onTouchMove={recordTouch}
      onTouchEnd={recordTouch}
    >
      {phrase}
    </View>
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
