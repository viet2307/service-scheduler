#!/usr/bin/env bash
# Fires N bookings for the same slot at once, each for its own vehicle, then checks with
# scripts/sql/reconcile-overlaps.sql that no technician, bay or vehicle ended up double-booked.
#
# Needs the API with the demo seed (`docker compose --profile demo up -d`), curl, jq, and psql or
# Docker Compose to reach the database.
#
#   scripts/race.sh [N]    default 20
#
#   BASE_URL      default http://localhost:3000
#   DATABASE_URL  default postgres://scheduler:scheduler@localhost:5432/scheduler (the compose database)
#   RACE_DATE     default: the next day Saigon is open
#   RACE_TIME     local start time, default 14:00
#
# The confirmed bookings are cancelled at the end, so the race can run again on the same slot.
set -euo pipefail

N=${1:-20}
BASE_URL=${BASE_URL:-http://localhost:3000}
DATABASE_URL=${DATABASE_URL:-postgres://scheduler:scheduler@localhost:5432/scheduler}
ZONE=Asia/Ho_Chi_Minh
DEALERSHIP=01a16194-0000-7000-8000-000000000001 # Saigon: three general technicians, two lift bays
OIL_SERVICE=01a16194-0000-7000-8000-0000000000a2
SAM=01a16194-0000-7000-8000-0000000000c2
RACE_DATE=${RACE_DATE:-$(TZ=$ZONE jq -rn 'now + 86400 | if (strflocaltime("%u") == "7") then . + 86400 else . end | strflocaltime("%Y-%m-%d")')}
RACE_TIME=${RACE_TIME:-14:00}
START="${RACE_DATE}T${RACE_TIME}:00+07:00"
RUN=$(date +%s)
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

(( N >= 1 && N <= 500 )) || { echo "N must be between 1 and 500" >&2; exit 1; }

sql() {
  if command -v psql >/dev/null; then
    psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"
  else
    docker compose exec -T postgres psql -U scheduler -d scheduler -X -q -v ON_ERROR_STOP=1 "$@"
  fi
}

vehicle_id() { printf '01a16194-0000-7000-8000-%012x' $((0xa000 + $1)); }

curl -fsS "$BASE_URL/health/ready" >/dev/null || {
  echo "The API is not ready at $BASE_URL. Start it with: docker compose --profile demo up -d" >&2
  exit 1
}

# Vehicles are master data from another system and have no API, so the race's vehicles go in directly.
sql -v n="$N" -v customer="$SAM" <<'SQL'
INSERT INTO vehicle (id, vin, customer_id, make, model, model_year)
SELECT format('01a16194-0000-7000-8000-%s', lpad(to_hex(40960 + i), 12, '0'))::uuid,
       'WVWZZZ1KZRC' || lpad(i::text, 6, '0'), :'customer', 'Volkswagen', 'Polo', 2024
FROM generate_series(1, :n) AS i
ON CONFLICT (id) DO NOTHING;
SQL

slot=$(curl -fsS "$BASE_URL/v1/dealerships/$DEALERSHIP/availability?serviceTypeId=$OIL_SERVICE&date=$RACE_DATE" |
  TZ=$ZONE jq -c --arg time "$RACE_TIME" \
    '.slots[] | select(.startAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601 | strflocaltime("%H:%M") == $time)')
if [[ -n $slot ]]; then
  jq -r '"Availability says \(.freeTechnicians) technicians and \(.freeBays) lift bays are free, so at most \([.freeTechnicians, .freeBays] | min) bookings can succeed."' <<<"$slot"
else
  echo "Availability lists no free start at $RACE_TIME on $RACE_DATE, so every booking should be refused."
fi

printf 'Sending %d oil-service bookings for %s at %s (Saigon), each for a different vehicle...\n' "$N" "$RACE_DATE" "$RACE_TIME"
for i in $(seq 1 "$N"); do
  body=$(jq -n --arg dealership "$DEALERSHIP" --arg customer "$SAM" --arg vehicle "$(vehicle_id "$i")" \
    --arg service "$OIL_SERVICE" --arg start "$START" \
    '{dealershipId: $dealership, customerId: $customer, vehicleId: $vehicle, serviceTypeId: $service, startAt: $start}')
  curl -s -o "$tmp/$i.json" -w '%{http_code}' -X POST "$BASE_URL/v1/appointments" \
    -H 'Content-Type: application/json' -H "Idempotency-Key: race-$RUN-$i" -d "$body" >"$tmp/$i.status" &
done
wait

echo
echo 'Responses:'
for i in $(seq 1 "$N"); do
  printf '%s %s\n' "$(cat "$tmp/$i.status")" "$(jq -r '.code // ""' "$tmp/$i.json" 2>/dev/null)"
done | sort | uniq -c | awk '{ printf "  %3d × %s %s\n", $1, $2, $3 }'

confirmed=()
for i in $(seq 1 "$N"); do
  if [[ $(cat "$tmp/$i.status") == 201 ]]; then
    jq -r '"  confirmed: \(.technician.displayName) in \(.bay.name)"' "$tmp/$i.json"
    confirmed+=("$(jq -r .id "$tmp/$i.json")")
  fi
done

echo
overlaps=$(sql -A -t -f "$here/sql/reconcile-overlaps.sql")
if [[ -z $overlaps ]]; then
  echo 'reconcile-overlaps.sql: 0 overlapping appointments on any technician, bay or vehicle.'
else
  echo 'reconcile-overlaps.sql found overlapping appointments:'
  echo "$overlaps"
  exit 1
fi

for id in "${confirmed[@]}"; do
  curl -s -o /dev/null -X POST "$BASE_URL/v1/appointments/$id/cancel"
done
printf 'Cancelled the %d confirmed bookings, so the race can run again.\n' "${#confirmed[@]}"
