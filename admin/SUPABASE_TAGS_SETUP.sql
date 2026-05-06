-- ============================================================
-- machica Collection — Tags 機能セットアップ
-- ============================================================
-- このファイルは「Supabase Dashboard → SQL Editor」で実行してください。
-- 既存データは変更しません（IF NOT EXISTS / OR REPLACE）。
--
-- 前提:
--   - SUPABASE_RLS_SETUP.sql が事前に適用済み（is_admin() 関数が存在）
-- ============================================================


-- ------------------------------------------------------------
-- 1. tags テーブル
-- ------------------------------------------------------------
-- id は文字列（"genre-01" のような安定キー、または admin で発番した tag_<ts>）
create table if not exists public.tags (
    id          text primary key,
    name        text        not null,
    category    text        not null,
    color       text,
    is_seed     boolean     default false,
    created_at  timestamptz default now(),
    updated_at  timestamptz default now()
);

create index if not exists idx_tags_category on public.tags (category);


-- ------------------------------------------------------------
-- 2. tags の RLS
-- ------------------------------------------------------------
alter table public.tags enable row level security;

drop policy if exists tags_public_read   on public.tags;
drop policy if exists tags_admin_insert  on public.tags;
drop policy if exists tags_admin_update  on public.tags;
drop policy if exists tags_admin_delete  on public.tags;

create policy tags_public_read
    on public.tags for select using ( true );

create policy tags_admin_insert
    on public.tags for insert with check ( public.is_admin() );

create policy tags_admin_update
    on public.tags for update
    using ( public.is_admin() ) with check ( public.is_admin() );

create policy tags_admin_delete
    on public.tags for delete using ( public.is_admin() );


-- ------------------------------------------------------------
-- 3. cards テーブルに tags 列を追加
-- ------------------------------------------------------------
-- 値は tag.id の配列（jsonb）。例: ["genre-01","emotion-03"]
alter table public.cards
    add column if not exists tags jsonb default '[]'::jsonb;

create index if not exists idx_cards_tags on public.cards using gin (tags);


-- ------------------------------------------------------------
-- 4. 確認クエリ
-- ------------------------------------------------------------
-- select * from public.tags order by category, id;
-- select id, title, tags from public.cards where jsonb_array_length(tags) > 0 limit 10;
