-- ============================================================================
-- Tamaños de ruta (corta/mediana/completa) y consumo de créditos.
-- Idempotente: se puede correr varias veces sin daño.
--
-- - size:    tamaño elegido al crear la ruta ('short' | 'medium' | 'full').
-- - credits: costo en créditos que consumió esa ruta (1 / 2 / 3).
--
-- Las rutas existentes quedan con size='short' y credits=1, equivalente al
-- comportamiento previo (1 ruta = 1 crédito), así que el balance no cambia.
-- El balance de créditos del usuario sigue siendo profiles.route_quota.
-- ============================================================================

alter table public.routes add column if not exists size    text    default 'short';
alter table public.routes add column if not exists credits integer default 1;
