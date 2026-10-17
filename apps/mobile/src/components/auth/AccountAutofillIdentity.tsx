import React from "react";
import { Input } from "../ui/Input";
import { useAuthStore } from "../../store/auth";
import { usernameAutofillProps } from "../../lib/password-autofill";

/** Give reauthentication the existing account identity, never a replacement email. */
export function AccountAutofillIdentity({ nativeID, locked = false }: { nativeID: string; locked?: boolean }) {
  const email = useAuthStore((state) => state.user?.email ?? "");
  if (!email) return null;
  return <Input nativeID={nativeID} label="Current email" value={email} readOnly
    keyboardType="email-address" {...usernameAutofillProps(locked)} />;
}
