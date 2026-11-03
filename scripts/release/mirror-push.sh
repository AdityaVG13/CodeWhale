#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: mirror-push.sh <remote> <label> <git push args...>" >&2
  exit 2
fi

remote="$1"
label="$2"
shift 2

for attempt in 1 2 3; do
  echo "Attempt ${attempt}: pushing ${label} to ${remote}"
  if git push "${remote}" "$@" 2>&1; then
    echo "Successfully pushed ${label} to ${remote}"
    exit 0
  fi
  if [ "${attempt}" -lt 3 ]; then
    sleep $((attempt * 5))
  fi
done
echo "::error::Failed to push ${label} to ${remote} after 3 attempts" >&2
exit 1
