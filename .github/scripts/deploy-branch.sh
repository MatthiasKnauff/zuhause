#!/usr/bin/env bash
# Schreibt die fertige docker-compose.yml in den Zweig deploy-<ziel>.
# Portainer beobachtet diesen Zweig und aktualisiert den Stack von selbst.
set -euo pipefail
ZIEL="$1"
IMAGE="$2"
BRANCH="deploy-${ZIEL}"
OUT="${RUNNER_TEMP:-/tmp}/docker-compose.yml"

sed -e "s|__IMAGE__|${IMAGE}|g" -e "s|__APP_ENV__|${ZIEL}|g" deploy/compose.template.yml > "$OUT"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git fetch origin "$BRANCH"
  git checkout -f -B "$BRANCH" "origin/$BRANCH"
else
  git checkout -f --orphan "$BRANCH"
  git rm -rf --quiet . || true
  git clean -fdq
fi

cp "$OUT" docker-compose.yml
cat > README.md <<EOF
# ${BRANCH}

Automatisch erzeugt von der Pipeline – nicht von Hand ändern.
Portainer beobachtet diesen Zweig und aktualisiert den Stack, sobald sich hier etwas ändert.
Änderungen an der Compose-Datei bitte in \`main\` unter \`deploy/compose.template.yml\` vornehmen.
EOF
git add docker-compose.yml README.md
if git diff --cached --quiet; then
  echo "Keine Änderung für ${BRANCH}"
else
  git commit -q -m "${ZIEL}: ${IMAGE##*:}"
fi
git push -q origin "$BRANCH"
echo "${BRANCH} -> ${IMAGE}"
