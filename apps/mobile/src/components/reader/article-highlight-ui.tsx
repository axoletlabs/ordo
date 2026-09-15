/**
 * Native selection for article highlights.
 * Wrapping itself lives in @ordo/shared (TextQuoteSelector → <mark>).
 *
 * RN Text is a UILabel on iOS, so it can only copy a whole block. Each
 * selectable phrase is therefore a real OS text view: UITextView on iOS
 * (magnifier, handles, system menu) and a non-keyboard TextInput on Android.
 * Nested HTML spans are rebuilt as UITextView/Text children so bold, links,
 * and marks stay in the attributed string the OS is selecting.
 */
import React, { createContext, useCallback, useContext, useMemo } from "react";
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

function dummyPressEvent(): GestureResponderEvent {
  return { nativeEvent: { pageX: 0, pageY: 0 } } as GestureResponderEvent;
}

function pressPropsFor(node: TNode, ui: HighlightUiHandlers | null) {
  if (node.tagName === "a") {
    const href = node.attributes.href ?? "";
    if (!isExternalHref(href)) return undefined;
    return {
      onPress: () => {
        Linking.openURL(href).catch(() => {});
      },
    };
  }
  const id = highlightIdFromMark(node.id);
  if (id && ui) {
    return {
      onPress: (event?: GestureResponderEvent) =>
        ui.onHighlightPress(
          id,
          event && Number.isFinite(event.nativeEvent?.pageX) ? event : dummyPressEvent(),
        ),
    };
  }
  return undefined;
}

/** Rebuild a TNode as UITextView/Text spans so iOS can select inside the OS text view. */
function selectableInline(node: TNode, ui: HighlightUiHandlers | null): React.ReactNode {
  if (node.type === "text") {
    if (!node.data) return null;
    const style = pickTextStyle(node.getNativeStyles() as Record<string, unknown>);
    const press = pressPropsFor(node, ui);
    if (!press && Object.keys(style).length === 0) return node.data;
    return (
      <UITextView style={style} {...press}>
        {node.data}
      </UITextView>
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
    <UITextView style={style} {...press}>
      {node.children.map((child, index) => (
        <React.Fragment key={index}>{selectableInline(child, ui)}</React.Fragment>
      ))}
    </UITextView>
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

function asHtmlNode(node: TNode): HtmlTableNode {
  return node as unknown as HtmlTableNode;
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
    if (tnode.type === "text") return selectableInline(tnode, ui);
    return tnode.children.map((child, index) => (
      <React.Fragment key={index}>{selectableInline(child, ui)}</React.Fragment>
    ));
  }, [tnode, ui]);

  const emitRange = useCallback(
    (start: number, end: number) => {
      if (!ui) return;
      if (end <= start) {
        ui.onTextSelect(null);
        return;
      }
      const quote =
        quoteFromBlock(ui.articlePlain, text, start, end) ?? quoteFromRange(text, start, end);
      if (!quote) {
        ui.onTextSelect(null);
        return;
      }
      const htmlNode = asHtmlNode(tnode);
      const href = hrefCoveringRange(htmlNode, start, end);
      const highlightId = highlightIdCoveringRange(htmlNode, start, end) ?? undefined;
      ui.onTextSelect({
        ...quote,
        ...(href ? { href } : {}),
        ...(highlightId ? { highlightId } : {}),
      });
    },
    [text, tnode, ui],
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
        selectionColor={ui?.selectionColor}
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
    <TextInput
      multiline
      scrollEnabled={false}
      showSoftInputOnFocus={false}
      inputMode="none"
      contextMenuHidden={false}
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
      cursorColor={ui?.selectionColor}
      onSelectionChange={onAndroidSelectionChange}
      style={phraseStyle}
    >
      {spans}
    </TextInput>
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
