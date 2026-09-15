/**
 * Native long-press hooks for article highlights.
 * Wrapping itself lives in @ordo/shared (TextQuoteSelector → <mark>).
 *
 * RN Text can copy, but it never reports a selection range to JS. A long-press
 * on a sentence (via onTextLayout) is the reliable native stand-in; links use
 * the same gesture on the anchor renderer.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  Text,
  type GestureResponderEvent,
} from "react-native";
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
  quoteFromCaret,
  quoteFromRange,
  type HighlightAnchor,
} from "@ordo/shared";
import { nodeTextContent, offsetFromLayout, type HtmlTableNode, type TextLayoutLine } from "./article-html-table";

function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href) || /^mailto:/i.test(href);
}

export interface HighlightUiHandlers {
  articlePlain: string;
  selectionColor: string;
  onTextSelect: (draft: HighlightAnchor | null) => void;
  onHighlightPress: (id: string, event: GestureResponderEvent) => void;
  onLinkLongPress: (draft: HighlightAnchor & { href: string }, event: GestureResponderEvent) => void;
}

export const HighlightUiContext = createContext<HighlightUiHandlers | null>(null);

export function ignoreTextSelect(_draft: HighlightAnchor | null) {}
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
  TNodeChildrenRenderer,
}: {
  tnode: TNode;
  TNodeChildrenRenderer: React.ComponentType<{ tnode: TNode }>;
}) {
  const ui = useContext(HighlightUiContext);
  const text = useMemo(() => nodeTextContent(asHtmlNode(tnode)), [tnode]);
  const [lines, setLines] = useState<TextLayoutLine[]>([]);
  const onTextLayout = useCallback((event: { nativeEvent: { lines: TextLayoutLine[] } }) => {
    setLines(event.nativeEvent.lines);
  }, []);
  const onLongPress = useCallback(
    (event: GestureResponderEvent) => {
      if (!ui) return;
      const { locationX, locationY } = event.nativeEvent;
      const index = offsetFromLayout(lines, locationX, locationY);
      ui.onTextSelect(quoteFromCaret(ui.articlePlain, text, index) ?? quoteFromRange(text, 0, text.length));
    },
    [lines, text, ui],
  );

  return (
    <Text onTextLayout={onTextLayout} onLongPress={onLongPress}>
      <TNodeChildrenRenderer tnode={tnode} />
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
  const ui = useContext(HighlightUiContext);
  const { onPress } = useRendererProps("a");
  const href = props.tnode.attributes.href ?? "";
  const text = nodeTextContent(asHtmlNode(props.tnode));
  const onLongPress = (event: GestureResponderEvent) => {
    if (!ui || !href) return;
    const parent = props.tnode.parent ? nodeTextContent(asHtmlNode(props.tnode.parent)) : text;
    const start = Math.max(0, parent.indexOf(text));
    const quote =
      quoteFromBlock(ui.articlePlain, parent, start, start + text.length) ??
      quoteFromRange(text, 0, text.length);
    if (!quote) return;
    ui.onLinkLongPress({ ...quote, href }, event);
  };
  return (
    <props.TDefaultRenderer
      {...props}
      onPress={(event) => {
        if (isExternalHref(href)) onPress?.(event, href, props.tnode.attributes, "_self");
      }}
      nativeProps={
        {
          ...props.nativeProps,
          onLongPress,
          delayLongPress: 350,
        } as typeof props.nativeProps
      }
    />
  );
};
