\set ON_ERROR_STOP on
begin;

-- Only run against a fresh disposable database. This fixture models Supabase's role and auth.uid().
create schema auth;
create role authenticated nologin;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

\ir ../supabase-schema.sql

grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on watchlist, portfolio to authenticated;

insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
insert into watchlist (user_id, ticker) values
  ('00000000-0000-0000-0000-000000000001', 'AAPL'),
  ('00000000-0000-0000-0000-000000000002', 'MSFT');
insert into portfolio (user_id, ticker, shares, avg_buy_price) values
  ('00000000-0000-0000-0000-000000000001', 'AAPL', 1, 10),
  ('00000000-0000-0000-0000-000000000002', 'MSFT', 1, 10);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

do $$
begin
  if (select array_agg(ticker) from watchlist) is distinct from array['AAPL']
     or (select array_agg(ticker) from portfolio) is distinct from array['AAPL'] then
    raise exception 'Cross-account read policy failed';
  end if;

  delete from watchlist where ticker = 'MSFT';
  if found then raise exception 'Cross-account watchlist deletion succeeded'; end if;
  delete from portfolio where ticker = 'MSFT';
  if found then raise exception 'Cross-account portfolio deletion succeeded'; end if;
  update portfolio set shares = 2 where ticker = 'MSFT';
  if found then raise exception 'Cross-account portfolio update succeeded'; end if;

  begin
    insert into watchlist (user_id, ticker) values ('00000000-0000-0000-0000-000000000002', 'TSLA');
    raise exception 'Cross-account watchlist insert succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into portfolio (user_id, ticker, shares, avg_buy_price)
    values ('00000000-0000-0000-0000-000000000002', 'TSLA', 1, 10);
    raise exception 'Cross-account portfolio insert succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update portfolio set user_id = '00000000-0000-0000-0000-000000000002' where ticker = 'AAPL';
    raise exception 'Portfolio ownership reassignment succeeded';
  exception when insufficient_privilege then null;
  end;

  update portfolio set shares = 2 where ticker = 'AAPL';
  if not found then raise exception 'Own portfolio update failed'; end if;
  delete from watchlist where ticker = 'AAPL';
  if not found then raise exception 'Own watchlist deletion failed'; end if;
end $$;

reset role;
do $$
begin
  if not exists (select 1 from watchlist where ticker = 'MSFT')
     or not exists (select 1 from portfolio where ticker = 'MSFT' and shares = 1) then
    raise exception 'Other account data changed';
  end if;
end $$;
rollback;
