#!/bin/sh
# يُنفَّذ مرة واحدة عند إنشاء القاعدة (0005 §١٤٠): دور التطبيق ليس مشرفاً ولا يتجاوز RLS — وإلا
# سقط عزل المستأجرين. النسخ الليلي وحده يتصل بالمشرف `postgres`.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
CREATE ROLE vezano LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE vezano OWNER vezano;
-- دور التطبيق في الهجرة 0002 (core/db/rls.py): تنشئه الهجرة إن غاب، ودور التطبيق لا يملك CREATEROLE
CREATE ROLE sting_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
SQL
