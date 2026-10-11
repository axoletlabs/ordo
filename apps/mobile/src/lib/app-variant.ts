import * as Application from "expo-application";
import { APP_VARIANTS, appVariantForPackage } from "./app-version";

/** Native applicationId cannot be changed by a downloaded JS update. */
export const APP_VARIANT = appVariantForPackage(Application.applicationId) ?? "development";
export const APP_IDENTITY = APP_VARIANTS[APP_VARIANT];
