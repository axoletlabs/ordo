import React from "react";
import { useWindowDimensions } from "react-native";
import { ContextMenu, type ContextMenuProps } from "./ContextMenu";
import { FloatingPanel } from "./FloatingPanel";
import { PanelHeader } from "./PanelHeader";
import { PanelActions } from "./SheetActionRow";

/** Keep desktop anchors and phone sheet ownership in one picker surface. */
export function ResponsivePicker({ title, ...props }: ContextMenuProps & { title: string }) {
  const { width } = useWindowDimensions();
  if (width >= 600) return <ContextMenu {...props} />;
  return <FloatingPanel visible={props.visible} onDismiss={props.onDismiss}
    onExited={props.onExited} onExiting={props.onExiting} triggerRef={props.returnFocusRef}
    presentation="bottom-sheet" scrollBody={false} dismissible={props.dismissible}
    keyboardDismiss={props.keyboardDismiss}>
    <PanelHeader title={title} />
    {props.children}
    <PanelActions confirmLabel="Done" onConfirm={props.onDismiss} />
  </FloatingPanel>;
}
