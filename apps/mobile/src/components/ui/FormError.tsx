/** Form-wide failures belong beside the action, not on an unrelated field. */
import React from "react";
import { Text } from "./Text";
import { spacing } from "../../theme/tokens";

export function FormError({ message }: { message?: string }) {
  return message ? <Text variant="bodyMedium" color="danger" accessibilityRole="alert"
    accessibilityLiveRegion="polite" style={{ marginBottom: spacing[16] }}>{message}</Text> : null;
}
