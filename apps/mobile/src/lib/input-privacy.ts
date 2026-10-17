import type { TextInputProps } from "react-native";

/** Password identity must survive the user's reveal/hide toggle. */
export function isSensitiveInput(props: Pick<TextInputProps, "secureTextEntry" | "autoComplete" | "textContentType"> & { sensitive?: boolean }): boolean {
  return !!props.sensitive || !!props.secureTextEntry ||
    props.autoComplete === "current-password" || props.autoComplete === "new-password" ||
    props.textContentType === "password" || props.textContentType === "newPassword";
}

export function privateKeyboardType(
  platform: string,
  sensitive: boolean,
  secureTextEntry: boolean | undefined,
  keyboardType: TextInputProps["keyboardType"],
): TextInputProps["keyboardType"] {
  // Plain text on Android allows keyboard learning and loses password-manager
  // classification. The visible-password variation preserves both on reveal.
  if (platform === "android" && sensitive && !secureTextEntry) return "visible-password";
  if (platform !== "ios" && keyboardType === "url") return "default";
  return keyboardType;
}
