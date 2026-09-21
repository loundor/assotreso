# Trésorerie associative

MVP web responsive de gestion de trésorerie pour une association bénévole, construit à partir de `association_tresorerie_spec_v2.md`.

## Fonctionnalités disponibles

- connexion sécurisée par JWT ;
- tableau de bord financier ;
- comptes, transactions, catégories et projets ;
- import et export CSV des transactions ;
- capture photo mobile ou import d’une facture image/PDF ;
- OCR local des images avec Tesseract et lecture des PDF textuels ;
- extraction du fournisseur, de la date, du numéro et des montants ;
- récapitulatif intégralement modifiable avant validation ;
- création de la facture uniquement après confirmation explicite ;
- archivage local des justificatifs et journal d’audit.

## Démarrage rapide avec Docker

Prérequis : Docker et Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

L’application est ensuite disponible sur <http://localhost:8080>.

Par défaut, `DEMO_MODE=false` : aucune donnée métier ni aucun utilisateur n’est créé. À la première ouverture, l’écran **Première utilisation** permet de créer le premier compte administrateur.

Pour lancer explicitement une démonstration avec `backend/sql/002_demo_seed.sql` :

```bash
DEMO_MODE=true docker compose up --build
```

Le compte de démonstration est alors :

- e-mail : `tresorier@demo.fr`
- mot de passe : `demo1234`

Le mode réellement appliqué est enregistré en base. Le seed démo n’est exécuté qu’une fois, sur une base vide, et n’est jamais rejoué lors des redémarrages.

> Modifiez impérativement `POSTGRES_PASSWORD` et `JWT_SECRET` dans `.env` avant une mise en production.

Les migrations sont appliquées automatiquement au démarrage. Les données PostgreSQL et les documents sont conservés dans des volumes Docker. Changer `DEMO_MODE` ou reconstruire les images ne vide pas un volume existant. Pour repartir volontairement d’une base vierge, utilisez `docker compose down -v` avant de relancer — cette commande supprime définitivement les données locales.

## Développement local

Prérequis : Node.js 20+, npm et PostgreSQL.

```bash
npm run install:all
cp backend/.env.example backend/.env
npm run dev:api
```

Dans un second terminal :

```bash
npm run dev:web
```

- interface : <http://localhost:5173>
- API : <http://localhost:3000/api>
- santé : <http://localhost:3000/api/health>

Vite transmet automatiquement les requêtes `/api` au backend local.

## Vérifications

```bash
npm run check
```

Cette commande compile et teste l’API, vérifie les composants Svelte, puis construit l’interface de production.

## Architecture

```text
frontend/   Svelte 5 + Vite, servi par Nginx en production
backend/    Fastify + TypeScript, OCR et stockage documentaire
PostgreSQL  persistance métier et audit
```

Le reverse proxy Nginx du conteneur frontend transmet `/api` au backend. Pour une installation derrière Traefik, routez le domaine vers le service `frontend` sur son port `80` et conservez le backend sur le réseau interne.

## OCR, IA et confidentialité

- **OCR local par défaut** : exécuté localement par le backend (Tesseract pour les images et `pdf-parse` pour les PDF textuels) sans aucun envoi vers l’extérieur.
- **Assistance IA (optionnelle)** : configurable par l’administrateur :
  - **Ligne de commande (CLI / agy)** : délègue l’analyse multimodale directe au CLI `agy` (ex. modèles `gemini-3.8-flash-high`) en lui transmettant le document original (image/PDF) et les instructions du prompt Markdown (`prompts/analyse_justificatif.md`) pour obtenir un JSON de synthèse sans dépendance à une clé d'API tierce.
  - **API Cloud / OAuth** : Google Gemini (clé API), OpenAI (clé API ou Codex OAuth), OpenRouter (clé API ou PKCE OAuth), Anthropic Claude ou Mistral AI.

## Sauvegarde

Sauvegardez ensemble :

1. la base PostgreSQL (`pg_dump`) ;
2. le volume `document-storage` contenant les originaux.

La restauration doit préserver les identifiants des documents afin de conserver les liens entre la base et les fichiers.
