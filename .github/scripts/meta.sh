#!/usr/bin/env bash
# Bestimmt Ziel (test/prod), Image-Tag und Versionsnummer.
set -euo pipefail
git fetch --tags --force >/dev/null 2>&1 || true

if [ "${GITHUB_EVENT_NAME}" = "release" ]; then
  ZIEL=prod
  TAG="${GITHUB_REF_NAME}"
  VERSION="${GITHUB_REF_NAME}"
  KANAL=latest
else
  ZIEL=test
  LAST=$(git tag -l 'v*' --sort=-v:refname | head -n1)
  if [ -z "$LAST" ]; then
    NEXT=v0.1.0
  else
    IFS=. read -r MA MI PA <<< "${LAST#v}"
    MI=${MI:-0}; PA=${PA:-0}; PA=${PA%%[!0-9]*}
    NEXT="v${MA}.${MI}.$((PA + 1))"
  fi
  TAG="test-${GITHUB_SHA::7}"
  VERSION="$NEXT"
  KANAL=test
fi

{
  echo "ziel=$ZIEL"
  echo "tag=$TAG"
  echo "version=$VERSION"
  echo "kanal=$KANAL"
} >> "$GITHUB_OUTPUT"
echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
echo "Ziel: $ZIEL  Version: $VERSION  Tag: $TAG"
