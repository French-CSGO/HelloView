# HelloView — Stats CS2

Application web **HelloWorld!Nexen** : tableau de bord des statistiques **Counter-Strike 2**, **brackets** (Swiss + élimination), **overlays** détail match / joueur / équipe, et **panel admin** (avatars, logos). Les données live proviennent d’une base **PostgreSQL** (`csdemo`) produite par [**CS Demo Manager**](https://github.com/akiver/cs-demo-manager).

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)  
2. [Prérequis](#prérequis)  
3. [Installation et configuration](#installation-et-configuration)  
4. [Lancer l’application](#lancer-lapplication)  
5. [Pages, URLs et paramètres](#pages-urls-et-paramètres)  
6. [API HTTP](#api-http)  
7. [Données fichiers (`data/`, `uploads/`)](#données-fichiers-data-uploads)  
8. [Démos hébergées et téléchargement](#démos-hébergées-et-téléchargement)  
9. [Import depuis `data/import/`](#import-depuis-dataimport)  
10. [Scripts npm et utilitaires](#scripts-npm-et-utilitaires)  
11. [Structure du dépôt](#structure-du-dépôt)  
12. [Bibliothèques serveur (`lib/`)](#bibliothèques-serveur-lib)  
13. [Schéma brackets (résumé)](#schéma-brackets-résumé)  
14. [Documentation PostgreSQL](#documentation-postgresql)  
15. [Licence et crédits](#licence-et-crédits)

---

## Fonctionnalités

### Dashboard (`/` — `index.html`)

- **Top joueurs** : rang, joueur (avatar si disponible), équipe (logo si disponible), K/D/A, K/D, ADR, Rating 2.0 ; recherche en direct.
- **Top équipes** : rang, nom, nombre de matchs joués, W/L, W/L % ; recherche en direct.
- **Filtres** (persistés dans l’URL, rechargement conservé) :
  - **Bracket** : restreint aux matchs dont les checksums de démo figurent dans le tournoi choisi (Swiss, Elite, Amateur selon `data/brackets.json`).
  - **Match** : filtre sur un match précis (`match_checksum`).
  - **Équipe** : filtre sur `team_name`.
  - Bouton **Supprimer tous les filtres** lorsqu’au moins un filtre est actif.
- **Panneau latéral « Matchs »** : liste groupée des matchs ; clic → overlay match. En mode **défilement auto** (voir ci‑dessous), le bouton et la zone de survol du panneau sont **masqués** (usage type écran kiosk) ; le **select Match** en haut de page reste utilisable.
- **Overlays** (clic sur ligne ou navigation depuis un autre overlay) :
  - **Match** : score, métadonnées (map, durée, etc.), tableaux par équipe ; lien **demo** si un fichier `.dem` correspondant est hébergé (voir [Démos hébergées](#démos-hébergées-et-téléchargement)).
  - **Joueur** : identité, jauges, liste de matchs.
  - **Équipe** : logo, résumé, joueurs, matchs.
  - Empilement possible (ex. joueur → match → équipe) ; **Échap** ferme l’overlay au premier plan ou le panneau latéral.
- **Défilement automatique** (footer) : deux interrupteurs indépendants — **Défilement joueurs** et **Défilement équipes** — pour faire défiler les zones scrollables des deux tableaux. État persisté en **cookies** et reflété dans l’URL (voir [paramètres URL](#paramètres-du-dashboard-query-string)).
- **Footer** : crédits, date de dernière mise à jour des données (poll périodique vers l’API).

### Brackets (`/brackets` — `brackets.html`)

- Données lues depuis **`data/brackets.json`** au format **schema v2** (`schemaVersion`, `tournaments[]`), avec prise en charge de l’ancien format `{ swiss, elite, amateur }` à l’import (conversion côté serveur via `lib/brackets-model.js`).
- **Swiss** : rounds, vues Matchs / Flux (bilans W‑L) / Parcours (par équipe).
- **Élimination** (Elite, Amateur, etc.) : upper bracket, lower bracket, grande finale selon la configuration du fichier.
- Clic sur une cellule de match avec démo : **overlay match** identique au dashboard ; données issues de **`/api/stats`** (ou URL surchargée via `HELLOVIEW_API_URL`).
- **Mode admin tournoi** : mot de passe `BRACKETS_ADMIN_PASSWORD` ; édition des matchs (équipes, vainqueur, BO1/BO3, liste de `demoIds`). Enregistrement dans `data/brackets.json` ; recalcul du vainqueur de série BO3 possible à partir des `winner_name` en base pour les checksums renseignés.

### Panel admin (`/admin` — `admin.html`)

- Liste des **joueurs** (tri, recherche).
- Upload / suppression d’**avatars** par Steam ID (`uploads/avatars/`).
- Upload / suppression de **logos d’équipe** par nom d’équipe (`uploads/team-logos/`).
- Authentification : `ADMIN_PASSWORD` dans `.env`.

---

## Prérequis

- **Node.js** (v16+ recommandé).
- **PostgreSQL** avec une base **`csdemo`** peuplée par CS Demo Manager (tables minimales utilisées par l’API : `players`, `matches`, `teams`, jointures `demos`, optionnel `steam_account_overrides`). Détail des colonnes utiles : **`docs/SCHEMA-ANALYSIS.md`**.

---

## Installation et configuration

### Cloner le dépôt et installer les dépendances

```bash
cd helloview
npm install
```

### Fichier `.env` (racine, non versionné)

Exemple :

```env
# PostgreSQL — nécessaire pour /api/stats, /api/match, enrichissements brackets, démos
PGSQL_HOST=localhost
PGSQL_PORT=5432
PGSQL_DATABASE=csdemo
PGSQL_USER=csdemo
PGSQL_PASSWORD=votre_mot_de_passe

# Optionnel — édition des brackets (/brackets, « Admin Tournoi »)
BRACKETS_ADMIN_PASSWORD=mot_de_passe_brackets

# Optionnel — panel /admin
ADMIN_PASSWORD=mot_de_passe_admin

# Optionnel — avatars profil Steam (API Valve)
# STEAM_API_KEY=votre_cle

# Optionnel — port HTTP (défaut 3000)
# PORT=3000
```

| Variable | Obligatoire | Rôle |
|----------|-------------|------|
| `PGSQL_HOST` | Oui* | Hôte PostgreSQL |
| `PGSQL_PORT` | Non (5432) | Port |
| `PGSQL_DATABASE` | Oui* | Nom de la base |
| `PGSQL_USER` | Oui* | Utilisateur |
| `PGSQL_PASSWORD` | Oui* | Mot de passe |
| `BRACKETS_ADMIN_PASSWORD` | Non | Auth édition brackets |
| `ADMIN_PASSWORD` | Non | Auth `/admin` |
| `STEAM_API_KEY` | Non | Avatars via Steam Web API |
| `PORT` | Non (3000) | Port Express |

\* Requis pour toute utilisation avec base de données (mode normal `npm start`).

---

## Lancer l’application

### Mode recommandé : API + statiques

```bash
npm start
```

Ouvrir **http://localhost:3000** (ou `http://<ip>:3000` sur le réseau local).

### Mode statique seul (sans PostgreSQL)

```bash
npm run serve-static
```

Le dashboard ne peut pas appeler `/api/stats` sur ce serveur simple. Il faut soit un **proxy** vers une instance qui expose l’API, soit charger un JSON statique :

```js
// Avant le chargement des scripts, ou console navigateur
window.HELLOVIEW_API_URL = 'data/players.json';
```

Le fichier doit respecter la forme décrite dans [Fichier stats statique](#fichier-stats-statique-dataplayersjson) (idéalement avec `statsFileVersion`).

---

## Pages, URLs et paramètres

### Pages HTML

| Chemin | Fichier | Description |
|--------|---------|-------------|
| `/` | `index.html` | Dashboard |
| `/brackets` | `brackets.html` | Brackets |
| `/admin` | `admin.html` | Panel admin |

Les assets (CSS/JS) sont servis en statique par Express à partir de la racine du projet.

### Paramètres du dashboard (query string)

| Paramètre | Exemple | Effet |
|-----------|---------|--------|
| `bracket` | `?bracket=swiss` | ID du tournoi dans `brackets.json` (ex. `swiss`, `elite`, `amateur` ou id custom v2). |
| `match` | `?match=<checksum>` | Filtre sur un match (checksum = id côté API). |
| `team` | `?team=Nom%20Equipe` | Filtre sur le nom d’équipe. |
| `autoScrollPlayers` | `?autoScrollPlayers=1` | Active le défilement auto du tableau **joueurs** au chargement (avec cookie associé). |
| `autoScrollTeams` | `?autoScrollTeams=1` | Idem pour **équipes**. |
| `autoScroll` | `?autoScroll=1` ou `0` | **Ancien format** : `1` active les deux défilements, `0` les désactive ; prioritaire sur les paramètres ci‑dessus si présent. |
| `player` | `?player=<steam_id>` | À l’issue du chargement des données, ouvre l’overlay joueur puis retire ce paramètre de l’URL (`replaceState`). |

Les filtres bracket / match / team et les options de défilement actives sont aussi écrits dans l’URL lors des changements (partage, favoris).

---

## API HTTP

Toutes les routes API sont servies par **`server.js`** (Express). Préfixe d’URL : origine du site (ex. `http://localhost:3000`).

### Statistiques et match

| Méthode | Route | Description |
|---------|--------|-------------|
| **GET** | `/api/stats` | Corps JSON : `{ players, matches, teams }`. Données issues de PostgreSQL ; avatars Steam si `STEAM_API_KEY` ; `custom_avatar_url` / logos équipe depuis `uploads/`. Chaque élément de `matches` peut inclure `demo_download_url` et `demo_download_filename` si une démo est trouvée sous `data/demo/` (voir ci‑dessous). |
| **GET** | `/api/match/:checksum` | `{ match, players }` pour un checksum ; même enrichissements possibles sur `match` (téléchargement démo). |

### Téléchargement de démo (fichiers sur disque)

| Méthode | Route | Description |
|---------|--------|-------------|
| **GET** | `/api/demos/download?file=<nom>.dem&server=<dossier>` | Envoie le fichier en pièce jointe. `server` omis si le `.dem` est à la racine de `data/demo/`. Paramètres validés (pas de `..`, pas de séparateurs de chemin dans `file` / `server`). |

### Brackets

| Méthode | Route | Description |
|---------|--------|-------------|
| **GET** | `/api/brackets` | Objet brackets **v2** (`schemaVersion`, `tournaments`) lu depuis `data/brackets.json` (création/normalisation au besoin). Enrichi avec `teamsFromDb` et `matchesFromDb` si la base est joignable (autocomplétion admin). |
| **POST** | `/api/brackets/auth` | Body JSON `{ "password": "..." }` → `{ "token": "..." }` si `BRACKETS_ADMIN_PASSWORD` est défini et correct. |
| **POST** | `/api/brackets` | Header `Authorization: Bearer <token>`. Body JSON (champs principaux) : `tournamentId` (ou `section`), `lane` (`upper` / `lower` / `grand` / `swiss`), `roundIndex`, `matchIndex`, `teamA`, `teamB`, `winner`, optionnel `demoId`, `demoIds`, `bestOf`, `lowerBracket`. Met à jour un match puis persiste le fichier. Réponse `{ ok: true, brackets }`. |

### Admin panel

| Méthode | Route | Description |
|---------|--------|-------------|
| **POST** | `/api/admin/auth` | `{ password }` → `{ token }` (si `ADMIN_PASSWORD`). |
| **POST** | `/api/admin/avatar/:steamid` | Multipart, champ fichier image ; nécessite Bearer token admin. |
| **DELETE** | `/api/admin/avatar/:steamid` | Supprime l’avatar personnalisé. |
| **GET** | `/api/avatars/:steamid` | Sert l’image si elle existe. |
| **POST** | `/api/admin/team-logo/:teamname` | Multipart, logo équipe. |
| **DELETE** | `/api/admin/team-logo/:teamname` | Supprime le logo. |
| **GET** | `/api/team-logos/:slug` | Sert le logo (slug dérivé du nom d’équipe). |

### Fichiers statiques

Express sert le répertoire racine du projet (`express.static`), d’où l’accès direct à `index.html`, `data/…`, etc. selon ce qui est présent et non exclu par la configuration réseau.

---

## Données fichiers (`data/`, `uploads/`)

### `data/brackets.json`

- **Rôle** : source unique des brackets affichés et édités.
- **Format cible** : `schemaVersion: 2` et tableau `tournaments` (voir `lib/brackets-model.js`).
- **Non versionné** par défaut (`.gitignore` ignore souvent tout `data/` — adapter selon votre politique).
- **Réinitialisation** : `npm run reset-brackets`.

### Dossier `data/import/` (optionnel)

- Fichiers **sources** au format plus ancien : `brackets.json` (legacy ou v2), `players.json` (`matches` + `players`).
- **Conversion** vers les fichiers « runtime » : `npm run import:data` (voir [Import](#import-depuis-dataimport)).

### Fichier stats statique `data/players.json`

- Utilisé si `window.HELLOVIEW_API_URL` pointe vers ce fichier.
- Forme alignée sur `/api/stats` : au minimum `players`, `matches`, et de préférence `teams`.
- **`statsFileVersion`** (entier, actuellement `1`) : métadonnée pour futures migrations ; voir `lib/stats-file-model.js`.
- Les champs `demo_download_*` ne sont pas produits par ce JSON statique ; le bouton **demo** n’apparaît qu’avec l’API serveur et `data/demo/` rempli.

### `uploads/avatars/` et `uploads/team-logos/`

- Créés à l’upload ; **non versionnés** (`.gitignore`).

---

## Démos hébergées et téléchargement

1. Placer les fichiers **`.dem`** sous **`data/demo/`**, idéalement par **sous-dossier serveur** (ex. `data/demo/81.201.191.200/partie.dem`).
2. La colonne PostgreSQL **`matches.demo_path`** contient un chemin absolu ou réseau (Windows, etc.) ; seul le **nom de fichier final** (basename) est comparé au nom des fichiers sur disque, **sans tenir compte de la casse**.
3. Si correspondance : l’API ajoute à l’objet match `demo_download_url` (vers `/api/demos/download?...`) et `demo_download_filename`.
4. L’**overlay match** (`common.js`) affiche le libellé **demo** et un **bouton** portant le nom du fichier ; clic → téléchargement.
5. L’index des fichiers est **mis en cache** environ **60 secondes** (`lib/demo-host-files.js`) ; ajout de nouveaux fichiers peut prendre jusqu’à une minute sans redémarrage du serveur.

---

## Import depuis `data/import/`

```bash
npm run import:data
```

- Lit **`data/import/brackets.json`** et **`data/import/players.json`** (chemins surchargeables via `--import-dir`, `--out-dir`, ou variables `HELLOVIEW_IMPORT_DIR`, `HELLOVIEW_DATA_DIR`).
- Écrit **`data/brackets.json`** (normalisé v2) et **`data/players.json`** (avec `statsFileVersion`, équipes dérivées si besoin, enrichissement des noms d’équipe sur les matchs).
- **`--dry-run`** : affiche un résumé sans écrire.

Conversion **stdout** legacy → v2 uniquement :

```bash
node scripts/brackets-legacy-to-v2.js chemin/brackets.json > sortie.v2.json
```

---

## Scripts npm et utilitaires

| Script | Commande | Rôle |
|--------|----------|------|
| `start` | `npm start` | Serveur Express (API + statiques). |
| `serve-static` | `npm run serve-static` | `npx serve .` (pas d’API locale). |
| `import:data` | `npm run import:data` | Import `data/import/*` → `data/*`. |
| `reset-brackets` | `npm run reset-brackets` | Réinitialise `data/brackets.json`. |
| `inspect-db` | `npm run inspect-db` | Inspection schéma + échantillons PostgreSQL. |
| `export-table` | `npm run export-table -- <table>` | Export JSON d’une table sur stdout. |
| `export-db` | `npm run export-db` | Export complet (fichier configurable dans le script). |

Autres scripts Node utiles dans `scripts/` : `parse-players.js` (export SQL COPY → JSON stats versionné), `inspect-schema.sql` (référence psql).

---

## Structure du dépôt

```
helloview/
├── server.js              # Express : routes API, statiques, auth
├── index.html, app.js, style.css
├── brackets.html, brackets.js, brackets.css
├── admin.html, admin.js, admin.css
├── common.js, common.css   # Overlays match / joueur / équipe, footer
├── package.json
├── .env                    # (local) configuration
├── .gitignore
├── lib/
│   ├── brackets-model.js  # Schéma brackets v2, legacy → v2, BO3, liens
│   ├── stats-file-model.js# Versionnement et normalisation players.json
│   └── demo-host-files.js # Index .dem sous data/demo/, basename, download
├── scripts/
│   ├── import-to-data.js
│   ├── brackets-legacy-to-v2.js
│   ├── reset-brackets.js
│   ├── parse-players.js
│   ├── inspect-db.js
│   └── inspect-schema.sql
├── data/                   # brackets.json, import/, demo/, players.json (selon usage)
├── uploads/                # avatars, team-logos
└── docs/
    └── SCHEMA-ANALYSIS.md  # Tables PostgreSQL utiles à HelloView
```

---

## Bibliothèques serveur (`lib/`)

| Module | Rôle |
|--------|------|
| **`brackets-model.js`** | Constante `SCHEMA_VERSION`, normalisation des matchs (`demoIds`, `bestOf`, liens), conversion **legacy** `{ swiss, elite, amateur }` → **v2** `tournaments`, application des mises à jour admin, calcul vainqueur BO3 à partir des `winner_name` en base. |
| **`stats-file-model.js`** | `STATS_FILE_VERSION`, `normalizeStatsPayload`, `parseStatsFileContent` ; enrichit `matches` avec `team_a_name` / `team_b_name` depuis les joueurs ; construit `teams` si absents. |
| **`demo-host-files.js`** | Scan de `data/demo/`, map basename → `{ server, file }`, résolution sécurisée des chemins pour `/api/demos/download`. |

---

## Schéma brackets (résumé)

- Un fichier v2 contient plusieurs **tournois** (`tournaments[]`), chacun avec `id`, `title`, `type` (`swiss` ou `elimination`), et la structure adaptée (`rounds` pour Swiss ; `upperRounds`, `lowerRounds`, `grandFinale` pour l’élimination, selon les données).
- Chaque match porte des équipes, un vainqueur, des identifiants de démo (`demoId` / `demoIds`), `bestOf` (1 ou 3), et éventuellement des **liens** entre cellules pour l’UI.
- Le **filtre Bracket** du dashboard utilise les checksums présents dans le graphe du tournoi sélectionné pour filtrer joueurs et équipes.

---

## Documentation PostgreSQL

Le fichier **`docs/SCHEMA-ANALYSIS.md`** décrit les tables **`matches`**, **`players`**, **`teams`**, **`demos`**, **`rounds`**, les overrides de noms Steam, et la colonne **`demo_path`** pour le rapprochement avec les fichiers `.dem`.

---

## Licence et crédits

HelloView — réalisé et hébergé avec soin par [Nemavio](https://x.com/nemavdotio) pour la [HelloWorld!Nexen](https://esport.helloworldedhec.com/).
