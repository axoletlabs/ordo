/** Form-wide failures belong beside the action, not on an unrelated field. */
import React from "react";
import { View } from "react-native";
import { Text } from "./Text";
import { spacing } from "../../theme/tokens";
import { AnimatedDisclosure } from "./AnimatedDisclosure";

export function FormError({ message }: { message?: string }) {
  return <AnimatedDisclosure expanded={!!message}>
    <View testID="material-form-error" style={{ paddingBottom: spacing[16] }}>
      <Text variant="bodyMedium" color="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</Text>
    </View>
  </AnimatedDisclosure>;
}
