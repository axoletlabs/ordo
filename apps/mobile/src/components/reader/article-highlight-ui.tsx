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
  Dimensions,
  PixelRatio,
  Platform,
  StyleSheet,
  Text,
  View,
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
import { quoteFromBlock, quoteFromRange, type HighlightAnchor } from "@ordo/shared";
import { isMenuAnchorRect, resolveSelectionAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { useAndroidPhraseSelection } from "./android-phrase-selection";
import {
  highlightIdCoveringRange,
  hrefCoveringRange,
  isBreakTNode,
  nodeTextContent,
  tnodeContainsMedia,
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

export function asHtmlNode(node: TNode): HtmlTableNode {
  return node as unknown as HtmlTableNode;
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

type PressPoint = { x: number; y: number };
type InlinePressEvent = { nativeEvent?: { pageX?: number; pageY?: number } };

function pressPoint(event?: InlinePressEvent): PressPoint | undefined {
  const x = event?.nativeEvent?.pageX;
  const y = event?.nativeEvent?.pageY;
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

function InlineSpan({
  style,
  children,
  onPress,
}: {
  style: TextStyle;
  children: React.ReactNode;
  onPress?: (event?: InlinePressEvent) => void;
}) {
  if (Platform.OS === "ios") {
    return (
      <UITextView style={style} onPress={onPress} accessibilityRole={onPress ? "link" : undefined}>
        {children}
      </UITextView>
    );
  }
  // No explicit selectable: the selectable phrase root decides. Forcing false
  // pins user-select:none on web, which blocks styled spans from selection.
  return (
    <Text style={style} onPress={onPress} accessibilityRole={onPress ? "link" : undefined}>
      {children}
    </Text>
  );
}

interface InlineCtx {
  highlightStyle?: TextStyle;
  /** Tapping a saved highlight opens its menu; offsets map to the block text. */
  onHighlightPress?: (start: number, end: number, point?: PressPoint) => void;
}

/** Rebuild a TNode as inline spans so the OS can select inside one text view. */
function selectableInline(
  node: TNode,
  ctx: InlineCtx,
  highlighted = false,
  offset: { value: number } = { value: 0 },
): React.ReactNode {
  const marked = highlighted || node.tagName === "mark";
  if (isBreakTNode(asHtmlNode(node))) {
    offset.value += 1;
    return "\n";
  }
  if (node.type === "text") {
    const start = offset.value;
    const len = node.data?.length ?? 0;
    offset.value += len;
    if (!node.data) return null;
    // TRE collapses <mark> into a text-type node that keeps tagName/id.
    // It is one tap target for the tap-to-manage-highlight menu.
    if (marked && node.tagName === "mark" && ctx.onHighlightPress && len > 0) {
      const style = { ...pickTextStyle(node.getNativeStyles() as Record<string, unknown>), ...(ctx.highlightStyle ?? {}) };
      return (
        <InlineSpan
          style={style}
          onPress={(event) => ctx.onHighlightPress?.(start, start + len, pressPoint(event))}
        >
          {node.data}
        </InlineSpan>
      );
    }
    const style = { ...pickTextStyle(node.getNativeStyles() as Record<string, unknown>), ...(marked ? ctx.highlightStyle : {}) };
    const press = pressPropsFor(node);
    if (!press && Object.keys(style).length === 0) return node.data;
    return (
      <InlineSpan style={style} onPress={press?.onPress}>
        {node.data}
      </InlineSpan>
    );
  }
  if (node.type === "empty" || node.tagName === "img") return null;
  if (node.tagName == null) {
    return node.children.map((child, index) => (
      <React.Fragment key={index}>{selectableInline(child, ctx, marked, offset)}</React.Fragment>
    ));
  }
  const style = { ...pickTextStyle(node.getNativeStyles() as Record<string, unknown>), ...(marked ? ctx.highlightStyle : {}) };
  const press = pressPropsFor(node);
  // A mark is one tap target: inner links still win (innermost onPress).
  if (node.tagName === "mark" && ctx.onHighlightPress) {
    const start = offset.value;
    const children = node.children.map((child, index) => (
      <React.Fragment key={index}>{selectableInline(child, ctx, marked, offset)}</React.Fragment>
    ));
    const end = offset.value;
    return (
      <InlineSpan
        style={style}
        onPress={(event) => ctx.onHighlightPress?.(start, end, pressPoint(event))}
      >
        {children}
      </InlineSpan>
    );
  }
  return (
    <InlineSpan style={style} onPress={press?.onPress}>
      {node.children.map((child, index) => (
        <React.Fragment key={index}>{selectableInline(child, ctx, marked, offset)}</React.Fragment>
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
  /** The draft covers one whole saved highlight (tap, not a text selection). */
  whole?: boolean;
  anchor?: MenuAnchorRect;
};

export interface HighlightUiHandlers {
  articlePlain: string;
  selectionColor: string;
  textStyle?: StyleProp<TextStyle>;
  highlightStyle?: TextStyle;
  onTextSelect: (draft: HighlightSelectDraft | null) => void;
}

export const HighlightUiContext = createContext<HighlightUiHandlers | null>(null);

export function ignoreTextSelect(_draft: HighlightSelectDraft | null) {}

export function SelectablePhrase({
  tnode,
}: {
  tnode: TNode;
  TNodeChildrenRenderer: React.ComponentType<{ tnode: TNode }>;
}) {
  const ui = useContext(HighlightUiContext);
  const hostRef = useRef<View>(null);
  const publishSeq = useRef(0);
  const text = useMemo(() => nodeTextContent(asHtmlNode(tnode)), [tnode]);

  // Deferred anchor callbacks (measureInWindow) must never publish a stale
  // draft over a newer selection event.
  const publish = useCallback(
    (draft: HighlightSelectDraft | null) => {
      publishSeq.current += 1;
      ui?.onTextSelect(draft);
    },
    [ui],
  );

  const publishHighlightTap = useCallback(
    (start: number, end: number, point?: PressPoint) => {
      if (!ui) return;
      // An active text selection owns this gesture (select-to-extend inside a
      // highlight); only a plain tap opens the highlight menu.
      if (
        typeof globalThis.getSelection === "function" &&
        (() => {
          try {
            const selection = (
              globalThis as { getSelection?: () => { isCollapsed: boolean; rangeCount: number } | null }
            ).getSelection?.();
            return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
          } catch {
            return false;
          }
        })()
      ) {
        return;
      }
      const range = selectedRange(start, end);
      if (!range) return;
      const htmlNode = asHtmlNode(tnode);
      const highlightId = highlightIdCoveringRange(htmlNode, range.start, range.end);
      // Only saved highlights open the tap menu; plain text just selects.
      if (!highlightId) return;
      const quote =
        quoteFromBlock(ui.articlePlain, text, range.start, range.end) ??
        quoteFromRange(text, range.start, range.end);
      if (!quote) return;
      const href = hrefCoveringRange(htmlNode, range.start, range.end);
      const finish = (anchor: MenuAnchorRect) => {
        ui.onTextSelect({ ...quote, ...(href ? { href } : {}), highlightId, whole: true, anchor });
      };
      if (point) {
        const { width, height } = Dimensions.get("window");
        finish({
          x: Math.max(8, Math.min(point.x - 16, width - 40)),
          y: Math.max(8, Math.min(point.y - 16, height - 40)),
          width: 32,
          height: 32,
        });
        return;
      }
      // No press coordinates (platform-dependent): center on the block itself.
      const host = hostRef.current;
      if (host && typeof host.measureInWindow === "function") {
        host.measureInWindow((x, y, width, height) => {
          if (!isMenuAnchorRect({ x, y, width, height })) return;
          finish({ x: x + width / 2 - 16, y: y + height / 2 - 16, width: 32, height: 32 });
        });
      }
    },
    [text, tnode, ui],
  );

  const spans = useMemo(() => {
    const ctx: InlineCtx = {
      highlightStyle: ui?.highlightStyle,
      onHighlightPress: publishHighlightTap,
    };
    if (tnode.type === "text") return selectableInline(tnode, ctx);
    return tnode.children.map((child, index) => (
      <React.Fragment key={index}>{selectableInline(child, ctx, tnode.tagName === "mark")}</React.Fragment>
    ));
  }, [tnode, ui?.highlightStyle, publishHighlightTap]);

  const publishRange = useCallback(
    (start: number, end: number, nativeRect?: MenuAnchorRect) => {
      if (!ui) return;
      publishSeq.current += 1;
      const seq = publishSeq.current;
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
      const finish = (host?: MenuAnchorRect) => {
        if (seq !== publishSeq.current) return;
        const { width, height } = Dimensions.get("window");
        const anchor = resolveSelectionAnchor({
          nativeRect,
          host,
          start: range.start,
          end: range.end,
          textLength: text.length,
          viewport: { width, height },
          density: PixelRatio.get(),
        });
        ui.onTextSelect(isMenuAnchorRect(anchor) ? { ...draft, anchor } : draft);
      };
      const host = hostRef.current;
      if (host && typeof host.measureInWindow === "function") {
        host.measureInWindow((x, y, width, height) => {
          finish({ x, y, width, height });
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
      publish(null);
      return;
    }
    // Browser selections may carry a trailing newline the block text lacks.
    const trimmed = selected.replace(/\s+$/, "");
    const start = trimmed ? text.indexOf(trimmed) : -1;
    if (start < 0) {
      const quote = quoteFromRange(trimmed || selected, 0, (trimmed || selected).length);
      if (!quote) {
        publish(null);
        return;
      }
      publish({ ...quote, anchor: webSelectionAnchor() });
      return;
    }
    publishRange(start, start + trimmed.length, webSelectionAnchor());
  }, [publish, publishRange, text]);

  // A heading/code block must keep its own computed font and ink rather than
  // having the generic paragraph fallback override its semantic styles.
  const phraseStyle = [styles.phrase, ui?.textStyle, pickTextStyle(tnode.getNativeStyles() as Record<string, unknown>)];
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
    <View ref={hostRef} collapsable={false} pointerEvents="box-none">
      {phrase}
    </View>
  );
}

export const selectableBlockRenderer: CustomBlockRenderer = ({
  tnode,
  TDefaultRenderer,
  TNodeChildrenRenderer,
  ...props
}) => {
  // Images cannot live inside the selectable Text tree; keep the default
  // renderer so <p><a><img></a></p> lead media actually paints.
  if (tnodeContainsMedia(asHtmlNode(tnode))) {
    return <TDefaultRenderer tnode={tnode} TNodeChildrenRenderer={TNodeChildrenRenderer} {...props} />;
  }
  return (
    <TDefaultRenderer tnode={tnode} TNodeChildrenRenderer={TNodeChildrenRenderer} {...props}>
      <SelectablePhrase tnode={tnode} TNodeChildrenRenderer={TNodeChildrenRenderer} />
    </TDefaultRenderer>
  );
};

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
