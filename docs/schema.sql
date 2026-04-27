-- Tabela de clientes
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  meta_ad_account_id text not null unique,
  meta_page_id text,
  segment text not null check (segment in ('popular', 'premium')) default 'popular',
  cpl_min numeric(10,2) not null default 6,
  cpl_max numeric(10,2) not null default 12,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Métricas diárias por cliente
create table if not exists metrics_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  date date not null,
  spend numeric(10,2) not null default 0,
  leads integer not null default 0,
  cpl numeric(10,2) generated always as (
    case when leads > 0 then round(spend / leads, 2) else null end
  ) stored,
  updated_at timestamptz not null default now(),
  unique(client_id, date)
);

-- Log de sincronizações com Meta API
create table if not exists sync_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  synced_at timestamptz not null default now(),
  status text not null check (status in ('success', 'error')),
  message text
);

-- Configurações globais
create table if not exists app_config (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value text not null
);

-- Defaults globais de CPL
insert into app_config (key, value) values
  ('default_cpl_min_popular', '6'),
  ('default_cpl_max_popular', '12'),
  ('default_cpl_min_premium', '12'),
  ('default_cpl_max_premium', '25')
on conflict (key) do nothing;

-- Index para consultas frequentes
create index if not exists idx_metrics_daily_client_date on metrics_daily(client_id, date desc);
create index if not exists idx_sync_log_client on sync_log(client_id, synced_at desc);
