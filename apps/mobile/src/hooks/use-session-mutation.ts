import { useMutation, type DefaultError, type UseMutationOptions } from "@tanstack/react-query";
import { sessionMutationOptions } from "../lib/session-mutation";

export function useSessionMutation<TData = unknown, TError = DefaultError, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
) {
  return useMutation(sessionMutationOptions(options));
}
