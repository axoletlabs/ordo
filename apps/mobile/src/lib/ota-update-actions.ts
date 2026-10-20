import * as Updates from "expo-updates";
import { APP_IDENTITY, APP_VARIANT } from "./app-variant";
import { singleFlight } from "./single-flight";

export const otaUpdatesEnabled = Updates.isEnabled && APP_VARIANT !== "development" && Updates.channel === APP_IDENTITY.channel;
export const checkOta = singleFlight(async () => {
  const result = await Updates.checkForUpdateAsync();
  return result.isAvailable || result.isRollBackToEmbedded;
});
export const downloadOta = singleFlight(async () => {
  const result = await Updates.fetchUpdateAsync();
  return result.isNew || result.isRollBackToEmbedded;
});
