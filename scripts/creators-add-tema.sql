-- ============================================================================
-- CRM creadores — agrega la columna `tema` (merge field {{tema}}).
-- ----------------------------------------------------------------------------
-- Idempotente. Supabase → SQL Editor → pega esto → Run.
-- `tema` reemplaza al antiguo {{best_series}} como merge field del correo.
-- ============================================================================
alter table public.creators add column if not exists tema text;
