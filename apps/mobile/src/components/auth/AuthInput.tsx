/** All account fields are required; keep that semantic without repeating visual hints. */
import React from "react";
import type { TextInput } from "react-native";
import { Input, type InputProps } from "../ui/Input";

export const AuthInput = React.forwardRef<TextInput, InputProps>(function AuthInput(props, ref) {
  return (
    <Input
      ref={ref}
      variant="outlined"
      required
      showRequiredIndicator={false}
      reserveSupportingSpace={false}
      {...props}
    />
  );
});
