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

INSERT INTO service_bay (id, dealership_id, name, bay_type) VALUES
  ('01a16194-0000-7000-8000-0000000000b1', '01a16194-0000-7000-8000-000000000001', 'Bay 1',             'LIFT'),
  ('01a16194-0000-7000-8000-0000000000b2', '01a16194-0000-7000-8000-000000000001', 'Bay 2',             'LIFT'),
  ('01a16194-0000-7000-8000-0000000000b3', '01a16194-0000-7000-8000-000000000001', 'Bay 3 (EV)',        'EV_HV'),
  ('01a16194-0000-7000-8000-0000000000b4', '01a16194-0000-7000-8000-000000000001', 'Bay 4 (Alignment)', 'ALIGNMENT'),
  ('01a16194-0000-7000-8000-0000000000b5', '01a16194-0000-7000-8000-000000000002', 'Bay 1',             'LIFT'),
  ('01a16194-0000-7000-8000-0000000000b6', '01a16194-0000-7000-8000-000000000002', 'Bay 2 (EV)',        'EV_HV')
ON CONFLICT (id) DO NOTHING;
