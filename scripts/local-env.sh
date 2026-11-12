#!/usr/bin/env bash
# Local environment helpers behind the Makefile's database and local-* targets.
#
# Every checkout shares one Postgres container (zt-decoder-ring-db on localhost:5439). Each
# keeps its own database in it, named by DEV_DB_NAME, so one checkout's migrations, seed and
# app never read or write another's data.
#
#   up       start the shared database container, or reuse it whichever worktree started it
#   down     stop and remove the shared container; the data volume is kept
#   adopt    hand the container to this worktree's Compose project (the container targets need it
#            on their own network); the data is untouched, since every worktree uses one volume
#   ensure   create DEV_DB_NAME in the shared container if it is missing
#   reset    drop and recreate DEV_DB_NAME only; other databases in the container are untouched
#   wipe     remove the container and the shared volume, every checkout's local data with it
#   guard    refuse a DATABASE_URL that points at the shared container but names another database
#   status   list this repository's local servers, containers, databases and worktrees
#   stop     stop the dev servers and app containers started from this repository's worktrees
set -euo pipefail

DB_CONTAINER=zt-decoder-ring-db
# docker-compose.yml names the volume explicitly, so every worktree uses the same
# data no matter which one starts the container.
DB_VOLUME=zt-decoder-ring-dev-postgres
DEV_DB_PORT=5439
APP_CONTAINERS="zt-decoder-ring-app zt-decoder-ring-app-debug"
# The port bands the Makefile families use: dev (3000-3019) and production-like containers
# (13000-13019). Anything listening outside them is not ours to report or stop.
BAND_SPEC="-iTCP:3000-3019 -iTCP:13000-13019"

ROOT=$(git rev-parse --show-toplevel)
COMMON=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)

die() { echo "❌ $*" >&2; exit 1; }

need_db_name() {
  [[ "${DEV_DB_NAME:-}" =~ ^[a-z_][a-z0-9_]*$ ]] ||
    die "DEV_DB_NAME must be a plain lower-case identifier (got '${DEV_DB_NAME:-}')."
}

# What the app and Prisma will connect to: the environment first, then app/.env. The file is
# read the way dotenv reads it: an optional `export`, spaces around `=`, CRLF line endings, a
# quoted value, or an unquoted one ending at a ` #` comment.
effective_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    echo "$DATABASE_URL"
  elif [ -f "$ROOT/app/.env" ]; then
    local value
    value=$(tr -d '\r' <"$ROOT/app/.env" |
      sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?DATABASE_URL[[:space:]]*=[[:space:]]*//p' | tail -1)
    case "$value" in
      \"*) value=${value#\"}; value=${value%%\"*} ;;
      \'*) value=${value#\'}; value=${value%%\'*} ;;
      *) value=${value%%[[:space:]]#*}; value=${value%"${value##*[![:space:]]}"} ;;
    esac
    echo "$value"
  fi
}

# True when a directory belongs to this repository (any of its worktrees).
in_repo() {
  local dir=$1 common
  [ -d "$dir" ] || return 1
  common=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [ "$common" = "$COMMON" ]
}

db_running() { [ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null)" = true ]; }

# Stop Postgres with SIGTERM (docker stop) so it shuts down cleanly, then remove the container.
# Other worktrees share it, so a running container gets a warning first.
remove_db_container() {
  if db_running; then
    echo "⚠️  Stopping $DB_CONTAINER, which every worktree shares; connections to it from other worktrees close."
    docker stop "$DB_CONTAINER" >/dev/null
  fi
  docker rm "$DB_CONTAINER" >/dev/null
}
db_exists() { docker inspect "$DB_CONTAINER" >/dev/null 2>&1; }
db_owner() { docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$DB_CONTAINER" 2>/dev/null; }

# The volume and image docker-compose.yml expects. A container created before the shared
# volume, or before an image digest bump, keeps its own until it is recreated.
note_stale_container() {
  local volume image want
  volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$DB_CONTAINER" 2>/dev/null)
  if [ -n "$volume" ] && [ "$volume" != "$DB_VOLUME" ]; then
    echo "ℹ️  $DB_CONTAINER keeps its data in volume $volume, not the shared $DB_VOLUME. 'make db-down && make db-up' recreates it on the shared volume, which starts empty ('make db-ready' seeds it); $volume stays until removed by hand."
  fi
  image=$(docker inspect -f '{{.Config.Image}}' "$DB_CONTAINER" 2>/dev/null)
  want=$(cd "$ROOT" && docker compose --profile db-only config --images 2>/dev/null | grep '^postgres' | head -1)
  if [ -n "$want" ] && [ -n "$image" ] && [ "$image" != "$want" ]; then
    echo "ℹ️  $DB_CONTAINER runs $image; docker-compose.yml names $want. 'make db-down && make db-up' recreates it on that image; the data is kept."
  fi
}

cmd_up() {
  if db_exists; then note_stale_container; fi
  if db_running; then
    [ "$(db_owner)" = "$ROOT" ] || echo "ℹ️  Using the running $DB_CONTAINER (started from $(db_owner))."
  elif db_exists; then
    docker start "$DB_CONTAINER" >/dev/null
  else
    (cd "$ROOT" && docker compose --profile db-only up -d)
  fi
  cmd_ensure
}

cmd_down() {
  if db_exists; then
    remove_db_container
    echo "✅ Stopped $DB_CONTAINER; the data in volume $DB_VOLUME is kept."
  else
    echo "ℹ️  $DB_CONTAINER is not running."
  fi
}

cmd_adopt() {
  db_exists || return 0
  [ "$(db_owner)" = "$ROOT" ] && return 0
  local c dir
  for c in $APP_CONTAINERS; do
    [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || continue
    dir=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c")
    [ "$dir" = "$ROOT" ] && continue
    die "$c, started from $dir, is using $DB_CONTAINER; recreating it here would cut that app off its database. Run 'make local-stop' in $dir first. Nothing was changed."
  done
  echo "ℹ️  $DB_CONTAINER was started from $(db_owner); recreating it from this worktree. The data in volume $DB_VOLUME is unchanged."
  remove_db_container
}

cmd_reset() {
  need_db_name
  cmd_up >/dev/null
  docker exec "$DB_CONTAINER" dropdb -U ztdecoder --if-exists --force "$DEV_DB_NAME"
  docker exec "$DB_CONTAINER" createdb -U ztdecoder "$DEV_DB_NAME"
  echo "♻️  Recreated database $DEV_DB_NAME (empty); other databases in $DB_CONTAINER are untouched."
}

cmd_wipe() {
  cmd_down >/dev/null
  if docker volume inspect "$DB_VOLUME" >/dev/null 2>&1; then
    docker volume rm "$DB_VOLUME" >/dev/null
    echo "✅ Removed $DB_CONTAINER and volume $DB_VOLUME: every checkout's local database is gone."
  else
    echo "ℹ️  Volume $DB_VOLUME does not exist."
  fi
}

# Wait for Postgres to accept connections, for up to a minute. -h forces a TCP probe: without
# it pg_isready checks the Unix socket, which the temporary server Postgres runs during its
# first-boot initdb already answers, so the wait would end before the database is usable.
wait_ready() {
  local tries=0
  until docker exec "$DB_CONTAINER" pg_isready -h 127.0.0.1 -U ztdecoder >/dev/null 2>&1; do
    db_running || die "$DB_CONTAINER is not running; 'docker logs $DB_CONTAINER' says why."
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || die "$DB_CONTAINER did not accept connections within 60 seconds; 'docker logs $DB_CONTAINER' says why."
    sleep 1
  done
}

cmd_ensure() {
  need_db_name
  wait_ready
  if docker exec "$DB_CONTAINER" psql -U ztdecoder -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$DEV_DB_NAME'" | grep -q 1; then
    return 0
  fi
  docker exec "$DB_CONTAINER" createdb -U ztdecoder "$DEV_DB_NAME"
  echo "✅ Created database $DEV_DB_NAME in $DB_CONTAINER"
}

cmd_guard() {
  need_db_name
  local url rest hostport host port db
  url=$(effective_url)
  if [ -z "$url" ]; then
    echo "ℹ️  No DATABASE_URL in the environment or app/.env, so there is nothing to check; Prisma and the app need one." >&2
    return 0
  fi
  rest=${url#*://}
  rest=${rest##*@}
  hostport=${rest%%/*}
  db=${rest#*/}
  db=${db%%\?*}
  host=${hostport%:*}
  port=${hostport##*:}
  [ "$host" = "$hostport" ] && port=5432
  case "$host" in localhost | 127.0.0.1 | ::1 | "[::1]") ;; *) return 0 ;; esac
  [ "$port" = "$DEV_DB_PORT" ] || return 0
  [ "$db" = "$DEV_DB_NAME" ] && return 0
  die "DATABASE_URL names database '$db' on the shared dev container (localhost:$DEV_DB_PORT), but this checkout's database is '$DEV_DB_NAME'. Point DATABASE_URL in app/.env at postgresql://ztdecoder:<password>@localhost:$DEV_DB_PORT/$DEV_DB_NAME. Nothing was run."
}

# Lines of "port pid": every listener in the bands. On Ubuntu under WSL2, lsof has been
# seen to miss the Next.js dev server's listener while ss lists it, so where ss exists
# its listeners are added to lsof's.
band_listeners() {
  if ! command -v lsof >/dev/null 2>&1 && ! command -v ss >/dev/null 2>&1; then
    echo "ℹ️  Neither lsof nor ss is installed; listeners not checked." >&2
    return 0
  fi
  {
    if command -v lsof >/dev/null 2>&1; then
      # shellcheck disable=SC2086
      # lsof exits 1 when it finds nothing; under pipefail that would end the group here.
      lsof -nP $BAND_SPEC -sTCP:LISTEN 2>/dev/null |
        awk 'NR>1 { n=$(NF-1); sub(/.*:/, "", n); print n, $2 }' || true
    fi
    if command -v ss >/dev/null 2>&1; then
      # The same bands as BAND_SPEC. ss names a process only when it may see it.
      ss -ltnpH 2>/dev/null | awk -v spec="$BAND_SPEC" '
        BEGIN { k = split(spec, s, " "); for (i = 1; i <= k; i++) { r = s[i]; sub(/^-iTCP:/, "", r); split(r, b, "-"); lo[i] = b[1]; hi[i] = b[2] } }
        { n = $4; sub(/.*:/, "", n); n += 0
          for (i = 1; i <= k; i++) if (n >= lo[i] && n <= hi[i]) {
            # Every process holding the socket, not only the first.
            rest = $0
            while (match(rest, /pid=[0-9]+/)) { print n, substr(rest, RSTART + 4, RLENGTH - 4); rest = substr(rest, RSTART + RLENGTH) }
            break } }' || true
    fi
  } | sort -k1,1n -k2,2n -u
}

# The container publishing a host port, as "name dir", when it is one of this repository's
# compose containers. Docker's own process holds those listeners, so the process's working
# directory says nothing about which worktree the container came from.
port_container() {
  command -v docker >/dev/null 2>&1 || return 0
  docker ps --filter name=zt-decoder-ring --format '{{.Names}}\t{{.Ports}}\t{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null |
    awk -F'\t' -v p=":$1->" 'index($2, p) { print $1, $3; exit }'
}

# Both answer empty, never fail, for a process that has already exited.
# Where lsof does not see a process, Linux's /proc still gives its working directory.
pid_cwd() {
  local d
  d=$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)
  [ -n "$d" ] || d=$(readlink "/proc/$1/cwd" 2>/dev/null || true)
  printf '%s\n' "$d"
}
pid_cmd() { ps -o command= -p "$1" 2>/dev/null | cut -c1-60 || true; }
pid_parent() { ps -o ppid= -p "$1" 2>/dev/null | tr -d ' ' || true; }

cmd_status() {
  echo "Local environment for $ROOT"
  echo
  echo "Servers in the dev (3000-3019) and container (13000-13019) bands:"
  local found=0 port pid cwd shown=" "
  while read -r port pid; do
    [ -n "$port" ] || continue
    found=1
    local ctr cname cdir
    ctr=$(port_container "$port")
    if [ -n "$ctr" ]; then
      # Docker can hold one published port in two processes, one for IPv4 and one for IPv6,
      # so a container is listed once per port rather than once per process.
      case "$shown" in *" $port "*) continue ;; esac
      shown="$shown$port "
      cname=${ctr%% *}
      cdir=${ctr#* }
      if in_repo "$cdir"; then
        printf '  :%-6s container %-23s this repository: %s\n' "$port" "$cname" "$cdir"
      else
        printf '  :%-6s container %-23s not this repository\n' "$port" "$cname"
      fi
      continue
    fi
    cwd=$(pid_cwd "$pid")
    if in_repo "$cwd"; then
      printf '  :%-6s pid %-7s %-28s this repository: %s\n' "$port" "$pid" "$(pid_cmd "$pid" | cut -c1-28)" "$cwd"
    else
      printf '  :%-6s pid %-7s %-28s not this repository\n' "$port" "$pid" "$(pid_cmd "$pid" | cut -c1-28)"
    fi
  done < <(band_listeners)
  [ "$found" = 1 ] || echo "  (none)"
  echo
  echo "Containers:"
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker ps -a --filter name=zt-decoder-ring --format '{{.Names}}  {{.Status}}  (started from {{.Label "com.docker.compose.project.working_dir"}})' |
      sed 's/^/  /' | grep . || echo "  (none)"
    if db_running; then
      echo
      echo "Databases in $DB_CONTAINER:"
      docker exec "$DB_CONTAINER" psql -U ztdecoder -d postgres -tAc \
        "SELECT datname || '  ' || pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY 1" |
        while read -r line; do
          if [ "${line%% *}" = "${DEV_DB_NAME:-}" ]; then echo "  $line  ← this checkout"; else echo "  $line"; fi
        done
    fi
  else
    echo "  (docker not running)"
  fi
  echo
  echo "Worktrees:"
  git -C "$ROOT" worktree list --porcelain | awk '/^worktree /{w=$2} /^branch /{b=$2; sub("refs/heads/","",b); print w, b} /^detached/{print w, "(detached)"}' |
    while read -r wt br; do
      local note="" dirty track
      dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
      [ "$dirty" != 0 ] && note="$note, $dirty uncommitted"
      track=$(git -C "$ROOT" for-each-ref --format='%(upstream:track)' "refs/heads/$br" 2>/dev/null)
      [ "$track" = "[gone]" ] && note="$note, remote branch deleted (merged or abandoned)"
      echo "  $wt  $br${note}"
    done
}

cmd_stop() {
  local stopped=0 port pid cwd p cmd c dir parent
  while read -r port pid; do
    [ -n "$port" ] || continue
    cwd=$(pid_cwd "$pid")
    in_repo "$cwd" || continue
    # Stop the listener and the yarn/next launchers above it, so nothing respawns it.
    p=$pid
    for _ in 1 2 3; do
      cmd=$(pid_cmd "$p")
      case "$cmd" in *next* | *yarn* | *node*) ;; *) break ;; esac
      in_repo "$(pid_cwd "$p")" || break
      parent=$(pid_parent "$p")
      kill "$p" 2>/dev/null || true
      p=$parent
      [ -n "$p" ] && [ "$p" != 1 ] || break
    done
    # Give it five seconds to exit before saying it stopped.
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    if kill -0 "$pid" 2>/dev/null; then
      echo "⚠️  The server on :$port (pid $pid, $cwd) is still running; 'kill -9 $pid' ends it."
    else
      echo "🛑 Stopped the server on :$port (pid $pid, $cwd)"
      stopped=1
    fi
  done < <(band_listeners)
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    for c in $APP_CONTAINERS; do
      [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || continue
      dir=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c")
      in_repo "$dir" || continue
      docker stop "$c" >/dev/null && echo "🛑 Stopped container $c ($dir)" && stopped=1
    done
  fi
  [ "$stopped" = 1 ] || echo "Nothing of this repository's was running in the port bands."
  db_running && echo "ℹ️  $DB_CONTAINER is still running; 'make db-down' stops it (data is kept)."
  return 0
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  adopt) cmd_adopt ;;
  ensure) cmd_ensure ;;
  reset) cmd_reset ;;
  wipe) cmd_wipe ;;
  guard) cmd_guard ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  *) die "usage: $0 up|down|adopt|ensure|reset|wipe|guard|status|stop" ;;
esac
