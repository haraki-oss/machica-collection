-- ============================================================
-- machica Collection — Supabase RLS セットアップ
-- ============================================================
-- このファイルは「Supabase Dashboard → SQL Editor」で順に実行してください。
-- 既存データは変更しません。すべての DDL は IF NOT EXISTS / OR REPLACE です。
--
-- 前提:
--   1) Supabase Dashboard → Authentication → Users で
--      h.araki@gmail.com の管理者アカウントを「Add user」で作成済み
--      （パスワードは強いものを設定）
--   2) Authentication → Providers → Email の設定:
--      - "Confirm email" は運用に応じて ON/OFF（OFF だと UX が楽）
--   3) このプロジェクトには cards / categories / areas / settings の
--      4 テーブルが存在する（Clip 側の lists / collected_cards は対象外）
-- ============================================================


-- ------------------------------------------------------------
-- 1. admin_users テーブル — 管理者の user_id 一覧
-- ------------------------------------------------------------
-- 管理者を追加/削除するときは、このテーブルを編集してください。
-- 「変更可能な管理者リスト」の実体です。
create table if not exists public.admin_users (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text,
    note text,
    created_at timestamptz default now()
);

-- このテーブル自体への直接アクセスは禁止（管理は Service Role のみ）
alter table public.admin_users enable row level security;

-- 既存ポリシーを掃除して入れ直し
drop policy if exists admin_users_select on public.admin_users;
create policy admin_users_select
    on public.admin_users
    for select
    using ( auth.uid() = user_id );  -- 自分が admin かどうかだけ確認できる


-- ------------------------------------------------------------
-- 2. is_admin() — 管理者判定ヘルパー（SECURITY DEFINER）
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.admin_users
        where user_id = auth.uid()
    );
$$;

-- 全ロールから呼べるようにする
grant execute on function public.is_admin() to anon, authenticated;


-- ------------------------------------------------------------
-- 3. 管理者を登録する
-- ------------------------------------------------------------
-- ↓↓↓ h.araki@gmail.com の user_id を入れてください ↓↓↓
-- Authentication → Users で対象アカウントの UID を確認
-- （または下のクエリ一発で済みます）
insert into public.admin_users (user_id, email, note)
select id, email, 'initial admin'
from auth.users
where email = 'h.araki@gmail.com'
on conflict (user_id) do nothing;

-- 確認用
-- select * from public.admin_users;


-- ------------------------------------------------------------
-- 4. cards テーブルの RLS
-- ------------------------------------------------------------
alter table public.cards enable row level security;

drop policy if exists cards_public_read on public.cards;
drop policy if exists cards_admin_insert on public.cards;
drop policy if exists cards_admin_update on public.cards;
drop policy if exists cards_admin_delete on public.cards;

-- 公開サイトが匿名で読めるように
create policy cards_public_read
    on public.cards for select
    using ( true );

-- 書き込みは管理者のみ
create policy cards_admin_insert
    on public.cards for insert
    with check ( public.is_admin() );

create policy cards_admin_update
    on public.cards for update
    using ( public.is_admin() )
    with check ( public.is_admin() );

create policy cards_admin_delete
    on public.cards for delete
    using ( public.is_admin() );


-- ------------------------------------------------------------
-- 5. categories テーブルの RLS
-- ------------------------------------------------------------
alter table public.categories enable row level security;

drop policy if exists categories_public_read on public.categories;
drop policy if exists categories_admin_insert on public.categories;
drop policy if exists categories_admin_update on public.categories;
drop policy if exists categories_admin_delete on public.categories;

create policy categories_public_read
    on public.categories for select using ( true );
create policy categories_admin_insert
    on public.categories for insert with check ( public.is_admin() );
create policy categories_admin_update
    on public.categories for update
    using ( public.is_admin() ) with check ( public.is_admin() );
create policy categories_admin_delete
    on public.categories for delete using ( public.is_admin() );


-- ------------------------------------------------------------
-- 6. areas テーブルの RLS
-- ------------------------------------------------------------
alter table public.areas enable row level security;

drop policy if exists areas_public_read on public.areas;
drop policy if exists areas_admin_insert on public.areas;
drop policy if exists areas_admin_update on public.areas;
drop policy if exists areas_admin_delete on public.areas;

create policy areas_public_read
    on public.areas for select using ( true );
create policy areas_admin_insert
    on public.areas for insert with check ( public.is_admin() );
create policy areas_admin_update
    on public.areas for update
    using ( public.is_admin() ) with check ( public.is_admin() );
create policy areas_admin_delete
    on public.areas for delete using ( public.is_admin() );


-- ------------------------------------------------------------
-- 7. settings テーブルの RLS（特殊：LIKE は anon に許可）
-- ------------------------------------------------------------
-- 公開サイトの「♡ LIKE」は anonymous で settings.id='card_likes' を更新する。
-- そのため card_likes 行だけは anon が UPDATE / INSERT できる必要がある。
-- それ以外（card_order, edited_areas, deleted_*）は管理者のみ。
alter table public.settings enable row level security;

drop policy if exists settings_public_read on public.settings;
drop policy if exists settings_likes_anon_insert on public.settings;
drop policy if exists settings_likes_anon_update on public.settings;
drop policy if exists settings_admin_insert on public.settings;
drop policy if exists settings_admin_update on public.settings;
drop policy if exists settings_admin_delete on public.settings;

-- 全行 anon でも読める
create policy settings_public_read
    on public.settings for select using ( true );

-- card_likes だけは anon が新規作成 / 更新可能
create policy settings_likes_anon_insert
    on public.settings for insert
    with check ( id = 'card_likes' );

create policy settings_likes_anon_update
    on public.settings for update
    using ( id = 'card_likes' )
    with check ( id = 'card_likes' );

-- 管理者は全行 INSERT / UPDATE / DELETE 可能
create policy settings_admin_insert
    on public.settings for insert with check ( public.is_admin() );
create policy settings_admin_update
    on public.settings for update
    using ( public.is_admin() ) with check ( public.is_admin() );
create policy settings_admin_delete
    on public.settings for delete using ( public.is_admin() );


-- ------------------------------------------------------------
-- 8. Storage バケット images の RLS
-- ------------------------------------------------------------
-- 画像は誰でも閲覧可能、アップロード/削除は管理者のみ。
-- ※ バケット images が public フラグで読み取り可能になっていない場合のみ
--    SELECT ポリシーが必要。すでに public バケットなら省略可。

drop policy if exists images_public_read on storage.objects;
drop policy if exists images_admin_insert on storage.objects;
drop policy if exists images_admin_update on storage.objects;
drop policy if exists images_admin_delete on storage.objects;

create policy images_public_read
    on storage.objects for select
    using ( bucket_id = 'images' );

create policy images_admin_insert
    on storage.objects for insert
    with check ( bucket_id = 'images' and public.is_admin() );

create policy images_admin_update
    on storage.objects for update
    using ( bucket_id = 'images' and public.is_admin() )
    with check ( bucket_id = 'images' and public.is_admin() );

create policy images_admin_delete
    on storage.objects for delete
    using ( bucket_id = 'images' and public.is_admin() );


-- ============================================================
-- 確認クエリ
-- ============================================================
-- 管理者一覧
-- select * from public.admin_users;
--
-- 各テーブルの RLS 状態
-- select schemaname, tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public' and tablename in ('cards','categories','areas','settings','admin_users');
--
-- ポリシー一覧
-- select schemaname, tablename, policyname, cmd
-- from pg_policies
-- where schemaname in ('public','storage')
-- order by schemaname, tablename, policyname;


-- ============================================================
-- 管理者の追加 / 削除（運用メモ）
-- ============================================================
-- フロント側にホワイトリストは無く、admin_users テーブルが
-- 唯一の管理者リストとして機能する（コード変更・デプロイ不要）。
--
-- 追加:
--   1) Authentication → Users → "Add user" → "Create new user"
--      Email: NEW@example.com
--      Password: 強い一時パスワード
--      "Auto Confirm User" にチェック
--   2) ここで insert:
--      insert into public.admin_users (user_id, email, note)
--      select id, email, '担当者: 田中'
--      from auth.users where email = 'NEW@example.com';
--   3) 新管理者にメール+一時パスワードを伝える。
--      ログイン後、トップバー右上「アカウント → パスワードを変更」で
--      本人のパスワードに差し替えてもらう。
--
-- 削除:
--   delete from public.admin_users where email = 'OLD@example.com';
--   -- 必要なら auth.users 側のアカウントも削除:
--   -- Authentication → Users で対象行を Delete user
--
-- 確認:
--   select au.email, au.note, au.created_at, u.last_sign_in_at
--   from public.admin_users au
--   left join auth.users u on u.id = au.user_id
--   order by au.created_at;
