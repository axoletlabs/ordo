import React from "react";
import { Platform } from "react-native";

/** A real HTML form keeps password managers from grouping unrelated screens. */
export function AutofillForm({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return React.createElement("form", {
    autoComplete: "on",
    style: { display: "contents" },
    // Native/RN-web onSubmitEditing owns submission; never navigate with secrets
    // in a query string when Enter triggers the browser's default form submit.
    onSubmit: (event: React.FormEvent) => event.preventDefault(),
  }, children);
}
