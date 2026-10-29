-- Local copy of customer and vehicle master data, which the DMS/CRM owns.

CREATE TABLE customer (
  id         uuid NOT NULL DEFAULT uuidv7(),
  full_name  text NOT NULL,
  email      text,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_pkey PRIMARY KEY (id)
);

CREATE TABLE vehicle (
  id          uuid NOT NULL DEFAULT uuidv7(),
  vin         char(17) NOT NULL,
  customer_id uuid NOT NULL,
  make        text NOT NULL,
  model       text NOT NULL,
  model_year  smallint,
  CONSTRAINT vehicle_pkey PRIMARY KEY (id),
  CONSTRAINT vehicle_customer_fk FOREIGN KEY (customer_id) REFERENCES customer (id),
  CONSTRAINT vehicle_vin_uq UNIQUE (vin),
  -- ISO 3779: no I, O or Q.
  CONSTRAINT vehicle_vin_format_valid CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$')
);
