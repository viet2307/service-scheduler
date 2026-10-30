-- Demo data for local runs and the documented curl examples. Not a migration: never run it against production.
-- Ids are fixed so the examples in docs/SYSTEM_DESIGN.md §7 and requests.http work as written.
-- Re-runnable: every insert names its ON CONFLICT target (AGENTS.md rule 1).

INSERT INTO skill (code, description) VALUES
  ('GENERAL',   'General servicing'),
  ('EV_HV',     'High-voltage EV work'),
  ('ALIGNMENT', 'Wheel alignment')
ON CONFLICT (code) DO NOTHING;

INSERT INTO bay_type (code, description) VALUES
  ('LIFT',      'Two-post lift'),
  ('EV_HV',     'Insulated high-voltage bay'),
  ('ALIGNMENT', 'Alignment rig')
ON CONFLICT (code) DO NOTHING;

INSERT INTO service_type (id, code, name, duration_minutes, required_skill, required_bay_type) VALUES
  ('01a16194-0000-7000-8000-0000000000a1', 'EV_BATTERY_CHECK', 'EV battery health check', 90, 'EV_HV',     'EV_HV'),
  ('01a16194-0000-7000-8000-0000000000a2', 'OIL_SERVICE',      'Oil service',             60, 'GENERAL',   'LIFT'),
  ('01a16194-0000-7000-8000-0000000000a3', 'WHEEL_ALIGNMENT',  'Wheel alignment',         45, 'ALIGNMENT', 'ALIGNMENT')
ON CONFLICT (id) DO NOTHING;

INSERT INTO dealership (id, name, timezone) VALUES
  ('01a16194-0000-7000-8000-000000000001', 'Saigon Central Service Centre',   'Asia/Ho_Chi_Minh'),
  ('01a16194-0000-7000-8000-000000000002', 'London Riverside Service Centre', 'Europe/London')
ON CONFLICT (id) DO NOTHING;

-- Local wall-clock times in each dealership's zone; a weekday without a row is closed.
INSERT INTO dealership_opening_hours (dealership_id, iso_weekday, opens_at, closes_at) VALUES
  ('01a16194-0000-7000-8000-000000000001', 1, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000001', 2, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000001', 3, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000001', 4, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000001', 5, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000001', 6, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000002', 1, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000002', 2, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000002', 3, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000002', 4, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000002', 5, '08:00', '17:30'),
  ('01a16194-0000-7000-8000-000000000002', 6, '09:00', '13:00')
ON CONFLICT (dealership_id, iso_weekday) DO NOTHING;

-- Linh Tran is the only EV technician in Saigon and also holds the general skills, so the
-- assignment policy should keep Linh free for EV work and give oil services to the generalists.
INSERT INTO technician (id, dealership_id, display_name, is_active) VALUES
  ('01a16194-0000-7000-8000-0000000000f1', '01a16194-0000-7000-8000-000000000001', 'Linh Tran',      true),
  ('01a16194-0000-7000-8000-0000000000f2', '01a16194-0000-7000-8000-000000000001', 'Minh Nguyen',    true),
  ('01a16194-0000-7000-8000-0000000000f3', '01a16194-0000-7000-8000-000000000001', 'An Pham',        true),
  ('01a16194-0000-7000-8000-0000000000f4', '01a16194-0000-7000-8000-000000000001', 'Bao Vo',         false),
  ('01a16194-0000-7000-8000-0000000000f5', '01a16194-0000-7000-8000-000000000002', 'Oliver Bennett', true),
  ('01a16194-0000-7000-8000-0000000000f6', '01a16194-0000-7000-8000-000000000002', 'Amelia Clarke',  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO technician_skill (technician_id, skill_code) VALUES
  ('01a16194-0000-7000-8000-0000000000f1', 'EV_HV'),
  ('01a16194-0000-7000-8000-0000000000f1', 'GENERAL'),
  ('01a16194-0000-7000-8000-0000000000f1', 'ALIGNMENT'),
  ('01a16194-0000-7000-8000-0000000000f2', 'GENERAL'),
  ('01a16194-0000-7000-8000-0000000000f3', 'GENERAL'),
  ('01a16194-0000-7000-8000-0000000000f3', 'ALIGNMENT'),
  ('01a16194-0000-7000-8000-0000000000f4', 'GENERAL'),
  ('01a16194-0000-7000-8000-0000000000f5', 'EV_HV'),
  ('01a16194-0000-7000-8000-0000000000f5', 'GENERAL'),
  ('01a16194-0000-7000-8000-0000000000f6', 'GENERAL')
ON CONFLICT (technician_id, skill_code) DO NOTHING;

-- Shifts are absolute timestamps (A4), so every run generates them for the next 30 local days in
-- each dealership's zone; days seeded by an earlier run hit the overlap constraint and are skipped.
-- Minh Nguyen's morning and afternoon shifts touch, so they form one free block. Bao Vo is inactive.
INSERT INTO technician_shift (technician_id, start_at, end_at)
SELECT r.technician_id, (day + r.starts) AT TIME ZONE d.timezone, (day + r.ends) AT TIME ZONE d.timezone
FROM (VALUES
  ('01a16194-0000-7000-8000-0000000000f1'::uuid, 1, 5, time '08:00', time '17:30'),
  ('01a16194-0000-7000-8000-0000000000f2'::uuid, 1, 6, time '08:00', time '12:00'),
  ('01a16194-0000-7000-8000-0000000000f2'::uuid, 1, 6, time '12:00', time '17:30'),
  ('01a16194-0000-7000-8000-0000000000f3'::uuid, 2, 6, time '08:00', time '17:30'),
  ('01a16194-0000-7000-8000-0000000000f5'::uuid, 1, 5, time '08:00', time '17:30'),
  ('01a16194-0000-7000-8000-0000000000f6'::uuid, 1, 6, time '08:00', time '17:30')
) AS r (technician_id, first_weekday, last_weekday, starts, ends)
JOIN technician t ON t.id = r.technician_id
JOIN dealership d ON d.id = t.dealership_id
CROSS JOIN LATERAL generate_series(
  date_trunc('day', now() AT TIME ZONE d.timezone),
  date_trunc('day', now() AT TIME ZONE d.timezone) + interval '29 days',
  interval '1 day'
) AS day
WHERE extract(isodow FROM day) BETWEEN r.first_weekday AND r.last_weekday
ON CONFLICT ON CONSTRAINT technician_shift_no_overlap DO NOTHING;

INSERT INTO service_bay (id, dealership_id, name, bay_type) VALUES
  ('01a16194-0000-7000-8000-0000000000b1', '01a16194-0000-7000-8000-000000000001', 'Bay 1',             'LIFT'),
  ('01a16194-0000-7000-8000-0000000000b2', '01a16194-0000-7000-8000-000000000001', 'Bay 2',             'LIFT'),
  ('01a16194-0000-7000-8000-0000000000b3', '01a16194-0000-7000-8000-000000000001', 'Bay 3 (EV)',        'EV_HV'),
  ('01a16194-0000-7000-8000-0000000000b4', '01a16194-0000-7000-8000-000000000001', 'Bay 4 (Alignment)', 'ALIGNMENT'),
  ('01a16194-0000-7000-8000-0000000000b5', '01a16194-0000-7000-8000-000000000002', 'Bay 1',             'LIFT'),
  ('01a16194-0000-7000-8000-0000000000b6', '01a16194-0000-7000-8000-000000000002', 'Bay 2 (EV)',        'EV_HV')
ON CONFLICT (id) DO NOTHING;

INSERT INTO customer (id, full_name) VALUES
  ('01a16194-0000-7000-8000-0000000000c1', 'Ngoc Anh Le'),
  ('01a16194-0000-7000-8000-0000000000c2', 'Sam Taylor')
ON CONFLICT (id) DO NOTHING;

INSERT INTO vehicle (id, vin, customer_id, make, model, model_year) VALUES
  ('01a16194-0000-7000-8000-0000000000e1', 'WVWZZZ1KZAW000001', '01a16194-0000-7000-8000-0000000000c1', 'Volkswagen', 'ID.3',    2023),
  ('01a16194-0000-7000-8000-0000000000e2', 'WVWZZZ1KZAW000002', '01a16194-0000-7000-8000-0000000000c1', 'Volkswagen', 'Golf',    2019),
  ('01a16194-0000-7000-8000-0000000000e3', 'WVWZZZ1KZAW000003', '01a16194-0000-7000-8000-0000000000c2', 'Volkswagen', 'Passat',  2021)
ON CONFLICT (id) DO NOTHING;

-- One finished job, last week's Monday 09:00 in Saigon, so GET /v1/appointments/{id} has something to show.
-- It is in the past, so it never blocks a new booking.
INSERT INTO appointment (
  id, dealership_id, customer_id, vehicle_id, service_type_id, technician_id, bay_id,
  start_at, end_at, status, idempotency_key, request_fingerprint
)
SELECT
  '01a16194-0000-7000-8000-0000000000d1', '01a16194-0000-7000-8000-000000000001',
  '01a16194-0000-7000-8000-0000000000c1', '01a16194-0000-7000-8000-0000000000e2',
  '01a16194-0000-7000-8000-0000000000a2', '01a16194-0000-7000-8000-0000000000f2',
  '01a16194-0000-7000-8000-0000000000b1',
  start_at, start_at + interval '60 minutes', 'COMPLETED', 'demo-seed-d1', 'demo-seed'
FROM (
  SELECT (date_trunc('week', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '7 days' + interval '9 hours')
         AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start_at
) AS last_week
ON CONFLICT (id) DO NOTHING;
