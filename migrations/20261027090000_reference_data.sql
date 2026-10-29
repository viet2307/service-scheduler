-- Reference data needed to book: dealerships, skills, bay types, service types, technicians and bays.

CREATE TABLE dealership (
  id         uuid NOT NULL DEFAULT uuidv7(),
  name       text NOT NULL,
  timezone   text NOT NULL, -- IANA zone, e.g. 'Europe/London'
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dealership_pkey PRIMARY KEY (id)
);

CREATE TABLE dealership_opening_hours (
  dealership_id uuid NOT NULL,
  iso_weekday   smallint NOT NULL, -- 1 = Monday
  opens_at      time NOT NULL,     -- local wall-clock time in the dealership's zone
  closes_at     time NOT NULL,
  CONSTRAINT dealership_opening_hours_pkey PRIMARY KEY (dealership_id, iso_weekday),
  CONSTRAINT dealership_opening_hours_dealership_fk FOREIGN KEY (dealership_id) REFERENCES dealership (id),
  CONSTRAINT dealership_opening_hours_iso_weekday_valid CHECK (iso_weekday BETWEEN 1 AND 7),
  CONSTRAINT dealership_opening_hours_interval_valid CHECK (closes_at > opens_at)
);

CREATE TABLE skill (
  code        text NOT NULL,
  description text NOT NULL,
  CONSTRAINT skill_pkey PRIMARY KEY (code)
);

CREATE TABLE bay_type (
  code        text NOT NULL,
  description text NOT NULL,
  CONSTRAINT bay_type_pkey PRIMARY KEY (code)
);

CREATE TABLE service_type (
  id                uuid NOT NULL DEFAULT uuidv7(),
  code              text NOT NULL,
  name              text NOT NULL,
  duration_minutes  integer NOT NULL, -- includes bay turnaround time
  required_skill    text NOT NULL,
  required_bay_type text NOT NULL,
  CONSTRAINT service_type_pkey PRIMARY KEY (id),
  CONSTRAINT service_type_code_uq UNIQUE (code),
  CONSTRAINT service_type_duration_valid CHECK (duration_minutes > 0 AND duration_minutes <= 720),
  CONSTRAINT service_type_required_skill_fk FOREIGN KEY (required_skill) REFERENCES skill (code),
  CONSTRAINT service_type_required_bay_type_fk FOREIGN KEY (required_bay_type) REFERENCES bay_type (code)
);

CREATE TABLE technician (
  id            uuid NOT NULL DEFAULT uuidv7(),
  dealership_id uuid NOT NULL,
  display_name  text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  CONSTRAINT technician_pkey PRIMARY KEY (id),
  CONSTRAINT technician_dealership_fk FOREIGN KEY (dealership_id) REFERENCES dealership (id),
  -- Target of appointment_technician_fk, which keeps an appointment's technician in its dealership.
  CONSTRAINT technician_dealership_id_uq UNIQUE (dealership_id, id)
);

CREATE TABLE technician_skill (
  technician_id uuid NOT NULL,
  skill_code    text NOT NULL,
  CONSTRAINT technician_skill_pkey PRIMARY KEY (technician_id, skill_code),
  CONSTRAINT technician_skill_technician_fk FOREIGN KEY (technician_id) REFERENCES technician (id),
  CONSTRAINT technician_skill_skill_fk FOREIGN KEY (skill_code) REFERENCES skill (code)
);

CREATE TABLE technician_shift (
  id            uuid NOT NULL DEFAULT uuidv7(),
  technician_id uuid NOT NULL,
  start_at      timestamptz NOT NULL,
  end_at        timestamptz NOT NULL,
  CONSTRAINT technician_shift_pkey PRIMARY KEY (id),
  CONSTRAINT technician_shift_technician_fk FOREIGN KEY (technician_id) REFERENCES technician (id),
  CONSTRAINT technician_shift_interval_valid CHECK (end_at > start_at),
  CONSTRAINT technician_shift_no_overlap EXCLUDE USING gist
    (technician_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
);

COMMENT ON CONSTRAINT technician_shift_no_overlap ON technician_shift IS
  'Invariant I8: availability maths assumes disjoint shifts. Never rename or drop.';

CREATE TABLE service_bay (
  id            uuid NOT NULL DEFAULT uuidv7(),
  dealership_id uuid NOT NULL,
  name          text NOT NULL,
  bay_type      text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  CONSTRAINT service_bay_pkey PRIMARY KEY (id),
  CONSTRAINT service_bay_dealership_fk FOREIGN KEY (dealership_id) REFERENCES dealership (id),
  CONSTRAINT service_bay_bay_type_fk FOREIGN KEY (bay_type) REFERENCES bay_type (code),
  -- Target of appointment_bay_fk, which keeps an appointment's bay in its dealership.
  CONSTRAINT service_bay_dealership_id_uq UNIQUE (dealership_id, id),
  CONSTRAINT service_bay_name_uq UNIQUE (dealership_id, name)
);
