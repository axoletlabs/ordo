import * as Updates from "expo-updates";
import { APP_IDENTITY, APP_VARIANT } from "./app-variant";
import { withDiagnosticOperation } from "./local-diagnostics";
import { singleFlight } from "./single-flight";

export const otaUpdatesEnabled = Updates.isEnabled && APP_VARIANT !== "development" && Updates.channel === APP_IDENTITY.channel;
export const checkOta = singleFlight(async () => {
  const result = await withDiagnosticOperation("update-check", () => Updates.checkForUpdateAsync());
  return result.isAvailable || result.isRollBackToEmbedded;
});
export const downloadOta = singleFlight(async () => {
  const result = await withDiagnosticOperation("update-download", () => Updates.fetchUpdateAsync());
  return result.isNew || result.isRollBackToEmbedded;
});
