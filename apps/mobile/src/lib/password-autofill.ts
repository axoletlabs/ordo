/**
 * Password managers treat every password field on the page as one set.
 * When an MFA/OTP field is focused, Autofill will happily write the new
 * password into the current-password box too. While a step-up prompt is
 * open, drop those fields out of the password graph and keep the values
 * the user already submitted.
 */
import type { TextInputProps } from "react-native";

export type PasswordAutofillRole = "current-password" | "new-password" | "password";

type AutofillProps = Pick<
  TextInputProps,
  "autoComplete" | "textContentType" | "importantForAutofill" | "editable"
>;

export function passwordAutofillProps(
  role: PasswordAutofillRole,
  locked = false,
): AutofillProps {
  if (locked) {
    return {
      autoComplete: "off",
      textContentType: "none",
      importantForAutofill: "no",
      editable: false,
    };
  }
  if (role === "new-password") {
    return {
      autoComplete: "new-password",
      textContentType: "newPassword",
      importantForAutofill: "yes",
    };
  }
  if (role === "current-password") {
    return {
      autoComplete: "current-password",
      textContentType: "password",
      importantForAutofill: "yes",
    };
  }
  return {
    autoComplete: "password",
    textContentType: "password",
    importantForAutofill: "yes",
  };
}

/**
 * Locked secrets must not stay `type=password`, or Autofill still owns them.
 * Render discs instead of the real value so a translucent overlay can't leak it.
 */
export function lockedSecretDisplay(
  value: string,
  locked: boolean,
  reveal: boolean,
): { value: string; secureTextEntry: boolean } {
  if (locked) {
    return { value: value ? "•".repeat(value.length) : "", secureTextEntry: false };
  }
  return { value, secureTextEntry: !reveal };
}
