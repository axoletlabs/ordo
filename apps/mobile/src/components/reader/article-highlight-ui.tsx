/**
 * Native selection for article highlights.
 * Wrapping itself lives in @ordo/shared (TextQuoteSelector → <mark>).
 *
 * RN Text is a UILabel on iOS, so it can only copy a whole block. Each
 * selectable phrase is therefore a real OS text view: UITextView on iOS
 * (magnifier, handles, system menu) and a non-keyboard TextInput on Android.
 * Nested HTML spans stay in that same native view: UITextView children on iOS
 * (attributed-string runs) and Text children on Android (inside the TextInput).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  type GestureResponderEvent,
  type StyleProp,
  type TextInputSelectionChangeEvent,
  type TextStyle,
} from "react-native";
import { UITextView } from "@bsky.app/react-native-uitextview";
import { NativeViewGestureHandler } from "react-native-gesture-handler";
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
import {
  highlightIdCoveringRange,
  hrefCoveringRange,
  nodeTextContent,
  type HtmlTableNode,
} from "./article-html-table";

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

/** Wait until the OS selection handles pause before updating the action bar. */
const SELECTION_SETTLE_MS = Platform.OS === "web" ? 0 : 180;
/** Finger-up and outside-tap often emit a caret (start === end) right after a real range. */
const SELECTION_COLLAPSE_HOLD_MS = 480;

function isCaretRange(start: number, end: number): boolean {
  return Math.max(start, end) <= Math.min(start, end);
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
  /** Lock article scrolling while a native selection is in progress. */
  onSelectingChange?: (active: boolean) => void;
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

  const selectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNonEmptyAt = useRef(0);
  const lastRange = useRef<{ start: number; end: number } | null>(null);
  const restoringSelection = useRef(false);
  const nativeRef = useRef<TextInput>(null);

  const emitRange = useCallback(
    (start: number, end: number) => {
      if (!ui) return;
      if (restoringSelection.current) return;
      const from = Math.min(start, end);
      const to = Math.max(start, end);

      if (isCaretRange(from, to)) {
        const last = lastRange.current;
        // Finger-up / tap often drops a caret. Keep the pending quote publish
        // and push the native range back so the OS doesn't sit in cursor mode.
        if (last && Date.now() - lastNonEmptyAt.current < SELECTION_COLLAPSE_HOLD_MS) {
          if (Platform.OS === "android") {
            restoringSelection.current = true;
            nativeRef.current?.setNativeProps({ selection: last });
            requestAnimationFrame(() => {
              restoringSelection.current = false;
            });
          }
          return;
        }
        if (selectTimer.current) {
          clearTimeout(selectTimer.current);
          selectTimer.current = null;
        }
        if (lastNonEmptyAt.current === 0) return;
        selectTimer.current = setTimeout(() => {
          selectTimer.current = null;
          lastRange.current = null;
          lastNonEmptyAt.current = 0;
          ui.onSelectingChange?.(false);
          ui.onTextSelect(null);
        }, SELECTION_SETTLE_MS);
        return;
      }

      lastRange.current = { start: from, end: to };
      lastNonEmptyAt.current = Date.now();
      ui.onSelectingChange?.(true);
      if (selectTimer.current) {
        clearTimeout(selectTimer.current);
        selectTimer.current = null;
      }
      const publish = () => {
        selectTimer.current = null;
        const quote =
          quoteFromBlock(ui.articlePlain, text, from, to) ?? quoteFromRange(text, from, to);
        if (!quote) {
          ui.onSelectingChange?.(false);
          ui.onTextSelect(null);
          return;
        }
        const htmlNode = asHtmlNode(tnode);
        const href = hrefCoveringRange(htmlNode, from, to);
        const highlightId = highlightIdCoveringRange(htmlNode, from, to) ?? undefined;
        ui.onTextSelect({
          ...quote,
          ...(href ? { href } : {}),
          ...(highlightId ? { highlightId } : {}),
        });
        // Handles have paused: let the article scroll again while the bar stays up.
        ui.onSelectingChange?.(false);
      };
      if (SELECTION_SETTLE_MS === 0) {
        publish();
        return;
      }
      selectTimer.current = setTimeout(publish, SELECTION_SETTLE_MS);
    },
    [text, tnode, ui],
  );

  useEffect(
    () => () => {
      if (selectTimer.current) clearTimeout(selectTimer.current);
    },
    [],
  );

  const onIosSelectionChange = useCallback(
    (event: { nativeEvent: { start: number; end: number } }) => {
      emitRange(event.nativeEvent.start, event.nativeEvent.end);
    },
    [emitRange],
  );

  const onAndroidSelectionChange = useCallback(
    (event: TextInputSelectionChangeEvent) => {
      const { start, end } = event.nativeEvent.selection;
      emitRange(start, end);
    },
    [emitRange],
  );

  const onWebSelect = useCallback(() => {
    const selected = webSelectedText();
    if (!selected) {
      ui?.onTextSelect(null);
      return;
    }
    const start = text.indexOf(selected);
    if (start < 0) {
      ui?.onTextSelect(quoteFromRange(selected, 0, selected.length));
      return;
    }
    emitRange(start, start + selected.length);
  }, [emitRange, text, ui]);

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
    <NativeViewGestureHandler disallowInterruption>
      <TextInput
        ref={nativeRef}
        multiline
        scrollEnabled={false}
        showSoftInputOnFocus={false}
        caretHidden
        cursorColor="transparent"
        inputMode="none"
        contextMenuHidden
        disableFullscreenUI
        importantForAutofill="noExcludeDescendants"
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        underlineColorAndroid="transparent"
        accessibilityRole="text"
        selectionColor={ui?.selectionColor}
        selectionHandleColor={ui?.selectionColor}
        onSelectionChange={onAndroidSelectionChange}
        style={phraseStyle}
      >
        {spans}
      </TextInput>
    </NativeViewGestureHandler>
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
