/**
 * Keep credential roles consistent across native and web. While a step-up
 * prompt or another route is open, drop the background fields out of the
 * password graph and keep the values the user already submitted.
 */
import type { TextInputProps } from "react-native";

export type PasswordAutofillRole = "current-password" | "new-password";

type AutofillProps = Pick<
  TextInputProps,
  "autoComplete" | "textContentType" | "importantForAutofill" | "editable"
> & { sensitive?: boolean };

/** Local folder secrets must never offer/overwrite the account's saved login. */
export const localPasswordAutofillProps = {
  sensitive: true,
  autoComplete: "off",
  textContentType: "none",
  importantForAutofill: "no",
} as const;

/** An email used to sign in is a username, not a contact-address field. */
export function usernameAutofillProps(locked = false): AutofillProps {
  return locked ? disabledAutofillProps : {
    autoComplete: "username",
    textContentType: "username",
    importantForAutofill: "yes",
  };
}

const disabledAutofillProps = {
  autoComplete: "off",
  textContentType: "none",
  importantForAutofill: "no",
  editable: false,
} as const;

export function passwordAutofillProps(
  role: PasswordAutofillRole,
  locked = false,
): AutofillProps {
  if (locked) {
    return disabledAutofillProps;
  }
  if (role === "new-password") {
    return {
      sensitive: true,
      autoComplete: "new-password",
      textContentType: "newPassword",
      importantForAutofill: "yes",
    };
  }
  return {
    sensitive: true,
    autoComplete: "current-password",
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
