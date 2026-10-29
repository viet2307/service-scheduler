-- Confirmed reservations of one technician and one bay for one vehicle over [start_at, end_at).
-- The exclusion constraints are the double-booking guarantee; the application only pre-checks.

CREATE TABLE appointment (
  id                  uuid NOT NULL DEFAULT uuidv7(),
  dealership_id       uuid NOT NULL,
  customer_id         uuid NOT NULL,
  vehicle_id          uuid NOT NULL,
  service_type_id     uuid NOT NULL,
  technician_id       uuid NOT NULL,
  bay_id              uuid NOT NULL,
  start_at            timestamptz NOT NULL,
  end_at              timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'CONFIRMED',
  idempotency_key     text NOT NULL,
  request_fingerprint text NOT NULL, -- SHA-256 of the canonical request body
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  cancelled_at        timestamptz,
  CONSTRAINT appointment_pkey PRIMARY KEY (id),
  CONSTRAINT appointment_dealership_fk FOREIGN KEY (dealership_id) REFERENCES dealership (id),
  CONSTRAINT appointment_customer_fk FOREIGN KEY (customer_id) REFERENCES customer (id),
  CONSTRAINT appointment_vehicle_fk FOREIGN KEY (vehicle_id) REFERENCES vehicle (id),
  CONSTRAINT appointment_service_type_fk FOREIGN KEY (service_type_id) REFERENCES service_type (id),
  CONSTRAINT appointment_technician_fk FOREIGN KEY (dealership_id, technician_id)
    REFERENCES technician (dealership_id, id),
  CONSTRAINT appointment_bay_fk FOREIGN KEY (dealership_id, bay_id)
    REFERENCES service_bay (dealership_id, id),
  CONSTRAINT appointment_status_valid CHECK (status IN ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
  CONSTRAINT appointment_interval_valid CHECK (end_at > start_at),
  CONSTRAINT appointment_cancelled_at_consistent CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT appointment_idempotency_key_uq UNIQUE (idempotency_key),
  -- dealership_id WITH = keeps these valid if the table is ever hash-partitioned by dealership.
  CONSTRAINT appointment_no_technician_overlap EXCLUDE USING gist
    (dealership_id WITH =, technician_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
    WHERE (status <> 'CANCELLED'),
  CONSTRAINT appointment_no_bay_overlap EXCLUDE USING gist
    (dealership_id WITH =, bay_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
    WHERE (status <> 'CANCELLED'),
  CONSTRAINT appointment_no_vehicle_overlap EXCLUDE USING gist
    (vehicle_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
    WHERE (status <> 'CANCELLED')
);

CREATE INDEX appointment_dealership_start_idx ON appointment (dealership_id, start_at);

COMMENT ON CONSTRAINT appointment_no_technician_overlap ON appointment IS
  'API contract: BookingService maps SQLSTATE 23P01 by this name. Never rename or drop.';
COMMENT ON CONSTRAINT appointment_no_bay_overlap ON appointment IS
  'API contract: BookingService maps SQLSTATE 23P01 by this name. Never rename or drop.';
COMMENT ON CONSTRAINT appointment_no_vehicle_overlap ON appointment IS
  'API contract: BookingService maps SQLSTATE 23P01 by this name. Never rename or drop.';
