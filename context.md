# Contexte actuel du projet

Dernière mise à jour : 20 septembre 2026.

## Objectif

Construire une application web mobile-first de trésorerie pour une association bénévole française. L’application couvre les comptes, opérations, factures et justificatifs, projets, catégories, configuration de l’association et analyse documentaire locale ou assistée par IA.

La spécification fonctionnelle complète d’origine se trouve dans `association_tresorerie_spec_v2.md`.

## Emplacement et lancement

Racine du projet :

```text
/home/loundor/Bureau/Asso/treso
```

Application Docker actuellement prévue sur :

```text
http://localhost:8080
```

Compte de démonstration administrateur :

```text
E-mail : tresorier@demo.fr
Mot de passe : demo1234
```

Commandes principales :

```bash
npm run install:all
npm run check
docker compose up --build -d
docker compose ps
curl http://localhost:8080/api/health
```

## Stack actuelle

- Frontend : Svelte 5, TypeScript, Vite.
- Backend : Node.js 22, TypeScript, Fastify 5.
- Base : PostgreSQL 17.
- Authentification : JWT et mots de passe BCrypt.
- OCR image : Tesseract.js, français et anglais.
- Lecture PDF textuel : `pdf-parse`.
- OAuth OpenAI : client officiel `@openai/codex`.
- Reverse proxy et fichiers frontend : Nginx.
- Déploiement local : Docker Compose.

## Fonctionnalités disponibles

### Accès et rôles

- Connexion par e-mail et mot de passe.
- Session JWT stockée côté navigateur.
- Rôles disponibles : `ADMIN`, `TRESORIER`, `PRESIDENT`, `BUREAU`, `BENEVOLE`.
- Configuration visible uniquement par les administrateurs.
- Création, modification, activation et suppression d’utilisateurs.
- Un administrateur ne peut pas supprimer son propre compte.

### Trésorerie

- Tableau de bord avec solde, recettes, dépenses et exercice fiscal.
- Comptes bancaires et solde calculé.
- CRUD des opérations.
- Import CSV bancaire avec détection de doublons.
- Export CSV.
- Catégorisation et rattachement à un projet.

### Projets, sous-projets et rubriques

- Un projet peut avoir un projet parent.
- Les cycles de projets sont interdits par l’API et PostgreSQL.
- Un projet contenant des sous-projets ne peut pas être supprimé.
- Une catégorie peut être globale ou rattachée à un projet ; une catégorie rattachée sert de rubrique analytique du projet.
- Les catégories peuvent également avoir un parent.
- Une catégorie enfant doit conserver le même type et le même projet que son parent.

### Factures et documents

- Bouton principal de capture/import de facture.
- Prise de photo sur téléphone ou choix d’une image/PDF.
- Formats acceptés : JPEG, PNG, WEBP et PDF.
- Taille maximale : 10 Mo.
- Optimisation des photos volumineuses dans le navigateur avant envoi.
- Vérification de la signature réelle du fichier côté serveur.
- Stockage privé des originaux sur le serveur par date :

```text
/annee/mois/jour/uuid.extension
```

- OCR local et extraction du fournisseur, destinataire, numéro, date, HT, TVA et TTC.
- Tous les champs sont modifiables avant validation.
- La facture n’est créée qu’après validation explicite.
- Consultation ultérieure de l’image ou du PDF archivé.

### Ventilation analytique des factures

- Une facture peut être affectée entièrement ou partiellement.
- Plusieurs lignes de ventilation sont possibles.
- Chaque ligne peut cibler un projet, une catégorie/rubrique, ou les deux.
- Le montant de chaque ligne est positif.
- Le total ventilé ne peut pas dépasser la valeur absolue du TTC.
- Le remplacement des ventilations est atomique.
- Une rubrique propre à un projet ne peut pas être utilisée avec un autre projet.
- La liste des factures affiche l’état `Non affectée`, `Partielle` ou `Complète`.
- Les ventilations peuvent être modifiées depuis la liste des factures.

Les ventilations analytiques de facture sont séparées des opérations bancaires afin de ne pas compter deux fois une même dépense.

### Configuration de l’association

- Informations générales de l’association.
- Jour et mois de début d’exercice.
- Gestion des membres de l’association.
- Indicateur de conformité au minimum de sept membres souhaité pour une association alsacienne.
- Gestion des utilisateurs et rôles.
- Informations de connexion PostgreSQL et test de connexion.
- Configuration de l’IA.

### Intelligence artificielle

Fournisseurs disponibles :

- Google Gemini / Antigravity : mode CLI (`agy`) ou clé API Google AI Studio.
- OpenAI : clé API ou OAuth (Codex).
- OpenRouter : clé API ou OAuth.
- Anthropic Claude : clé API.
- Mistral : clé API.

L’utilisation de l’IA est facultative pour chaque document. L’OCR local reste la source de repli si l’IA est désactivée ou échoue.

#### Mode CLI / TUI avec Antigravity agy

Le mode CLI permet d'utiliser les capacités multimodales des modèles (ex. `gemini-3.8-flash-high`) directement via l'exécutable local `agy` :
1. Le backend transmet le document réel (PDF, JPEG, PNG, WEBP) via `--add-dir` et chemin absolu.
2. Un fichier de consignes Markdown dédié (`backend/prompts/analyse_justificatif.md`) décrit les champs comptables attendus (`supplier`, `recipient`, `invoiceNumber`, `invoiceDate`, `totalHt`, `vatAmount`, `totalTtc`), le format des montants et l'interdiction d'inventer des informations.
3. Le texte OCR brut est joint à titre d'assistance contextuelle.
4. L'appel non interactif `--print` avec `--dangerously-skip-permissions`, `--json-schema` et `--output-format json` produit directement un JSON structuré valide.
5. Les champs extraits sont fusionnés et préremplissent la page de validation de la facture.

#### OpenAI OAuth

Le flux utilise `codex login --device-auth` :

1. le backend démarre le client officiel Codex ;
2. l’interface ouvre `https://auth.openai.com/codex/device` ;
3. l’utilisateur saisit le code temporaire affiché ;
4. le frontend interroge le statut jusqu’à validation ;
5. Codex conserve et renouvelle ses propres credentials sous `CODEX_HOME`.

Les credentials sont conservés dans le volume Docker `codex-credentials` monté dans `/app/codex-data`.

La panne précédente a été corrigée en :

- installant `ca-certificates` dans l’image backend ;
- acceptant les codes Codex au format actuel `4-5` et les variantes `4-4` à `4-8` ;
- supprimant les séquences ANSI avant analyse ;
- gérant les sorties découpées en plusieurs chunks ;
- sécurisant les annulations, expirations et courses entre tentatives.

#### OpenRouter OAuth

Le flux utilise l’URL officielle `https://openrouter.ai/auth`, PKCE S256, un état aléatoire et l’échange du code contre une clé OpenRouter. Le callback local est autorisé sur `localhost` en développement.

## Dernières modifications réalisées

- Ajout de l'intégration du CLI Antigravity (`agy`) pour l'analyse multimodale de justificatifs (PDF / images) avec consignes Markdown.
- Création du prompt Markdown officiel d'analyse comptable : `backend/prompts/analyse_justificatif.md`.
- Installation native de `agy` dans l'image Docker backend (`backend/Dockerfile`) avec `tini` pour la gestion des sous-processus.
- Ajout du volume persistant `gemini-credentials` dans `compose.yaml` monté sur `/home/node/.gemini`.
- Correction du test de connexion IA (`POST /api/config/ai/test`) : prise en compte des valeurs candidates du formulaire en cours sans forcer l'activation préalable en base de données, éliminant le bandeau rouge d'erreur.
- Détection instantanée des demandes d'authentification interactive de `agy` avec message d'orientation explicite vers le terminal web.
- Implémentation du gestionnaire de terminal pseudo-PTY (`backend/src/services/terminal.ts`) avec endpoints SSE et envoi de saisie (`/api/config/ai/terminal/*`).
- Création du composant modal xterm.js interactif (`frontend/src/components/TerminalModal.svelte`) permettant la saisie du code OAuth de connexion Google directement dans le conteneur.
- Configuration de Nginx (`frontend/nginx.conf`) avec `proxy_buffering off` et `proxy_read_timeout 3600s` pour le streaming SSE en direct.
- Création du service backend `backend/src/services/agy.ts` (détection du binaire, extraction structurée JSON, timeouts et gestion d'erreurs).
- Prise en charge de Google Gemini comme fournisseur IA (`api_key` ou `cli` avec `agy`).
- Mise à jour du schéma et contrainte `ai_settings.auth_mode` pour accepter `'cli'`.
- Mise à jour des routes `backend/src/routes/configuration.ts` et `backend/src/routes/documents.ts` (passage du chemin de fichier réel à l'IA).
- Mise à jour de l'interface d'administration `frontend/src/pages/Configuration.svelte` (sélection de Gemini, mode CLI agy sans clé requise, bouton d'ouverture du terminal interactif).
- Ajout des tests unitaires `backend/test/agy.test.ts` et enrichissement de `backend/test/ai.test.ts`.
- Correction du flux OAuth OpenAI dans `backend/src/services/codex.ts` et `backend/Dockerfile`.
- Ajout de `projects.parent_id` et des protections anti-cycle.
- Ajout de `categories.project_id` pour les rubriques de projet.
- Ajout de la table `invoice_allocations`.

## Validation effectuée

Dernier état validé :

- 22 tests backend réussis ;
- compilation TypeScript backend réussie ;
- `svelte-check` : 0 erreur, 0 avertissement ;
- build Vite réussi ;
- conteneurs Docker `database`, `backend`, `frontend` opérationnels et sains ;
- endpoint `/api/health` opérationnel (HTTP 200) ;
- endpoint `/api/config/ai/test` vérifié : détection rapide et retour du message d'authentification sans blocage ;
- cycle de vie du terminal interactif validé (`/start`, flux SSE `/stream`, et `/stop`) ;
- volume persistant `gemini-credentials` vérifié.

## Fichiers principaux récemment concernés

```text
backend/Dockerfile
backend/prompts/analyse_justificatif.md
backend/sql/001_init.sql
backend/src/config.ts
backend/src/routes/configuration.ts
backend/src/routes/documents.ts
backend/src/services/agy.ts
backend/src/services/ai.ts
backend/src/services/terminal.ts
backend/test/agy.test.ts
backend/test/ai.test.ts
compose.yaml
frontend/nginx.conf
frontend/package.json
frontend/src/components/TerminalModal.svelte
frontend/src/lib/types.ts
frontend/src/pages/Configuration.svelte
```

## Contraintes et décisions importantes

- L’interface et les messages doivent rester en français.
- Le design est mobile-first, vert/ivoire.
- Les originaux des documents doivent rester privés et stockés localement.
- Ne jamais journaliser les clés API, tokens OAuth, mots de passe ou codes temporaires.
- Ne pas utiliser un token OAuth ChatGPT/Codex directement sur l’API standard OpenAI `/v1/chat/completions`.
- OpenAI OAuth passe par le client officiel Codex.
- OpenRouter conserve son implémentation OAuth PKCE spécifique.
- Une bibliothèque générale de fournisseurs ne supprime pas la nécessité de flux OAuth propres à chaque fournisseur.
- Le SQL actuel est idempotent et rejoué au démarrage ; une vraie table de versions de migrations serait préférable lorsque le projet grandira.
- Le dépôt est encore largement non suivi par Git ; ne pas supprimer ou réinitialiser les fichiers existants.

## Limites et dette technique connues

- Les PDF image sans couche texte ne sont pas OCRisés page par page : ils sont conservés, mais l’utilisateur doit actuellement importer une image pour OCR.
- Le rapprochement historique facture/opération repose encore sur `documents.transaction_id` et `invoices.transaction_id`. Les ventilations analytiques sont volontairement distinctes.
- Le tableau de bord utilise encore les liens document/opération historiques pour certains compteurs.
- Le champ sens/type du document est présent dans l’analyse et l’UI mais n’est pas encore persisté comme colonnes dédiées de `invoices`.
- La configuration chiffre les secrets applicatifs avec une clé dérivée de `JWT_SECRET`. En production, une clé de chiffrement distincte serait préférable.
- `JWT_SECRET` et le mot de passe PostgreSQL par défaut doivent impérativement être changés en production.
- Un audit npm antérieur signalait des vulnérabilités transitives dans `fast-jwt` via `@fastify/jwt@9.1.0`. La correction implique une montée majeure vers `@fastify/jwt@10` et doit être traitée séparément avec tests de compatibilité.
- L’endpoint OpenRouter complet a été vérifié jusqu’à la génération PKCE ; la finalisation nécessite l’autorisation interactive de l’utilisateur sur OpenRouter.
