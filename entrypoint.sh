#!/bin/sh
set -e

DB_FILE="/app/data/airsoko-pos.db"
SEED_FILE="/app/seed.db"

mkdir -p /app/data

# Fresh or empty volume: copy baked-in schema DB
if [ ! -f "$DB_FILE" ]; then
  echo "No database found — copying seed..."
  cp "$SEED_FILE" "$DB_FILE"
  echo "Database ready."
elif [ "$(stat -c%s "$DB_FILE" 2>/dev/null || echo 0)" -lt 4096 ]; then
  echo "Database is empty/corrupt — replacing with seed..."
  rm -f "$DB_FILE" "${DB_FILE}-shm" "${DB_FILE}-wal"
  cp "$SEED_FILE" "$DB_FILE"
  echo "Database replaced."
fi

chown -R nextjs:nodejs /app/data

# Apply pending Prisma migrations (non-fatal if baseline already applied)
echo "Running database migrations..."
su-exec nextjs npx prisma migrate deploy || echo "Migration warning (non-fatal)"

exec su-exec nextjs node server.js
