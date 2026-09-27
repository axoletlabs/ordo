/**
 * Published GitHub releases, kept as notes even when an APK is not attached yet.
 */
import { changelogFromGithubPayload, type ChangelogRelease, type GithubReleaseNote } from "./changelog";

const GITHUB_REPO_API = "https://api.github.com/repos/axoletlabs/ordo";
const GITHUB_HEADERS = { Accept: "application/vnd.github+json" };

export class ChangelogFetchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`GitHub returned ${status}`);
    this.name = "ChangelogFetchError";
    this.status = status;
  }
}

export async function fetchChangelogReleases(signal?: AbortSignal): Promise<ChangelogRelease[]> {
  const [listResponse, latestResponse] = await Promise.all([
    fetch(`${GITHUB_REPO_API}/releases?per_page=100`, { headers: GITHUB_HEADERS, signal }),
    fetch(`${GITHUB_REPO_API}/releases/latest`, { headers: GITHUB_HEADERS, signal }),
  ]);
  if (!listResponse.ok) throw new ChangelogFetchError(listResponse.status);
  const listed = (await listResponse.json()) as unknown;
  if (!Array.isArray(listed)) throw new ChangelogFetchError(listResponse.status);

  const merged: GithubReleaseNote[] = [...(listed as GithubReleaseNote[])];
  if (latestResponse.ok) {
    const latest = (await latestResponse.json()) as GithubReleaseNote;
    merged.push(latest);
  } else if (latestResponse.status !== 404) {
    throw new ChangelogFetchError(latestResponse.status);
  }
  return changelogFromGithubPayload(merged);
}
