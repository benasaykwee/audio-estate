#!/usr/bin/env bash
# ci_verdict.sh — what CI actually said, from the API rather than a web page.
#
# WHY THIS EXISTS. On 2026-08-23 a session read github.com while logged out
# and was served a CACHED workflow listing that showed run #8 as the newest
# when #24 had already finished and spoken. The same afternoon, a short SHA
# would not resolve to a checks page at all. Both failures look exactly like
# a green run to anyone in a hurry, and one of them nearly closed a fault on
# the strength of a stale page.
#
# `gh` talks to the authenticated API. It cannot be served yesterday's
# answer, it takes the SHA you actually have, and it prints per-job status
# rather than a summary glyph.
#
# Usage:
#   bash tools/ci_verdict.sh              the newest CASKET run
#   bash tools/ci_verdict.sh HEAD         the run for your current commit
#   bash tools/ci_verdict.sh 47540cf      the run for a specific commit
#   bash tools/ci_verdict.sh --watch      block until the newest run finishes
#
# Requires the GitHub CLI, authenticated once with `gh auth login`.
set -uo pipefail

REPO="benasaykwee/audio-estate"
WORKFLOW="casket.yml"
WATCH=0
REF=""

for a in "$@"; do
  case "$a" in
    --watch) WATCH=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) REF="$a" ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is not installed. brew install gh, then: gh auth login" >&2
  exit 127
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "gh is installed but not authenticated. Run: gh auth login" >&2
  exit 127
fi

# A SHORT SHA IS NOT AN ARGUMENT. The web UI refused one on 2026-08-23 and
# the API is no kinder, so expand it locally before asking anyone anything.
if [ -n "$REF" ]; then
  FULL=$(git rev-parse "$REF" 2>/dev/null) || {
    echo "not a commit this repository knows: $REF" >&2; exit 2; }
  RUN=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --limit 40 \
        --json databaseId,headSha,displayTitle,status,conclusion \
        --jq "[.[] | select(.headSha == \"$FULL\")] | first")
  if [ -z "$RUN" ] || [ "$RUN" = "null" ]; then
    echo "no $WORKFLOW run found for ${FULL:0:9} — has it been pushed?" >&2
    exit 3
  fi
else
  RUN=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --limit 1 \
        --json databaseId,headSha,displayTitle,status,conclusion --jq '.[0]')
fi

ID=$(printf '%s' "$RUN"    | python3 -c 'import json,sys; print(json.load(sys.stdin)["databaseId"])')
SHA=$(printf '%s' "$RUN"   | python3 -c 'import json,sys; print(json.load(sys.stdin)["headSha"])')
TITLE=$(printf '%s' "$RUN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["displayTitle"])')

if [ "$WATCH" = "1" ]; then
  gh run watch "$ID" --repo "$REPO" --exit-status >/dev/null 2>&1
fi

echo "CASKET run $ID — ${SHA:0:9}"
echo "  $TITLE"
echo

gh run view "$ID" --repo "$REPO" --json jobs \
  --jq '.jobs[] | "  \(.conclusion // .status)\t\(.name)"' \
  | sed -e 's/^  success/  PASS   /' \
        -e 's/^  failure/  FAIL   /' \
        -e 's/^  skipped/  skip   /' \
        -e 's/^  cancelled/  CANX   /' \
        -e 's/^  in_progress/  ...    /' \
        -e 's/^  queued/  ...    /'

echo
# THE VERDICT IS COMPUTED FROM THE JOBS, not from the run's own summary
# field, because a run whose last job is still queued reports no conclusion
# at all and reading that as "fine" is the whole failure mode above.
FAILED=$(gh run view "$ID" --repo "$REPO" --json jobs \
         --jq '[.jobs[] | select(.conclusion == "failure" or .conclusion == "cancelled")] | length')
RUNNING=$(gh run view "$ID" --repo "$REPO" --json jobs \
          --jq '[.jobs[] | select(.status != "completed")] | length')

if [ "${FAILED:-0}" -gt 0 ]; then
  echo "VERDICT: $FAILED job(s) red. Logs:"
  echo "  gh run view $ID --repo $REPO --log-failed"
  exit 1
elif [ "${RUNNING:-0}" -gt 0 ]; then
  echo "VERDICT: still running ($RUNNING job(s) outstanding). Nothing to conclude yet."
  echo "  bash tools/ci_verdict.sh --watch"
  exit 2
else
  echo "VERDICT: every job green. The box holds."
  exit 0
fi
