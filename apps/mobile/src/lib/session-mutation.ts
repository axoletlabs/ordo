import type { DefaultError, MutationFunctionContext, UseMutationOptions } from "@tanstack/react-query";
import { assertSessionScope, captureSessionScope, isSessionScopeCurrent, type SessionScope } from "./session-scope";

/** Each TanStack execution has its own context, including concurrently queued writes.
 * A late result/rollback must never publish into another account's shared cache. */
export function sessionMutationOptions<TData = unknown, TError = DefaultError, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationOptions<TData, TError, TVariables, TContext> {
  const owners = new WeakMap<MutationFunctionContext, SessionScope>();
  const owner = (context: MutationFunctionContext) => {
    let scope = owners.get(context);
    if (!scope) { scope = captureSessionScope(); owners.set(context, scope); }
    return scope;
  };
  return {
    ...options,
    onMutate: (variables, context) => {
      owner(context);
      return options.onMutate?.(variables, context) as TContext | Promise<TContext>;
    },
    mutationFn: options.mutationFn ? async (variables, context) => {
      const scope = owner(context);
      assertSessionScope(scope);
      const data = await options.mutationFn!(variables, context);
      // Reject mutateAsync too: caller-side continuations must not treat an
      // outgoing account's successful write as belonging to the new session.
      assertSessionScope(scope);
      return data;
    } : undefined,
    onSuccess: (data, variables, result, context) => {
      if (isSessionScopeCurrent(owner(context))) return options.onSuccess?.(data, variables, result, context);
    },
    onError: (error, variables, result, context) => {
      if (isSessionScopeCurrent(owner(context))) return options.onError?.(error, variables, result, context);
    },
    onSettled: (data, error, variables, result, context) => {
      if (isSessionScopeCurrent(owner(context))) return options.onSettled?.(data, error, variables, result, context);
    },
  };
}
