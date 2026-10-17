/** Form-wide failures belong beside the action, not on an unrelated field. */
import React from "react";
import { Animated } from "react-native";
import { Text } from "./Text";
import { spacing } from "../../theme/tokens";
import { useStateVisibility } from "./StateLayer";

export function FormError({ message }: { message?: string }) {
  return message ? <VisibleFormError message={message} /> : null;
}

function VisibleFormError({ message }: { message: string }) {
  const opacity = useStateVisibility(true, undefined, false);
  // Semantics mount immediately; only paint fades. Remove cleared errors at once
  // rather than retaining an obsolete alert during a successful submission.
  return <Animated.View testID="material-form-error" style={{ opacity, marginBottom: spacing[16] }}>
    <Text variant="bodyMedium" color="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</Text>
  </Animated.View>;
}
