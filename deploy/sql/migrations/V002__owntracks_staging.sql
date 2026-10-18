create table if not exists staging.owntracks_location_inbox (
  id bigserial primary key,
  batch_id uuid not null references ops.ingest_batch (batch_id),
  record_source text not null default 'owntracks',
  bronze_key text not null,
  received_at timestamptz not null default now(),
  location_event_id text not null,
  topic text not null,
  person_id text not null,
  tid text,
  tst timestamptz not null,
  lat double precision not null,
  lon double precision not null,
  h3_index_r9 text not null,
  trigger_code text,
  accuracy_m double precision,
  altitude_m double precision,
  velocity_kmh double precision,
  battery_pct integer,
  in_regions jsonb,
  motion_activities jsonb,
  payload jsonb not null,
  hashdiff text not null,
  vault_loaded_at timestamptz,
  unique (location_event_id, batch_id)
);

create index if not exists idx_owntracks_inbox_vault_loaded
  on staging.owntracks_location_inbox (vault_loaded_at);
