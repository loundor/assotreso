# Schéma de la base de données

Ce document représente le schéma PostgreSQL défini dans [`backend/sql/001_init.sql`](backend/sql/001_init.sql).

## Diagramme entité–relation

```mermaid
erDiagram
    USERS {
        UUID id PK
        TEXT email UK
        TEXT password_hash
        TEXT name
        TEXT role
        BOOLEAN active
        TIMESTAMPTZ created_at
    }

    ACCOUNTS {
        UUID id PK
        TEXT name
        TEXT type
        TEXT bank
        TEXT bank_address
        TEXT manager_name
        TEXT iban
        TEXT rib
        TEXT contract_filename
        TEXT contract_path
        TEXT contract_mime
        BOOLEAN bankin_connected
        TEXT bankin_account_id
        TIMESTAMPTZ last_synced_at
        NUMERIC initial_balance
        CHAR currency
        BOOLEAN active
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    PROJECTS {
        UUID id PK
        TEXT name UK
        TEXT description
        NUMERIC budget
        DATE starts_on
        DATE ends_on
        BOOLEAN active
        UUID parent_id FK
        TEXT status
        TEXT status_reason
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    CATEGORIES {
        UUID id PK
        TEXT name
        TEXT kind
        UUID parent_id FK
        UUID project_id FK
        TEXT color
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    TRANSACTIONS {
        UUID id PK
        UUID account_id FK
        DATE operation_date
        NUMERIC amount
        TEXT type
        TEXT bank_label
        TEXT description
        UUID category_id FK
        UUID project_id FK
        TEXT supplier
        TEXT bank_reference
        TEXT reconciliation_status
        TEXT payment_method
        TEXT comment
        UUID modified_by FK
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    DOCUMENTS {
        UUID id PK
        TEXT original_name
        TEXT stored_name UK
        TEXT mime_type
        INTEGER size_bytes
        UUID uploaded_by FK
        UUID transaction_id FK
        TEXT ocr_text
        JSONB analysis
        TEXT status
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    INVOICES {
        UUID id PK
        UUID document_id FK,UK
        UUID transaction_id FK
        TEXT supplier
        TEXT recipient
        DATE invoice_date
        NUMERIC total_ttc
        NUMERIC total_ht
        NUMERIC vat_amount
        TEXT invoice_number
        TEXT siret
        TEXT payment_method
        TEXT email
        TEXT direction
        UUID validated_by FK
        TIMESTAMPTZ validated_at
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    INVOICE_ALLOCATIONS {
        UUID id PK
        UUID invoice_id FK
        UUID project_id FK
        UUID category_id FK
        NUMERIC amount
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    INVOICE_RECONCILIATIONS {
        UUID id PK
        UUID invoice_id FK
        UUID transaction_id FK
        NUMERIC reconciled_amount
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    AUDIT_LOGS {
        BIGSERIAL id PK
        UUID user_id FK
        TEXT action
        TEXT entity_type
        TEXT entity_id
        JSONB details
        TIMESTAMPTZ created_at
    }

    ASSOCIATION_SETTINGS {
        SMALLINT id PK
        TEXT name
        TEXT acronym
        TEXT legal_form
        TEXT legal_name
        TEXT website
        TEXT address
        TEXT address_line2
        TEXT postal_code
        TEXT city
        TEXT country
        TEXT email
        TEXT phone
        TEXT siret
        TEXT rna
        SMALLINT fiscal_start_day
        SMALLINT fiscal_start_month
        TEXT logo_path
        TEXT logo_mime
        TIMESTAMPTZ updated_at
    }

    APP_SETTINGS {
        SMALLINT id PK
        BOOLEAN demo_mode
        TIMESTAMPTZ demo_seeded_at
        TIMESTAMPTZ updated_at
    }

    ASSOCIATION_MEMBERS {
        UUID id PK
        TEXT first_name
        TEXT last_name
        TEXT email
        TEXT phone
        TEXT address
        TEXT postal_code
        TEXT city
        TEXT function
        DATE joined_on
        BOOLEAN active
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    AI_SETTINGS {
        SMALLINT id PK
        BOOLEAN enabled
        TEXT provider
        TEXT auth_mode
        TEXT base_url
        TEXT model
        TEXT encrypted_secret
        TEXT oauth_status
        TIMESTAMPTZ updated_at
    }

    AI_OAUTH_FLOWS {
        TEXT state PK
        TEXT provider
        TEXT code_verifier
        UUID created_by FK
        TIMESTAMPTZ expires_at
        TIMESTAMPTZ created_at
    }

    ACCOUNTS ||--o{ TRANSACTIONS : contient
    USERS o|--o{ TRANSACTIONS : modifie
    CATEGORIES o|--o{ TRANSACTIONS : classe
    PROJECTS o|--o{ TRANSACTIONS : affecte

    PROJECTS o|--o{ PROJECTS : parent_de
    CATEGORIES o|--o{ CATEGORIES : parent_de
    PROJECTS o|--o{ CATEGORIES : regroupe

    USERS o|--o{ DOCUMENTS : televerse
    TRANSACTIONS o|--o{ DOCUMENTS : justifie
    DOCUMENTS ||--o| INVOICES : produit
    USERS o|--o{ INVOICES : valide
    TRANSACTIONS o|--o{ INVOICES : lie_directement

    INVOICES ||--o{ INVOICE_ALLOCATIONS : ventile
    PROJECTS o|--o{ INVOICE_ALLOCATIONS : recoit
    CATEGORIES o|--o{ INVOICE_ALLOCATIONS : classe

    INVOICES ||--o{ INVOICE_RECONCILIATIONS : rapproche
    TRANSACTIONS ||--o{ INVOICE_RECONCILIATIONS : rapproche

    USERS o|--o{ AUDIT_LOGS : declenche
    USERS o|--o{ AI_OAUTH_FLOWS : initialise
```

## Lecture des cardinalités

| Symbole | Signification |
|---|---|
| `||` | exactement un |
| `o|` | zéro ou un |
| `o{` | zéro ou plusieurs |
| `|{` | un ou plusieurs |

## Tables singleton

Les tables suivantes contiennent une seule ligne, imposée par la contrainte `CHECK (id = 1)` :

- `association_settings` : identité, coordonnées, exercice fiscal et logo de l’association ;
- `app_settings` : mode démonstration et date d’initialisation des données de démonstration ;
- `ai_settings` : fournisseur, modèle et authentification du service d’intelligence artificielle.

`association_settings`, `app_settings` et `ai_settings` sont volontairement isolées dans le diagramme : elles ne possèdent aucune clé étrangère.

`association_members` est également indépendante. Elle représente les membres de l’association, tandis que `users` représente les comptes autorisés à se connecter à l’application.

## Contraintes principales

### Utilisateurs

- `users.email` est unique.
- Rôles autorisés : `ADMIN`, `TRESORIER`, `PRESIDENT`, `BUREAU`, `BENEVOLE`.

### Projets et catégories

- Un projet peut avoir un projet parent, mais pas être son propre parent ou créer un cycle.
- Une catégorie peut avoir une catégorie parente.
- Une catégorie enfant doit conserver le même projet et le même type que sa catégorie parente.
- Types de catégorie : `RECETTE`, `DEPENSE`, `MIXTE`.
- Le couple `(categories.name, categories.kind)` est unique.

### Transactions

- Une transaction appartient obligatoirement à un compte.
- Son montant ne peut pas être nul.
- La catégorie, le projet et l’utilisateur ayant effectué la dernière modification sont optionnels.
- États de rapprochement : `NON_RAPPROCHE`, `RAPPROCHE`, `A_VERIFIER`.

### Documents et factures

- Un document ne peut pas dépasser 10 Mio.
- `documents.stored_name` est unique.
- Une facture appartient obligatoirement à un document.
- `invoices.document_id` est unique : un document ne peut produire qu’une seule facture.
- Sens de facture : `RECU` ou `EMIS`.
- La suppression d’un document supprime sa facture (`ON DELETE CASCADE`).

### Ventilation des factures

- Chaque allocation appartient obligatoirement à une facture.
- Son montant doit être strictement positif.
- La somme des allocations ne peut pas dépasser la valeur absolue du montant TTC de la facture.
- Une catégorie rattachée à un projet doit correspondre au projet de l’allocation.

### Rapprochement bancaire

`invoice_reconciliations` implémente la relation plusieurs-à-plusieurs entre les factures et les transactions :

- une facture peut être réglée par plusieurs transactions ;
- une transaction peut rapprocher plusieurs factures ;
- le montant rapproché doit être strictement positif ;
- le couple `(invoice_id, transaction_id)` est unique.

La colonne historique `invoices.transaction_id` reste présente parallèlement à cette table de rapprochement.

## Comportements de suppression

| Relation | Comportement |
|---|---|
| Compte → transactions | `RESTRICT` |
| Projet parent → projets enfants | `RESTRICT` |
| Projet → catégories | `RESTRICT` |
| Catégorie parente → catégories enfants | `SET NULL` |
| Catégorie/projet → transactions | `SET NULL` |
| Utilisateur → références métier | `SET NULL`, sauf flux OAuth en `CASCADE` |
| Transaction → documents/factures | `SET NULL` |
| Document → facture | `CASCADE` |
| Facture → allocations | `CASCADE` |
| Facture/transaction → rapprochements | `CASCADE` |
