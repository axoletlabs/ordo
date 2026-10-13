/** Wait for both sources; never confuse a disabled source with a successful check. */
export async function checkAppUpdateSources(ota: () => Promise<boolean>, native: () => Promise<unknown>): Promise<boolean> {
  const results = await Promise.allSettled([Promise.resolve().then(ota), Promise.resolve().then(native)]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return results.some((result) => result.status === "fulfilled" && !!result.value);
}
