export interface LicenseNotice {
  title: string;
  text: string;
}
export interface OpenSourceLicense {
  id: string;
  name: string;
  version: string;
  license: string;
  kind: "package" | "asset" | "app";
  notices: LicenseNotice[];
}
interface LicenseCatalog {
  ordo: OpenSourceLicense;
  entries: OpenSourceLicense[];
}

/** Load the bundled texts only when a license screen is opened. */
export function getLicenseCatalog(): LicenseCatalog {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Defer parsing the bundled notices until this screen opens.
  return require("../generated/open-source-licenses.json") as LicenseCatalog;
}
