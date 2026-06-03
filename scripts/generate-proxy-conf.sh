#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$ROOT_DIR/.env"}
TEMPLATE_FILE=${PROXY_TEMPLATE:-"$ROOT_DIR/patches/proxy.conf.example"}
OUTPUT_FILE=${PROXY_OUTPUT:-"$ROOT_DIR/patches/proxy.conf"}

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
[ -f "$TEMPLATE_FILE" ] || die "proxy template not found: $TEMPLATE_FILE"

SLS_ENDPOINT=$(read_env SLS_ENDPOINT)
SLS_PROJECT=$(read_env SLS_PROJECT)
SLS_ACCESS_KEY_ID=$(read_env SLS_ACCESS_KEY_ID)
SLS_ACCESS_KEY_SECRET=$(read_env SLS_ACCESS_KEY_SECRET)

[ -n "$SLS_ENDPOINT" ] || die "SLS_ENDPOINT is empty in .env"
[ -n "$SLS_PROJECT" ] || die "SLS_PROJECT is empty in .env"
[ -n "$SLS_ACCESS_KEY_ID" ] || die "SLS_ACCESS_KEY_ID is empty in .env"
[ -n "$SLS_ACCESS_KEY_SECRET" ] || die "SLS_ACCESS_KEY_SECRET is empty in .env"

case "$SLS_ENDPOINT" in
  *[!A-Za-z0-9.-]* | *..* | .* | *.) die "SLS_ENDPOINT looks invalid: $SLS_ENDPOINT" ;;
esac

case "$SLS_PROJECT" in
  *[!A-Za-z0-9._-]* | "" ) die "SLS_PROJECT contains unsupported characters: $SLS_PROJECT" ;;
esac

BASIC_AUTH=$(printf '%s' "$SLS_ACCESS_KEY_ID:$SLS_ACCESS_KEY_SECRET" | base64 | tr -d '\n')

umask 077
awk \
  -v project="$SLS_PROJECT" \
  -v endpoint="$SLS_ENDPOINT" \
  -v basic_auth="$BASIC_AUTH" '
    function repl_escape(value) {
      gsub(/\\/, "\\\\", value)
      gsub(/&/, "\\\\&", value)
      return value
    }
    BEGIN {
      project_repl = repl_escape(project)
      endpoint_repl = repl_escape(endpoint)
      basic_auth_repl = repl_escape(basic_auth)
    }
    {
      gsub(/your-sls-project/, project_repl)
      gsub(/your-region\.log\.aliyuncs\.com/, endpoint_repl)
      gsub(/BASE64_ACCESS_KEY_ID_COLON_ACCESS_KEY_SECRET/, basic_auth_repl)
      print
    }
  ' "$TEMPLATE_FILE" > "$OUTPUT_FILE"

chmod 600 "$OUTPUT_FILE"

printf 'Generated %s from %s\n' "$OUTPUT_FILE" "$ENV_FILE"
