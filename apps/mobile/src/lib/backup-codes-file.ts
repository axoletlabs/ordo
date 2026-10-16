import { APP_NAME } from "@ordo/shared";
import { downloadExportFile } from "./import-export-file";

const FILENAME = "ordo-backup-codes.txt";

export function formatBackupCodesFile(codes: string[]): string {
  return [
    `${APP_NAME} backup codes`,
    "Each code signs you in once. Keep this file somewhere safe.",
    "",
    ...codes,
    "",
  ].join("\n");
}

export async function downloadBackupCodes(codes: string[]): Promise<void> {
  await downloadExportFile(formatBackupCodesFile(codes), FILENAME, "text/plain");
}
