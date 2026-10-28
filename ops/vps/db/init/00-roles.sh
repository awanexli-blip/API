#!/bin/sh
# İlk açılışta bir kez (boş veri klasörü): Supabase rolleri ve şemaları. Veri mirror.sh ile gelir.
# anon: hiçbir tabloya yetkisi yok (kimliksiz istek boş döner); service_role: RLS'i aşar (Supabase'deki gibi).
set -eu
psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password '${AUTHENTICATOR_PASSWORD}';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login noinherit createrole password '${AUTH_ADMIN_PASSWORD}';
create schema if not exists auth authorization supabase_auth_admin;
grant create on database postgres to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
-- Supabase'deki gibi: similarity() vb. şema adı yazmadan bulunur
alter database postgres set search_path = "\$user", public, extensions;
revoke all on schema public from public;
grant usage on schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
alter default privileges in schema public revoke execute on functions from public;
SQL
