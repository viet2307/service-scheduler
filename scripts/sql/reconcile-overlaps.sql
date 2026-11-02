-- Active appointments that overlap on a technician, a bay or a vehicle. The exclusion constraints
-- make this impossible, so any row means a constraint was dropped, disabled or bypassed
-- (the target is zero overlaps, so any result should page).
--
-- Run it hourly with a role that can read `appointment`, and alert when it prints a row or fails:
--   cron:  0 * * * *  psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -f scripts/sql/reconcile-overlaps.sql
--   AWS:   an EventBridge schedule that runs the same psql command as an ECS task
-- The booking concurrency suite (test/e2e/booking-concurrency.e2e-spec.ts) runs it as its final check.
--
-- Each join repeats its constraint's equality columns, range expression and status predicate, so the
-- planner can probe that constraint's GiST index instead of comparing every pair of rows.

SELECT 'technician' AS resource, a.technician_id AS resource_id, a.id AS appointment_id, b.id AS overlapping_id
FROM appointment a
JOIN appointment b
  ON b.dealership_id = a.dealership_id
 AND b.technician_id = a.technician_id
 AND tstzrange(b.start_at, b.end_at, '[)') && tstzrange(a.start_at, a.end_at, '[)')
 AND b.status <> 'CANCELLED'
 AND b.id > a.id
WHERE a.status <> 'CANCELLED'

UNION ALL

SELECT 'bay', a.bay_id, a.id, b.id
FROM appointment a
JOIN appointment b
  ON b.dealership_id = a.dealership_id
 AND b.bay_id = a.bay_id
 AND tstzrange(b.start_at, b.end_at, '[)') && tstzrange(a.start_at, a.end_at, '[)')
 AND b.status <> 'CANCELLED'
 AND b.id > a.id
WHERE a.status <> 'CANCELLED'

UNION ALL

SELECT 'vehicle', a.vehicle_id, a.id, b.id
FROM appointment a
JOIN appointment b
  ON b.vehicle_id = a.vehicle_id
 AND tstzrange(b.start_at, b.end_at, '[)') && tstzrange(a.start_at, a.end_at, '[)')
 AND b.status <> 'CANCELLED'
 AND b.id > a.id
WHERE a.status <> 'CANCELLED'

ORDER BY resource, resource_id, appointment_id;
