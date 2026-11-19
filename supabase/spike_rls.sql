-- Spike J0, point 7 : mini-schéma et règles d'accès (RLS), à exécuter dans un projet Supabase DE TEST.
-- Testé sur un PostgreSQL 16 local avec un simulateur d'auth.uid() (pas sur Supabase lui-même) : à rejouer dans un projet de test.
-- Principe : un compte porte une LISTE de rôles par organisation (un rôle donne des droits, un métier n'en donne aucun).

create table organisation (id uuid primary key default gen_random_uuid(), nom text not null);

-- Rôles d'un utilisateur dans une organisation (plusieurs lignes possibles par utilisateur).
create table membre_role (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id  uuid not null references organisation(id) on delete cascade,
  role    text not null check (role in ('operateur','validateur','administrateur','logisticien','auditeur')),
  expire_le timestamptz,                       -- accès limité dans le temps (Auditeur)
  primary key (user_id, org_id, role)
);

create table device (                          -- enrôlement des téléphones
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisation(id),
  code char(4) not null unique,                -- code du numéro PLS-<code>-<compteur>
  revoque_le timestamptz
);

create table product (
  id uuid primary key,                         -- UUID généré sur le téléphone, porté par le QR
  org_id uuid not null references organisation(id),
  device_code char(4) not null,
  num text not null,
  statut text not null default 'capture',
  cree_par uuid not null default auth.uid(),
  version int not null default 1
);

create table event_log (                       -- journal en ajout seul
  id bigint generated always as identity primary key,
  org_id uuid not null, product_id uuid, acteur uuid default auth.uid(),
  quoi text not null, le timestamptz not null default now()
);

-- Fonction : l'utilisateur courant a-t-il au moins un des rôles demandés, non expirés, dans l'organisation ?
create or replace function a_role(p_org uuid, variadic p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membre_role m
    where m.user_id = auth.uid() and m.org_id = p_org and m.role = any(p_roles)
      and (m.expire_le is null or m.expire_le > now()));
$$;

-- Le téléphone actif existe-t-il ? (fonction à part : l'Opérateur ne lit pas la table device sous RLS)
create or replace function device_actif(p_org uuid, p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from device d where d.org_id = p_org and d.code = p_code and d.revoque_le is null);
$$;

alter table organisation enable row level security;
alter table membre_role  enable row level security;
alter table device       enable row level security;
alter table product      enable row level security;
alter table event_log    enable row level security;

create policy org_lecture on organisation for select using (a_role(id,'operateur','validateur','administrateur','logisticien','auditeur'));
create policy role_lecture_soi on membre_role for select using (user_id = auth.uid() or a_role(org_id,'administrateur'));
create policy role_admin on membre_role for all using (a_role(org_id,'administrateur')) with check (a_role(org_id,'administrateur'));
create policy device_admin on device for all using (a_role(org_id,'administrateur')) with check (a_role(org_id,'administrateur'));

-- Produits : lecture par tous les rôles de l'organisation (Auditeur compris) ; écriture : Opérateur, jamais Auditeur.
create policy product_lecture on product for select using (a_role(org_id,'operateur','validateur','administrateur','logisticien','auditeur'));
create policy product_creation on product for insert with check (a_role(org_id,'operateur') and cree_par = auth.uid()
  and device_actif(org_id, device_code));
create policy product_maj_operateur on product for update using (a_role(org_id,'operateur') and cree_par = auth.uid() and statut = 'capture')
  with check (a_role(org_id,'operateur') and statut = 'capture');   -- un Opérateur ne peut pas changer le statut
-- Règle « on ne valide pas sa propre capture » : seul un Validateur différent du créateur peut changer le statut.
create policy product_validation on product for update using (a_role(org_id,'validateur') and cree_par <> auth.uid()) with check (a_role(org_id,'validateur'));

-- Journal : lecture Validateur, Administrateur, Auditeur ; ajout par tout rôle d'écriture ; jamais de modification ni de suppression.
create policy log_lecture on event_log for select using (a_role(org_id,'validateur','administrateur','auditeur'));
create policy log_ajout on event_log for insert with check (a_role(org_id,'operateur','validateur','administrateur'));
-- (aucune politique update ou delete : refusé par défaut)

-- ===== Jeu de test à dérouler à la main (remplacer les UUID) =====
-- 1. Créer deux utilisateurs A (opérateur) et B (auditeur) dans Authentication, une organisation, deux lignes membre_role, un device.
-- 2. En tant que A : insérer un product -> doit réussir. Le relire -> réussit.
-- 3. En tant que B : select product -> voit la ligne ; insert ou update product -> doit échouer (violation de politique).
-- 4. En tant que A : update event_log, delete event_log -> doit échouer.
-- 5. Mettre expire_le dans le passé pour B : select product -> aucune ligne.
-- Simulation SQL d'un utilisateur (éditeur SQL) :
--   set local role authenticated; select set_config('request.jwt.claims','{"sub":"<uuid utilisateur>"}',true);
