-- POPilot tables. Paste this whole file into Supabase -> SQL Editor -> Run (safe to run again).
-- Row Level Security is ON with no policies: the public (anon) key can read and write nothing.
-- Only the server, using the secret service key, can touch these tables.

create table if not exists pos (
  seq bigint generated always as identity,
  po_id text primary key,
  sku text not null default '',
  product text not null default '',
  qty integer not null default 0,
  manufacturer_vendor text not null default '',
  manufacturer_eta text not null default '',
  manufacturer_status text not null default 'open',
  packaging_vendor text not null default '',
  packaging_eta text not null default '',
  packaging_status text not null default 'open',
  label_vendor text not null default '',
  label_eta text not null default '',
  label_status text not null default 'open'
);

create table if not exists updates (
  seq bigint generated always as identity,
  id text primary key,
  timestamp text not null default '',
  original_text text not null default '',
  source text not null default 'text',
  vendor text not null default '',
  po_id text not null default '',
  item text not null default '',
  eta_expression text not null default '',
  old_eta text not null default '',
  new_eta text not null default '',
  confidence double precision not null default 0,
  status text not null default 'needs_review',
  reason text not null default ''
);

create table if not exists alerts (
  po_id text primary key,
  alerted_gap integer not null default 0,
  alerted_at text not null default ''
);

alter table pos enable row level security;
alter table updates enable row level security;
alter table alerts enable row level security;
