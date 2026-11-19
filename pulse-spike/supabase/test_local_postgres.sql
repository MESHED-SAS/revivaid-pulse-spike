-- Test rejoué sur PostgreSQL 16 local (simule auth.uid()). Résultats attendus indiqués dans les \echo. Ne pas exécuter sur Supabase tel quel.
\set ON_ERROR_STOP off
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
\i /tmp/pgt/spike_rls.sql
grant usage on schema public to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated;
grant execute on function a_role(uuid,text[]) to authenticated; grant execute on function device_actif(uuid,text) to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');
insert into organisation(id,nom) values ('11111111-1111-1111-1111-111111111111','Org test');
insert into membre_role values ('00000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','operateur',null),
 ('00000000-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111','auditeur',null),
 ('00000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','validateur',null);
insert into device(org_id,code) values ('11111111-1111-1111-1111-111111111111','K7M2');
\echo '--- A operateur: insert product (attendu OK)'
set role authenticated; select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into product(id,org_id,device_code,num) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','K7M2','PLS-K7M2-0001');
select count(*) as a_voit from product;
\echo '--- A: update event_log / delete (attendu 0 ligne ou refus)'
insert into event_log(org_id,quoi) values ('11111111-1111-1111-1111-111111111111','capture');
update event_log set quoi='x'; delete from event_log;
\echo '--- B auditeur: select (1), insert (refus), update (0)'
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
select count(*) as b_voit from product;
insert into product(id,org_id,device_code,num) values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','K7M2','PLS-K7M2-0002');
update product set statut='valide';
select count(*) as log_vu_par_b from event_log;
\echo '--- A valide sa propre capture (0 ligne), C valide (1 ligne)'
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
update product set statut='valide';
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c"}',false);
update product set statut='valide' returning num,statut;
\echo '--- Echeance auditeur depassee (attendu 0)'
reset role; update membre_role set expire_le=now()-interval '1 day' where role='auditeur';
set role authenticated; select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
select count(*) as b_apres_echeance from product;
