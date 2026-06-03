#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$ROOT_DIR/.env"

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

read_env() {
  awk -v key="$1" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (line !~ "^" key "[[:space:]]*=") {
        next
      }
      sub(/^[^=]*=/, "", line)
      sub(/^[[:space:]]+/, "", line)
      sub(/[[:space:]]+$/, "", line)
      if ((line ~ /^".*"$/) || (line ~ /^'\''.*'\''$/)) {
        line = substr(line, 2, length(line) - 2)
      }
      print line
      exit
    }
  ' "$ENV_FILE"
}

[ -f "$ENV_FILE" ] || die ".env not found. Run: cp .env.example .env"

for key in ES_PASSWORD SLS_ENDPOINT SLS_PROJECT SLS_ACCESS_KEY_ID SLS_ACCESS_KEY_SECRET; do
  value=$(read_env "$key")
  [ -n "$value" ] || die "$key is empty in .env"
done

mkdir -p "$ROOT_DIR/data"
chmod 777 "$ROOT_DIR/data"

cd "$ROOT_DIR"

docker compose config >/dev/null
docker compose up -d

printf 'Waiting for Kibana to become ready'
ready=0
for _ in $(seq 1 90); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:5601/ 2>/dev/null || true)
  if [ "$code" = "200" ] || [ "$code" = "302" ]; then
    ready=1
    break
  fi
  printf '.'
  sleep 2
done
printf '\n'

if [ "$ready" -eq 1 ]; then
  printf 'Kibana is ready: http://127.0.0.1:5601\n'
  docker compose ps
  exit 0
fi

printf 'Kibana is not ready yet. Recent logs:\n' >&2
docker compose ps >&2
printf '\n--- kproxy logs ---\n' >&2
docker compose logs --no-color --tail=80 kproxy >&2
printf '\n--- kibana logs ---\n' >&2
docker compose logs --no-color --tail=80 kibana >&2
exit 1
