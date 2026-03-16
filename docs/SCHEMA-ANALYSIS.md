# Analyse du schéma PostgreSQL (csdemo)

## Tables utiles pour le dashboard HelloView

### 1. **`matches`** — Infos match (essentiel pour W/L)

| Colonne        | Rôle |
|----------------|------|
| `checksum`     | Identifiant du match (= `match_checksum` dans `players`) |
| `winner_name`  | **Nom de l’équipe gagnante** (ex. `Juliecie`, `Kebab2Creteil`) |
| `winner_side`  | Côté gagnant (2 = CT, 3 = T) |
| `analyze_date` | Date d’analyse du demo |
| `game_mode_str`| Ex. `competitive` |
| `overtime_count`, `max_rounds` | Infos optionnelles |

**À faire côté dashboard** : pour chaque équipe, compter les matchs où `winner_name = team_name` (victoires) et ceux où l’équipe a joué mais `winner_name != team_name` (défaites). Plus besoin de déduire le W/L depuis `players.wins_count`.

---

### 2. **`players`** — Stats par joueur par match (déjà utilisé)

Contient notamment : `match_checksum`, `steam_id`, `team_name`, `name`, `kill_count`, `death_count`, `assist_count`, `kast`, `average_damage_per_round`, `hltv_rating_2`, `wins_count`, etc.  
La table en base a en plus `kill_death_ratio` et `headshot_percentage` (calculés).

---

### 3. **`rounds`** — Détail par round

Pour chaque round : `match_checksum`, `number`, `team_a_name`, `team_b_name`, `team_a_score`, `team_b_score`, `winner_name`, `winner_side`.  
Permet de reconstruire le score final ou le déroulé round par round si besoin.

---

### 4. **`teams`** — Résumé par équipe par match

Colonnes : `match_checksum`, `name`, `score`, `score_first_half`, `score_second_half`, `letter`.  
Donne le score de chaque équipe par match (redondant avec le dernier round de `rounds` ou avec `matches` pour le gagnant).

---

### 5. **`demos`** — Métadonnées du fichier demo

Colonnes : `checksum`, `name`, `map_name`, `date`, `duration`, etc.  
Utile pour afficher un libellé de match plus parlant (ex. « de_ancient · 07/12/2025 ») au lieu de « Match 1 ».

---

## Matchs présents dans l’échantillon

D’après l’aperçu et les `match_checksum` distincts dans `players` :

- `e2e09843d7d3fbe` — gagnant : **Juliecie**
- `1b7f0eb5fb37dfbd` — gagnant : **Kebab2Creteil**
- `496a3755beccac24` — (pas dans l’aperçu `matches` ; à vérifier en base)

---

## Recommandations pour l’API / le front

1. **Liste des matchs**  
   Depuis `matches` : `SELECT checksum, winner_name, analyze_date, game_mode_str FROM matches ORDER BY analyze_date`.

2. **W/L par équipe**  
   Pour chaque équipe :  
   - victoires = nombre de lignes dans `matches` où `winner_name = <nom_équipe>` ;  
   - défaites = nombre de matchs où l’équipe apparaît dans `players` (ou `teams`) pour ce `match_checksum` mais `matches.winner_name != <nom_équipe>`.

3. **Libellés de match**  
   Optionnel : joindre `demos` sur `checksum` pour afficher `map_name` et/ou `date` dans les filtres et tableaux.

4. **Données joueurs**  
   Continuer à utiliser `players` comme aujourd’hui ; les colonnes sont compatibles avec le format attendu par le front (y compris `wins_count` si tu veux garder une cohérence avec l’ancienne logique).
