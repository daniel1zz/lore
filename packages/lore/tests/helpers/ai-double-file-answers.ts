/**
 * Shell fragment for the e2e AI doubles (claude-cli provider commands): since BR-1535 a milestone-review call must answer, per
 * changed file the prompt's `# Units` list marks ASK, a `security` and a `concurrency_safety` verdict in `files`. A double that
 * answers only the plan-level dimensions is rejected by the judge's answer check on every retry, the review errors, and the plan
 * close or migration it runs never archives the plan.
 *
 * Usage inside a `#!/bin/sh` double that holds the prompt in `$prompt`: emit {@link fileAnswerShellLines} first, then print the
 * answer with {@link withFilesShell}.
 */

const PASS = `{"verdict":"pass","reason":"no finding in this file","reference":"Google engineering code review guide","cites":[]}`;

/** Shell lines that set `$files` to the JSON entries (comma separated) of every `- file <path>: ASK` line in `$prompt`. */
export function fileAnswerShellLines(): string[] {
  return [
    `files=$(printf '%s\\n' "$prompt" | sed -n -E 's/^- file ([^ ]+): ASK.*$/{"path":"\\1","security":${PASS},"concurrency_safety":${PASS}}/p' | paste -s -d, -)`,
  ];
}

/**
 * Shell lines that print `answerJson` (a JSON object) with `"files":[$files]` added as its last member.
 *
 * @param answerJson a complete JSON object ending in `}`
 */
export function withFilesShell(answerJson: string): string[] {
  const open = answerJson.slice(0, -1);
  return [`printf '%s\\n' '${open},"files":['"$files"']}'`];
}
