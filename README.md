# HelloView — Stats CS2

Dashboard de statistiques **CS2** pour le tournoi **HelloWorld!Nexen** : classements **par joueur** et **par équipe**, brackets (Swiss + arbres Elite / Amateur), overlays détail match / joueur / équipe. Les données proviennent d’une base **PostgreSQL** (`csdemo`) générée par [**CS Demo Manager**](https://github.com/akiver/cs-demo-manager) (application compagnon pour les démos Counter-Strike).

---

## Fonctionnalités

### Dashboard (`/`)
- **Top joueurs** : tableau avec rang, joueur, équipe, K/D/A, K/D, ADR, Rating 2.0 ; recherche texte.
- **Top équipes** : tableau avec rang, nom, nombre de matchs, W/L, W/L % ; recherche texte.
- **Filtres** : Bracket (Tous / Swiss / Arbre Elite / Arbre Amateur), Match, Équipe. Les filtres sont **persistés dans l’URL** (rechargement conservé). Bouton « Supprimer tous les filtres » quand au moins un filtre est actif.
- **Panneau latéral** : liste des matchs (ouvrable via le bouton « Matchs »).
- **Overlays** (détail au clic) : **match** (score, équipes, stats joueurs), **joueur** (avatar, gauges, liste de matchs), **équipe** (logo, résumé, joueurs, matchs). Les overlays peuvent s’empiler (joueur → match → équipe) ; Échap ferme celui du premier plan.
- **Défilement automatique** : option dans le footer pour faire défiler les tableaux ; état enregistré en cookie et dans l’URL (`?autoScroll=1` pour l’activer par défaut).
- **Footer** : crédits (Nemavio, HelloWorld!Nexen, liens), date de dernière mise à jour.

### Brackets (`/brackets`)
- **Phase Swiss** : 5 rounds (16, 16, 16, 12, 6 matchs), vues « Matchs », « Flux » (par bilan W-L), « Parcours » (par équipe).
- **Arbre Elite** et **Arbre Amateur** : élimination directe (8e, quarts, demies, Upper Final), Lower Bracket (6 rounds), Grande Finale.
- Clic sur une cellule de match : ouverture du **même overlay match** que sur le dashboard (données chargées depuis `/api/stats`). Liens équipe / joueur ouvrent les overlays équipe / joueur par-dessus.
- **Mode admin** : bouton « Admin Tournoi », authentification par mot de passe ; édition des matchs (équipes, vainqueur, démo) pour Swiss, Elite et Amateur. Données enregistrées dans `data/brackets.json`.

### Panel admin (`/admin`)
- Gestion des **joueurs** (tri, recherche) et **avatars** (upload par Steam ID).
- Gestion des **logos d’équipe** (upload par nom d’équipe).
- Protégé par mot de passe (`ADMIN_PASSWORD` dans `.env`). Les avatars et logos sont stockés dans `uploads/avatars` et `uploads/team-logos`.

---

## Prérequis

- **Node.js** (v16+ recommandé)
- **PostgreSQL** avec une base `csdemo` contenant au minimum les tables `players`, `matches`, `teams` (et optionnellement `demos`, `steam_account_overrides`). Cette base est typiquement exportée depuis [**CS Demo Manager**](https://github.com/akiver/cs-demo-manager). Voir `docs/SCHEMA-ANALYSIS.md` pour le détail du schéma.

---

## Installation et configuration

### 1. Cloner / récupérer le projet

```bash
cd helloview
```

### 2. Dépendances

```bash
npm install
```

### 3. Fichier `.env`

Créer un fichier **`.env`** à la racine (il n’est pas versionné). Exemple minimal :

```env
# Connexion PostgreSQL (obligatoire pour /api/stats)
PGSQL_HOST=localhost
PGSQL_PORT=5432
PGSQL_DATABASE=csdemo
PGSQL_USER=csdemo
PGSQL_PASSWORD=votre_mot_de_passe

# Optionnel : mot de passe pour éditer les brackets (page /brackets, bouton « Admin Tournoi »)
BRACKETS_ADMIN_PASSWORD=votre_mot_de_passe_brackets

# Optionnel : mot de passe du panel admin (/admin) — joueurs, avatars, logos équipes
ADMIN_PASSWORD=votre_mot_de_passe_admin

# Optionnel : clé API Steam pour afficher les avatars des joueurs (profil Valve)
# Obtenir une clé gratuite : https://steamcommunity.com/dev/apikey
# STEAM_API_KEY=votre_cle_steam
```

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `PGSQL_HOST` | Oui* | Hôte PostgreSQL |
| `PGSQL_PORT` | Non (déf. 5432) | Port PostgreSQL |
| `PGSQL_DATABASE` | Oui* | Nom de la base |
| `PGSQL_USER` | Oui* | Utilisateur |
| `PGSQL_PASSWORD` | Oui* | Mot de passe |
| `BRACKETS_ADMIN_PASSWORD` | Non | Auth admin brackets |
| `ADMIN_PASSWORD` | Non | Auth panel /admin |
| `STEAM_API_KEY` | Non | Avatars Steam (API Valve) |
| `PORT` | Non (déf. 3000) | Port du serveur HTTP |

\* Obligatoire pour utiliser le mode « avec base » (voir ci‑dessous).

---

## Lancer le site

### Avec PostgreSQL (recommandé)

```bash
npm start
```

Puis ouvrir **http://localhost:3000** (ou `http://<votre-ip>:3000`). Les données joueurs, matchs et équipes viennent de la base. Les W/L équipes sont calculés à partir de `matches.winner_name` et des équipes présentes dans `players` / `teams`.

### Sans base (fichiers statiques uniquement)

Si PostgreSQL n’est pas disponible, on peut servir uniquement les fichiers statiques et pointer le dashboard vers un JSON local :

```bash
npm run serve-static
```

Puis dans la console du navigateur (ou en adaptant le code), définir avant le chargement de l’app :

```js
window.HELLOVIEW_API_URL = 'data/players.json';
```

Le format attendu pour ce JSON est celui renvoyé par `GET /api/stats` : `{ players, matches, teams }`. Voir la réponse de l’API ou un export (scripts ci‑dessous).

---

## Pages et URLs

| URL | Description |
|-----|-------------|
| `/` | Dashboard : Top joueurs, Top équipes, filtres, liste des matchs |
| `/brackets` | Brackets : Swiss, Arbre Elite, Arbre Amateur |
| `/admin` | Panel admin : joueurs, avatars, logos équipes |

**Paramètres d’URL (dashboard)** : les filtres et le défilement auto sont reflétés dans la barre d’adresse pour partage / signet, par ex. `/?bracket=elite&match=abc123&team=NomEquipe&autoScroll=1`.

---

## API

Le serveur expose les routes suivantes.

### Données

| Méthode | Route | Description |
|---------|--------|-------------|
| GET | `/api/stats` | `{ players, matches, teams }` depuis PostgreSQL. Enrichi avec avatars Steam (si `STEAM_API_KEY`), avatars personnalisés et logos équipes. |
| GET | `/api/match/:checksum` | Détail d’un match (infos + joueurs) pour un `checksum` donné. Utilisé par l’overlay match si besoin. |

### Brackets

| Méthode | Route | Description |
|---------|--------|-------------|
| GET | `/brackets` | Page HTML des brackets. |
| GET | `/api/brackets` | Données brackets : `swiss`, `elite`, `amateur` + `teamsFromDb`, `matchesFromDb` (pour l’admin). |
| POST | `/api/brackets/auth` | Auth admin brackets ; body `{ password }` ; renvoie `{ token }`. |
| POST | `/api/brackets` | Mise à jour d’un match (section, roundIndex, matchIndex, teamA, teamB, winner, demoId, lowerBracket). Header `Authorization: Bearer <token>`. |

### Admin panel

| Méthode | Route | Description |
|---------|--------|-------------|
| POST | `/api/admin/auth` | Auth panel admin ; body `{ password }` ; renvoie `{ token }`. |
| POST | `/api/admin/avatar/:steamid` | Upload avatar (multipart) pour un Steam ID. |
| DELETE | `/api/admin/avatar/:steamid` | Suppression de l’avatar du Steam ID. |
| GET | `/api/avatars/:steamid` | Récupération de l’image avatar (si existante). |
| POST | `/api/admin/team-logo/:teamname` | Upload logo d’équipe (multipart). |
| DELETE | `/api/admin/team-logo/:teamname` | Suppression du logo de l’équipe. |
| GET | `/api/team-logos/:slug` | Récupération du logo (par slug dérivé du nom d’équipe). |

---

## Données et fichiers

### `data/`

- **`data/brackets.json`** : contenu des brackets (Swiss, Elite, Amateur). Créé automatiquement au premier enregistrement par l’admin ; **non versionné** (voir `.gitignore`). Structure :
  - `swiss.rounds[]` : chaque round a un tableau `matches[]` avec `{ teamA, teamB, winner, demoId }`.
  - `elite` / `amateur` : `rounds[]` (upper) et `lowerRounds[]` (lower bracket + grande finale), mêmes champs par match.
- **`data/players.json`** : optionnel ; peut servir de source de données si on n’utilise pas PostgreSQL (voir `HELLOVIEW_API_URL`).

### `uploads/`

- **`uploads/avatars/`** : avatars personnalisés par Steam ID (uploadés depuis `/admin`). Non versionné.
- **`uploads/team-logos/`** : logos d’équipes (uploadés depuis `/admin`). Non versionné.

### Réinitialiser les brackets

Pour repartir d’une structure vierge (même logique que le serveur) :

```bash
npm run reset-brackets
```

Écrase `data/brackets.json` avec la structure par défaut (Swiss 5 rounds, Elite/Amateur avec upper + lower + grande finale).

---

## Scripts npm

| Script | Commande | Description |
|--------|----------|-------------|
| `start` | `npm start` | Démarre le serveur Express (API + fichiers statiques). |
| `serve-static` | `npm run serve-static` | Sert le projet en statique avec `npx serve .` (sans API). |
| `inspect-db` | `npm run inspect-db` | Connexion à la base, liste des tables/colonnes et aperçu des données (schéma + échantillons). Nécessite `.env` ou variables `PG*` / `PGSQL_*`. |
| `export-table` | `npm run export-table -- TABLE` | Exporte une table en JSON sur la sortie standard. |
| `export-db` | `npm run export-db` | Exporte toute la base dans `db-export.json` (ou fichier passé en argument). |
| `reset-brackets` | `npm run reset-brackets` | Réinitialise `data/brackets.json` avec la structure par défaut. |

Exemples :

```bash
# Inspection de la base
PGPASSWORD=votre_mdp npm run inspect-db

# Export d’une table
npm run export-table -- players > players.json

# Export complet
npm run export-db
```

---

## Structure du projet

```
helloview/
├── server.js              # Serveur Express : statiques, API stats/brackets/admin, auth
├── index.html             # Page dashboard
├── app.js                 # Logique dashboard : filtres, tableaux, overlays, URL, défilement auto
├── style.css              # Styles dashboard
├── common.js              # Partagé : overlays match/joueur/équipe, helpers, footer
├── common.css             # Styles partagés (overlays, logos, gauges)
├── brackets.html          # Page brackets
├── brackets.js            # Logique brackets : Swiss, arbres, admin, overlays
├── brackets.css           # Styles brackets
├── admin.html             # Panel admin
├── admin.js               # Logique admin (joueurs, avatars, logos)
├── admin.css              # Styles admin
├── package.json           # Dépendances et scripts
├── .env                   # Config (non versionné)
├── .gitignore             # node_modules, .env, data/, uploads/, etc.
├── data/
│   ├── brackets.json     # Données brackets (généré / édité par l’app)
│   └── players.json      # Optionnel : source JSON alternative pour les stats
├── uploads/               # Avatars et logos (créé à l’upload)
│   ├── avatars/
│   └── team-logos/
├── scripts/
│   ├── inspect-db.js      # Inspection et export PostgreSQL
│   ├── inspect-schema.sql # Requêtes schéma (usage avec psql)
│   └── reset-brackets.js  # Réinitialisation data/brackets.json
└── docs/
    └── SCHEMA-ANALYSIS.md # Analyse des tables csdemo (matches, players, teams, rounds)
```

---

## Brackets (détail)

- **Swiss** : 5 rounds avec 16, 16, 16, 12 puis 6 matchs. Chaque match a `teamA`, `teamB`, `winner`, `demoId`. Les vues « Flux » et « Parcours » dérivent des standings calculés à partir de ces matchs.
- **Elite / Amateur** : élimination directe avec **Upper Bracket** (8e, quarts, demies, Upper Final), **Lower Bracket** (6 rounds : R1–R4, Lower Final, Grande Finale). Les matchs sont identifiés par section (`elite` / `amateur`), index de round, index de match et indicateur lower/upper.
- Le **filtre Bracket** du dashboard restreint les stats aux matchs dont le `demoId` apparaît dans les rounds / lowerRounds du bracket choisi. Si l’arbre Amateur n’a aucun match renseigné, le filtre « Arbre Amateur » ne renvoie aucun résultat.

---

## Documentation complémentaire

- **`docs/SCHEMA-ANALYSIS.md`** : description des tables PostgreSQL utilisées (`matches`, `players`, `teams`, `rounds`, etc.) et de leur rôle pour le dashboard et les W/L.

---

## Licence et crédits

HelloView — Vibecodé et hébergé avec ♥ par [Nemavio](https://x.com/nemavdotio) pour la [HelloWorld!Nexen](https://esport.helloworldedhec.com/).
