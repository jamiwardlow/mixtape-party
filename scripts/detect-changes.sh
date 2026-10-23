#!/usr/bin/env bash
# Cloud Build helper: touches .skip-api / .skip-web in the cwd when that service's code is
# unchanged since the commit currently deployed, so later steps can skip it. Any doubt
# (no .git, deployed tag isn't a commit we have, gcloud error) leaves the service un-skipped.
# Needs REGION. The deployed commit is read from the Cloud Run image tag ($COMMIT_SHA).
set -u
git config --global --add safe.directory "$PWD"

check() { # <service> <dir>
  local svc=$1 dir=$2 image sha
  image=$(gcloud run services describe "mixtape-party-$svc" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].image)') || return 0
  sha=${image##*:}
  git cat-file -e "$sha^{commit}" 2>/dev/null || return 0
  # cloudbuild.yaml and this script are part of both services' build.
  if git diff --quiet "$sha" HEAD -- "$dir" cloudbuild.yaml scripts/detect-changes.sh; then
    echo "$svc: unchanged since $sha, skipping"
    touch ".skip-$svc"
  else
    echo "$svc: changed since $sha"
  fi
}

check api api
check web mobile
