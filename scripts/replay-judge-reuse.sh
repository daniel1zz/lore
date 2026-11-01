#!/usr/bin/env bash
# AC-JR-5 replay (BR-1535): cold and warm milestone reviews of one plan with the REAL judge, for `lore verify` to judge.
#
# Usage: scripts/replay-judge-reuse.sh <plan-slug> <cold-diff-file> <warm-diff-file>
#   plan-slug       plan-an-agent-s-gate-acceptance-waits-for-a-human-decision (issues #558 #560 #564)
#   cold-diff-file  the plan's net diff (`git diff <base> <landing-head>` over its landings)
#   warm-diff-file  the same diff with ONLY the assess.ts hunk changed (the source of claimedSource)
#
# Cold: an empty judge_verdicts store (a throwaway corpus copy), every unit is asked; the review's `judgment.units` are all `fresh`.
# Warm: the cold verdicts are in the store; only assess.ts changed, so gate-acceptance-service.ts's verdict is `reused` and the
#   review must STILL report the cross-file flow from assess.ts claimedSource to gate-acceptance-service humanPartyOf.
# The script prints each review's rows and units; it grades nothing (the grader is `lore verify`).
set -euo pipefail
plan="${1:?plan slug}"
cold="${2:?cold diff file}"
warm="${3:?warm diff file}"

echo "== cold replay: $plan with $cold"
lore assess "$plan" --diff-file "$cold" --json | tee /dev/stderr >/dev/null
echo "== warm replay: $plan with $warm"
lore assess "$plan" --diff-file "$warm" --json | tee /dev/stderr >/dev/null
echo "== units per review (fresh/reused, source review): lore get <review-slug> --json | jq '.extra.milestone_review.judgment.units'"
