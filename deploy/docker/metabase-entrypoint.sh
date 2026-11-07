#!/bin/bash
# The H2 app database keeps a Liquibase lock if the JVM dies mid-migration
# (1 GB heap + CrashOnOutOfMemoryError, or a restart during the first boot).
# Docker then restarts into the same lock and /api/health stays 503.
# This volume has a single container, and the previous process has already exited.
set -euo pipefail

release_lock() {
  local db_file="$1"
  if ! ls "${db_file}".* >/dev/null 2>&1; then
    return 0
  fi
  echo "Releasing leftover Metabase migration lock on ${db_file}"
  MB_DB_TYPE=h2 MB_DB_FILE="${db_file}" \
    /opt/java/openjdk/bin/java \
    --add-opens java.base/java.nio=ALL-UNNAMED \
    -jar /app/metabase.jar migrate release-locks \
    || echo "release-locks failed; starting Metabase anyway"
}

release_lock /metabase-data/metabase.db/metabase.db
release_lock /metabase-data/metabase.db

exec /app/run_metabase.sh
