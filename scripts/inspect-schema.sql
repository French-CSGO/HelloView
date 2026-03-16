-- Inspecter le schéma de la base csdemo (tables et colonnes)
-- Exécuter : psql -h localhost -U csdemo -d csdemo -f scripts/inspect-schema.sql

\echo '=== Tables du schéma public ==='
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
 ORDER BY table_name;

\echo ''
\echo '=== Colonnes par table ==='
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
 ORDER BY table_name, ordinal_position;

\echo ''
\echo '=== Valeurs distinctes match_checksum (table players) ==='
SELECT DISTINCT match_checksum FROM public.players ORDER BY 1 LIMIT 20;

\echo ''
\echo '=== Existence éventuelle d une table matches (ou similaire) ==='
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND ( table_name ILIKE '%match%' OR table_name ILIKE '%game%' OR table_name ILIKE '%round%' );
