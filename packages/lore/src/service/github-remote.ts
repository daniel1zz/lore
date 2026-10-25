/**
 * Parsing a git `origin` URL into a GitHub repository, and the same-repository decision.
 *
 * Purpose: decide whether the reporting project IS the upstream repository (spec
 * spec-defect-reports-carry-their-own-context-a-checked-repro D8): only then may a test file's header be
 * published to the upstream's public issue.
 *
 * Public surface: `parseGithubRemote`, `isSameGithubRepository`.
 * Invariants: the host must be exactly `github.com` (a same-named repo on another host is a DIFFERENT
 * repository); owner/name compare case-insensitively; anything unparsable or absent is "different".
 * Side-effect class: pure.
 */

/** A parsed GitHub repository identity. */
export interface GithubRemote {
  readonly owner: string;
  readonly name: string;
}

const SSH_FORM = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;
const HTTPS_FORM = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

/**
 * @param url - a git remote URL (`git@github.com:o/n(.git)` or `https://github.com/o/n(.git)`)
 * @returns owner/name, or `undefined` for any other host or shape
 */
export function parseGithubRemote(url: string): GithubRemote | undefined {
  const trimmed = url.trim();
  const match = SSH_FORM.exec(trimmed) ?? HTTPS_FORM.exec(trimmed);
  if (match === null) return undefined;
  return { owner: match[1]!, name: match[2]! };
}

/**
 * @param originUrl - the reporting project's `origin` URL, or `undefined` when it has none
 * @param upstreamRepo - the upstream `owner/name` the report is filed to
 * @returns `true` iff `originUrl` is a github.com URL naming the same owner/name (case-insensitive)
 */
export function isSameGithubRepository(originUrl: string | undefined, upstreamRepo: string): boolean {
  if (originUrl === undefined) return false;
  const remote = parseGithubRemote(originUrl);
  if (remote === undefined) return false;
  return `${remote.owner}/${remote.name}`.toLowerCase() === upstreamRepo.trim().toLowerCase();
}
