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
