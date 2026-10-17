/** Only the active code cell is an autofill target. PINs are not SMS codes. */
export function otpAutofillProps(purpose: "otp" | "pin", kind: "numeric" | "backup", active: boolean, locked: boolean) {
  const offerCode = purpose === "otp" && kind === "numeric" && active && !locked;
  return {
    autoComplete: offerCode ? "one-time-code" : "off",
    textContentType: offerCode ? "oneTimeCode" : "none",
    importantForAutofill: offerCode ? "yes" : "no",
    secureTextEntry: purpose === "pin" || kind === "backup",
  } as const;
}
