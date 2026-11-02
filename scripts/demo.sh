#!/usr/bin/env bash
# Walks through the booking API on the demo data, one step at a time: search, book, replay,
# key reuse, a full slot with alternatives, cancel and re-book.
#
# Needs the API with the demo seed (`docker compose --profile demo up -d`, or `npm run db:seed`
# and `npm run start:dev`), curl and jq.
#
#   scripts/demo.sh [YYYY-MM-DD]    the day to book; default: the next day Saigon is open
#
#   BASE_URL       default http://localhost:3000
#   DEMO_NO_PAUSE  set to run straight through instead of waiting for Enter between steps
#
# Every run uses fresh Idempotency-Keys and cancels what it booked at the end, so it can run again.
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000}
ZONE=Asia/Ho_Chi_Minh
DEALERSHIP=01a16194-0000-7000-8000-000000000001 # Saigon: two lift bays for oil services
OIL_SERVICE=01a16194-0000-7000-8000-0000000000a2
NGOC_ANH=01a16194-0000-7000-8000-0000000000c1 # owns the ID.3 and the Golf
SAM=01a16194-0000-7000-8000-0000000000c2      # owns the Passat
ID3=01a16194-0000-7000-8000-0000000000e1
GOLF=01a16194-0000-7000-8000-0000000000e2
PASSAT=01a16194-0000-7000-8000-0000000000e3

# Saigon is closed on Sundays.
next_open_day() {
  TZ=$ZONE jq -rn 'now + 86400 | if (strflocaltime("%u") == "7") then . + 86400 else . end | strflocaltime("%Y-%m-%d")'
}

DATE=${1:-$(next_open_day)}
START="${DATE}T10:00:00+07:00"
RUN=$(date +%s)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

bold=$'\033[1m' red=$'\033[31m' dim=$'\033[2m' reset=$'\033[0m'

step() { printf '\n%s%s%s\n' "$bold" "$*" "$reset"; }
pause() { [[ -n ${DEMO_NO_PAUSE:-} ]] || read -rp $'\n'"${dim}Enter for the next step${reset} " _; }

# call METHOD PATH [BODY] [KEY]: prints the request and the status code; the response stays in $tmp.
call() {
  local method=$1 path=$2 body=${3:-} key=${4:-}
  local args=(-s -X "$method" -D "$tmp/headers" -o "$tmp/body" -w '%{http_code}')
  [[ -n $body ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  [[ -n $key ]] && args+=(-H "Idempotency-Key: $key")
  printf '%s%s %s%s%s\n' "$dim" "$method" "$path" "${key:+   Idempotency-Key: $key}" "$reset"
  STATUS=$(curl "${args[@]}" "$BASE_URL$path")
}

# expect CODE: prints the status, flagged when it is not the one the narration expects.
expect() {
  if [[ $STATUS == "$1" ]]; then
    printf '→ %s\n' "$STATUS"
  else
    printf '→ %s%s (expected %s)%s\n' "$red" "$STATUS" "$1" "$reset"
  fi
}

header() { grep -i "^$1:" "$tmp/headers" | cut -d' ' -f2- | tr -d '\r'; }

# Prints fields of the response; `local` turns a UTC time into the dealership's wall clock.
show() {
  TZ=$ZONE jq -r 'def local: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601 | strflocaltime("%H:%M");'"$1" "$tmp/body"
}

APPOINTMENT='"  id \(.id)\n  \(.status): \(.vehicle.vin) with \(.technician.displayName) in \(.bay.name), \(.startAt | local) to \(.endAt | local)"'

booking() {
  jq -n --arg customer "$1" --arg vehicle "$2" --arg start "$3" --arg dealership "$DEALERSHIP" --arg service "$OIL_SERVICE" \
    '{dealershipId: $dealership, customerId: $customer, vehicleId: $vehicle, serviceTypeId: $service, startAt: $start}'
}

curl -fsS "$BASE_URL/health/ready" >/dev/null || {
  echo "The API is not ready at $BASE_URL. Start it with: docker compose --profile demo up -d" >&2
  exit 1
}
printf 'Booking an oil service in Saigon (%s) on %s at 10:00 local time.\n' "$ZONE" "$DATE"

step '1. Service types: duration, required skill and required bay type'
call GET /v1/service-types
expect 200
show '.[] | "  \(.code): \(.durationMinutes) min, skill \(.requiredSkill), bay \(.requiredBayType)"'
pause

step "2. Availability for an oil service on $DATE"
call GET "/v1/dealerships/$DEALERSHIP/availability?serviceTypeId=$OIL_SERVICE&date=$DATE"
expect 200
show 'if (.slots | length) == 0 then "  no bookable start times" else
  "  \(.slots | length) bookable start times, \(.slots[0].startAt | local) to \(.slots[-1].startAt | local)",
  (.slots[] | select(.startAt | local == "10:00") | "  10:00: \(.freeTechnicians) technicians and \(.freeBays) lift bays free")
end'
pause

step '3. Book the ID.3 at 10:00: the service picks the technician and the bay'
call POST /v1/appointments "$(booking "$NGOC_ANH" "$ID3" "$START")" "demo-$RUN-id3"
expect 201
printf '  Location: %s\n' "$(header Location)"
show "$APPOINTMENT"
FIRST=$(show .id)
pause

step '4. The client timed out and retries with the same key'
call POST /v1/appointments "$(booking "$NGOC_ANH" "$ID3" "$START")" "demo-$RUN-id3"
expect 200
printf '  Idempotent-Replayed: %s\n' "$(header Idempotent-Replayed)"
show '"  the same appointment: \(.id)"'
pause

step '5. The same key with a different request (11:00 instead of 10:00)'
call POST /v1/appointments "$(booking "$NGOC_ANH" "$ID3" "${DATE}T11:00:00+07:00")" "demo-$RUN-id3"
expect 422
show '"  \(.code): \(.detail)"'
pause

step '6. Book the Golf at the same time'
call POST /v1/appointments "$(booking "$NGOC_ANH" "$GOLF" "$START")" "demo-$RUN-golf"
expect 201
show "$APPOINTMENT"
SECOND=$(show .id)
pause

step "7. Book Sam's Passat at the same time: both lift bays are taken"
call POST /v1/appointments "$(booking "$SAM" "$PASSAT" "$START")" "demo-$RUN-passat"
expect 409
show '"  \(.code): \(.detail)", "  alternatives (local): \([.alternatives[] | local] | join(", "))"'
pause

step "8. Cancel the ID.3's appointment, then cancel it again as a retry would"
call POST "/v1/appointments/$FIRST/cancel"
expect 200
show '"  \(.status) at \(.cancelledAt | local)"'
call POST "/v1/appointments/$FIRST/cancel"
expect 200
show '"  still \(.status), cancelled at \(.cancelledAt | local)"'
pause

step '9. Book the Passat at 10:00 again: the freed bay and technician take it'
call POST /v1/appointments "$(booking "$SAM" "$PASSAT" "$START")" "demo-$RUN-passat-2"
expect 201
show "$APPOINTMENT"
THIRD=$(show .id)

for id in "$SECOND" "$THIRD"; do
  curl -s -o /dev/null -X POST "$BASE_URL/v1/appointments/$id/cancel"
done
printf '\n%sCancelled the bookings this run made, so the demo can run again.%s\n' "$dim" "$reset"
