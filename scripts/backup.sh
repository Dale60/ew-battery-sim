#!/usr/bin/env bash
# =============================================================================
# Eden Worth battery-sim — nightly SQLite backup
# Run via cron:  0 3 * * *  /opt/battery-sim/scripts/backup.sh
# Keeps 14 daily + 8 weekly + 6 monthly rollups.
# =============================================================================
set -euo pipefail

DATA_DIR="/opt/battery-sim/data"
BACKUP_DIR="/opt/battery-sim/backups"
DB_FILE="$DATA_DIR/battery-sim.db"
DATE=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}

# Use SQLite's .backup for a consistent snapshot even during writes
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/daily/battery-sim-$DATE.db'"
gzip "$BACKUP_DIR/daily/battery-sim-$DATE.db"

# Weekly snapshot on Sundays
if [ "$(date +%u)" = "7" ]; then
  cp "$BACKUP_DIR/daily/battery-sim-$DATE.db.gz" "$BACKUP_DIR/weekly/"
fi

# Monthly snapshot on the 1st
if [ "$(date +%d)" = "01" ]; then
  cp "$BACKUP_DIR/daily/battery-sim-$DATE.db.gz" "$BACKUP_DIR/monthly/"
fi

# Rotation
find "$BACKUP_DIR/daily"   -name "*.db.gz" -mtime +14 -delete
find "$BACKUP_DIR/weekly"  -name "*.db.gz" -mtime +56 -delete
find "$BACKUP_DIR/monthly" -name "*.db.gz" -mtime +180 -delete

echo "[$(date -Is)] backup OK, size: $(du -h $BACKUP_DIR/daily/battery-sim-$DATE.db.gz | cut -f1)"
