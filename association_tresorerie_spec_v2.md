# Application Web de Trésorerie pour Association Bénévole

## 1. Objectif

Créer une application web simple permettant à une petite association gérée par des bénévoles de suivre sa trésorerie, ses dépenses, ses recettes, ses justificatifs et l’état de ses comptes.

Le but principal est de remplacer les fichiers Excel dispersés, les factures papier et les suivis manuels par une interface unique, claire et facile à utiliser.

L’application doit permettre au trésorier de :

- suivre les mouvements bancaires ;
- importer des relevés CSV ;
- associer automatiquement ou manuellement des justificatifs ;
- scanner des factures et tickets avec OCR ;
- catégoriser les dépenses et recettes ;
- suivre le budget ;
- préparer un bilan ou une balance simple ;
- retrouver rapidement une pièce comptable ;
- exporter les données pour l’assemblée générale ou pour un comptable ;
- conserver un historique fiable des opérations.

L’application vise en priorité les petites associations sans comptabilité complexe.

---

# 2. Philosophie générale

L’application doit rester simple.

Elle ne doit pas devenir un ERP ou un logiciel comptable complet.

Le fonctionnement doit être basé sur une logique compréhensible par un bénévole non comptable :

1. Une opération bancaire apparaît.
2. Elle est catégorisée.
3. Un justificatif peut lui être associé.
4. Le système vérifie que les montants correspondent.
5. Les opérations peuvent être regroupées par projet, activité ou type de dépense.
6. Les tableaux de bord sont générés automatiquement.
7. Des projet peuvent etre creer afin de grouper des entrees/sortie pour avoir un suivi d'une manifestation par exemple, et egalement effectuer des rapport avec graphiques.

Le vocabulaire doit rester accessible.

Exemples :

- Recette
- Dépense
- Facture
- Ticket
- Cotisation
- Subvention
- Don
- Projet
- Activité
- Catégorie

---

# 3. Utilisateurs

## 3.1 Trésorier

Accès complet.

Il peut :

- importer des relevés ;
- créer ou modifier des opérations ;
- ajouter des justificatifs ;
- créer des catégories ;
- créer des budgets ;
- effectuer les rapprochements ;
- générer les rapports ;
- gérer les utilisateurs ;
- corriger les erreurs.

## 3.2 Président

Accès principalement en consultation.

Il peut :

- consulter les comptes ;
- voir les budgets ;
- consulter les dépenses ;
- consulter les justificatifs ;
- exporter des rapports.
- inclure des annotations.

Optionnellement, certaines opérations sensibles peuvent nécessiter une validation du président.

## 3.3 Membre du bureau

Accès limité.

Exemple :

- consultation ;
- ajout de justificatifs ;
- création de demandes de remboursement.

## 3.4 Bénévole

Optionnel.

Peut uniquement :

- déposer un ticket ou une facture ;
- demander un remboursement ;
- consulter ses propres demandes.

---

# 4. Tableau de bord

La page principale doit afficher immédiatement la situation financière.

Informations principales :

- solde bancaire actuel ;
- recettes du mois ;
- dépenses du mois ;
- recettes depuis le début de l’exercice (année) en cours (mois et jour de debut d exercice configurable);
- dépenses depuis le début de l’exercise (année) en cours (mois et jour de debut d exercice configurable);
- budget annuel ;
- budget consommé ;
- opérations sans justificatif ;
- justificatifs non rapprochés ;
- remboursements en attente ;
- dernières opérations.

Graphiques possibles :

- dépenses par catégorie ;
- recettes par catégorie ;
- évolution du solde ;
- dépenses par mois ;
- comparaison budget / réel.

---

# 5. Gestion des comptes

L’application doit pouvoir gérer plusieurs comptes.

Exemples :

- compte bancaire principal ;
- livret ;
- caisse espèces ;
- compte PayPal ;
- compte HelloAsso ;
- carte bancaire associative.

Structure :

```text
Compte
 ├── Nom
 ├── Type
 ├── Banque
 ├── IBAN optionnel
 ├── Solde initial
 ├── Devise
 └── Statut
```

---

# 6. Import bancaire

## 6.1 Import CSV

Première méthode recommandée pour le MVP.

Le trésorier télécharge le CSV depuis sa banque puis l’importe dans l’application.

Formats possibles :

- CSV ;
- OFX ;
- QIF ;
- CAMT.053 ultérieurement.

L’application doit permettre de définir un mapping.

Exemple :

```text
Date opération -> date
Libellé -> description
Débit -> montant négatif
Crédit -> montant positif
Référence -> référence bancaire
```

Le mapping peut être sauvegardé par banque.

---

# 7. Connexion bancaire automatique

Fonction prévue après le MVP.

Utiliser une API Open Banking / DSP2.

Exemples de fournisseurs possibles :

- Bridge ;
- Powens ;
- GoCardless Bank Account Data ;
- Tink.

Important :

La connexion bancaire doit être exclusivement en lecture seule.

L’application ne doit pas pouvoir effectuer de virements.

Le but est uniquement de récupérer :

- comptes ;
- soldes ;
- transactions.

---

# 8. Gestion des opérations

Chaque mouvement financier devient une opération.

Structure minimale :

```text
Transaction
 ├── id
 ├── compte
 ├── date
 ├── montant
 ├── type
 ├── libellé bancaire
 ├── description
 ├── catégorie
 ├── projet
 ├── fournisseur
 ├── justificatif
 ├── statut rapprochement
 ├── commentaire
 └── auteur modification
```

Types :

```text
RECETTE
DEPENSE
VIREMENT_INTERNE
REMBOURSEMENT
COTISATION
DON
SUBVENTION
AUTRE
```

---

# 9. Catégories

L’utilisateur doit pouvoir créer des catégories personnalisées.

Exemple dépenses :

```text
Matériel
├── Informatique
├── Électronique
├── Consommables
└── Outillage

Fonctionnement
├── Assurance
├── Banque
├── Téléphone
├── Internet
└── Hébergement web

Événements
├── Nourriture
├── Location
├── Communication
└── Transport
```

Exemple recettes :

```text
Cotisations
Dons
Subventions
Ventes
Événements
Sponsors
Autres recettes
```

---

# 10. Projets / activités

Une association peut avoir plusieurs activités.

Exemple :

```text
Projet : Salon 2026
Projet : Atelier électronique
Projet : Formation
Projet : Communication
Projet : Fonctionnement général
```

Une opération peut être liée à :

- une catégorie ;
- un projet ;
- les deux.

Cela permet de connaître le coût réel d’un projet.

---

# 11. Gestion des justificatifs

Formats supportés :

- PDF ;
- JPEG ;
- PNG ;
- WEBP.

Chaque justificatif doit être stocké avec :

```text
Document
 ├── fichier original
 ├── miniature
 ├── date import
 ├── utilisateur
 ├── fournisseur détecté
 ├── date détectée
 ├── montant détecté
 ├── TVA détectée
 ├── référence facture
 └── transaction associée
```

---

# 12. OCR

Lorsqu’un utilisateur dépose une facture ou un ticket, un OCR doit analyser le document.

Informations recherchées :

- nom du fournisseur ;
- date ;
- montant TTC ;
- montant HT ;
- TVA ;
- numéro de facture ;
- numéro SIRET si présent ;
- mode de paiement.
- adresse email si présent ;

Pipeline :

```text
Upload document
       ↓
Prétraitement image
       ↓
OCR
       ↓
Extraction des champs
       ↓
Proposition utilisateur
       ↓
Validation
       ↓
Association transaction
```

Le système ne doit jamais considérer automatiquement les données OCR comme certaines.

L’utilisateur doit pouvoir les corriger.

---

# 13. Rapprochement automatique

Une facture peut être rapprochée automatiquement avec une opération bancaire.

Critères :

- montant identique ;
- date proche ;
- fournisseur similaire ;
- référence éventuellement présente.

Exemple :

```text
Facture

Date : 10/09/2026
Fournisseur : Leroy Merlin
Montant : 128,40 €

Transaction bancaire

Date : 11/09/2026
Libellé : CB LEROYMERLIN MULHOUSE
Montant : -128,40 €
```

L’application peut proposer :

```text
Correspondance probable : 97 %
```

L’utilisateur confirme ensuite l’association.

---

# 14. Recherche

Recherche globale.

Recherche possible sur :

- fournisseur ;
- montant ;
- date ;
- numéro de facture ;
- catégorie ;
- projet ;
- commentaire ;
- libellé bancaire.

Exemple :

```text
leroy merlin 2026
```

ou :

```text
montant:128.40
```

---

# 15. Balance simplifiée

L’application doit pouvoir produire une balance lisible.

Exemple :

| Catégorie | Recettes | Dépenses | Solde |
|---|---:|---:|---:|
| Cotisations | 5 200 € | 0 € | +5 200 € |
| Subventions | 3 000 € | 0 € | +3 000 € |
| Matériel | 0 € | 2 450 € | -2 450 € |
| Événements | 1 500 € | 1 100 € | +400 € |
| Fonctionnement | 0 € | 980 € | -980 € |

---

# 16. Budget

Chaque catégorie ou projet peut avoir un budget.

Exemple :

```text
Budget Salon 2026

Location salle      2 000 €
Communication         500 €
Matériel             1 500 €
Transport              500 €

Total                4 500 €
```

L’application compare :

```text
Budget prévu
Dépenses réelles
Reste disponible
Pourcentage consommé
```

---

# 17. Remboursement de frais

Un bénévole peut créer une demande.

Processus :

```text
Bénévole
   ↓
Ajout ticket
   ↓
Montant OCR
   ↓
Description
   ↓
Projet
   ↓
Demande remboursement
   ↓
Validation trésorier
   ↓
Paiement
   ↓
Rapprochement bancaire
```

Statuts :

```text
BROUILLON
SOUMIS
VALIDE
REFUSE
PAYE
```

---

# 18. Cotisations

Module optionnel.

Permet de gérer :

```text
Membre
Montant cotisation
Date paiement
Mode paiement
Année
Statut
```

Exemple :

```text
Jean Dupont
Cotisation 2026
30 €
Payée
12/01/2026
```

---

# 19. Rapports

Exports possibles :

- CSV ;
- XLSX ;
- PDF.

Rapports :

- bilan annuel ;
- recettes/dépenses ;
- dépenses par catégorie ;
- dépenses par projet ;
- opérations sans justificatif ;
- remboursements ;
- cotisations ;
- budget vs réel.

---

# 20. Assemblée générale

Créer une page spéciale :

```text
Rapport financier annuel
```

Elle génère automatiquement :

- solde début année ;
- recettes ;
- dépenses ;
- résultat ;
- solde fin année ;
- répartition des dépenses ;
- répartition des recettes ;
- principaux projets.

Objectif :

produire rapidement les chiffres présentés à l’assemblée générale.

---

# 21. Audit

Toutes les modifications importantes doivent être historisées.

Structure :

```text
AuditLog
 ├── utilisateur
 ├── date
 ├── action
 ├── objet
 ├── ancienne valeur
 ├── nouvelle valeur
 └── adresse IP
```

Exemples :

```text
Transaction modifiée
Catégorie modifiée
Facture supprimée
Remboursement validé
Import bancaire effectué
```

---

# 22. Sécurité

Principes minimum :

- HTTPS obligatoire ;
- mots de passe hashés ;
- sessions sécurisées ;
- protection CSRF ;
- protection XSS ;
- contrôle des permissions ;
- logs ;
- sauvegardes.

Option recommandée :

```text
TOTP / 2FA
```

pour le trésorier et le président.

---

# 23. Stockage des documents

Les documents doivent être conservés séparément de la base.

Exemple :

```text
/data/documents/
```

ou stockage compatible S3.

Base de données :

```text
document_id
storage_path
hash_sha256
mime_type
size
```

Le SHA256 permet de détecter les doublons et vérifier l’intégrité.

---

# 24. Architecture proposée

Architecture simple :

```text
┌─────────────────────────────┐
│         Navigateur          │
│                             │
│           Svelte            │
└──────────────┬──────────────┘
               │
             HTTPS
               │
┌──────────────▼──────────────┐
│          Backend API        │
│                             │
│             Node            │
└──────┬────────┬─────────────┘
       │        │
       │        └─────────────┐
       │                      │
┌──────▼──────┐       ┌───────▼────────┐
│ PostgreSQL  │       │ Stockage fichiers│
└─────────────┘       └────────────────┘
       │
┌──────▼─────────┐
│ Worker / Queue │
│ OCR / imports  │
└────────────────┘
```

---

# 25. Stack recommandée

Proposition pragmatique :

Backend :

```text
NodeJS avec framwork et plugins necessaire.
PostgreSQL
```

Frontend :

```text
svelte avec plugins
```

OCR :

```text
PaddleOCR
ou
Tesseract
```

Traitement PDF :

```text
PyMuPDF
```

Queue :

```text
Redis
RQ ou Celery
```

Stockage :

```text
filesystem local
```

Reverse proxy :

```text
traefik déjà installer sur le système
```

Déploiement :

```text
Docker Compose
```

---

# 26. Modèle de données initial

## users

```text
id
email
password_hash
role
first_name
last_name
active
created_at
```

## accounts

```text
id
name
type
bank_name
currency
initial_balance
active
```

## transactions

```text
id
account_id
date
amount
label
description
transaction_type
category_id
project_id
supplier_id
status
bank_reference
created_at
updated_at
```

## categories

```text
id
name
parent_id
type
active
```

## projects

```text
id
name
description
start_date
end_date
budget
active
```

## suppliers

```text
id
name
address
siret
notes
```

## documents

```text
id
filename
storage_path
sha256
mime_type
size
ocr_status
ocr_text
created_at
```

## invoices

```text
id
document_id
supplier_id
invoice_number
invoice_date
amount_ht
amount_tax
amount_ttc
transaction_id
```

## expense_claims

```text
id
user_id
amount
description
project_id
status
document_id
created_at
approved_at
paid_at
```

## audit_logs

```text
id
user_id
action
entity
entity_id
old_value
new_value
created_at
```

---

# 27. API initiale

Exemple REST.

## Authentication

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

## Comptes

```text
GET  /api/accounts
POST /api/accounts
GET  /api/accounts/{id}
PUT  /api/accounts/{id}
```

## Transactions

```text
GET  /api/transactions
POST /api/transactions
GET  /api/transactions/{id}
PUT  /api/transactions/{id}
DELETE /api/transactions/{id}
```

## Imports

```text
POST /api/import/csv
GET  /api/import/{id}
```

## Documents

```text
POST /api/documents
GET  /api/documents/{id}
GET  /api/documents/{id}/file
DELETE /api/documents/{id}
```

## OCR

```text
POST /api/documents/{id}/ocr
GET  /api/documents/{id}/ocr
```

## Catégories

```text
GET  /api/categories
POST /api/categories
PUT  /api/categories/{id}
```

## Projets

```text
GET  /api/projects
POST /api/projects
PUT  /api/projects/{id}
```

## Rapports

```text
GET /api/reports/year
GET /api/reports/categories
GET /api/reports/projects
GET /api/reports/budget
```

---

# 28. Interface

Menu principal :

```text
Tableau de bord
Comptes
Transactions
Justificatifs
Factures
  └─ Scanner / importer une facture
Remboursements
Projets
Budget
Rapports
Administration
```

L’entrée `Factures` du menu principal doit proposer un bouton d’action clairement visible :

```text
Scanner / importer une facture
```

Ce bouton doit être accessible en un clic depuis le menu principal, sur ordinateur comme sur mobile. Il ouvre un choix simple entre :

- `Prendre une photo`, pour ouvrir directement l’appareil photo du téléphone lorsque celui-ci est disponible ;
- `Choisir un fichier`, pour rechercher une image ou un PDF déjà présent sur l’appareil.

Après la sélection, l’analyse OCR démarre automatiquement. L’application affiche ensuite un récapitulatif complet et modifiable avant toute validation ou création définitive de la facture.

Le design doit privilégier :

- simplicité ;
- lisibilité ;
- peu de clics ;
- interface responsive ;
- utilisation mobile pratique pour scanner les tickets.

---

# 29. Import depuis téléphone

Une fonctionnalité importante :

```text
Ajouter un justificatif
```

Depuis un téléphone :

1. ouvrir l’application ;
2. cliquer sur `Scanner / importer une facture` depuis le menu principal ou la rubrique `Factures` ;
3. choisir entre `Prendre une photo` et `Choisir un fichier` ;
4. prendre une photo ou sélectionner une image/PDF existant ;
5. lancer automatiquement l’analyse OCR ;
6. afficher le récapitulatif de toutes les informations détectées ;
7. vérifier, corriger ou compléter les informations ;
8. valider explicitement pour enregistrer la facture.

Aucune facture définitive ne doit être créée avant la validation de ce récapitulatif.

Le justificatif apparaît ensuite dans la file :

```text
Documents à rapprocher
```

---

# 30. Règles automatiques

Le système doit permettre de créer des règles.

Exemple :

```text
SI libellé contient "OVH"
ALORS catégorie = Hébergement Internet
ET fournisseur = OVH
```

Autre exemple :

```text
SI libellé contient "HELLOASSO"
ALORS type = Cotisation
```

Les règles permettent d’automatiser progressivement la comptabilité.

---

# 31. Détection des anomalies

L’application peut signaler :

```text
transaction sans justificatif
facture sans transaction
montant facture != montant bancaire
doublon possible
transaction non catégorisée
budget dépassé
facture OCR incertaine
```

---

# 32. MVP

Le MVP doit rester limité.

Fonctions du MVP :

- authentification ;
- utilisateurs ;
- un ou plusieurs comptes ;
- import CSV ;
- transactions ;
- catégories ;
- projets ;
- upload de justificatifs ;
- OCR ;
- association transaction / justificatif ;
- tableau de bord ;
- balance recettes/dépenses ;
- export CSV ;
- sauvegarde.

Ne pas intégrer immédiatement :

- connexion bancaire DSP2 ;
- gestion avancée des cotisations ;
- comptabilité double ;
- automatisation bancaire ;
- application mobile native.

---

# 33. Phase 2

Ajouter :

- règles automatiques ;
- rapprochement intelligent ;
- demandes de remboursement ;
- budgets ;
- rapports PDF ;
- gestion des cotisations ;
- multi-association ;
- notifications.

---

# 34. Phase 3

Ajouter :

- connexion bancaire Open Banking ;
- synchronisation automatique ;
- rapprochement avancé ;
- OCR amélioré ;
- détection automatique fournisseur ;
- statistiques avancées.

---

# 35. IA / LLM éventuel

Un LLM n’est pas nécessaire pour le MVP.

Il peut cependant être utilisé ultérieurement pour :

- comprendre les descriptions de factures ;
- suggérer une catégorie ;
- analyser un reçu mal structuré ;
- détecter des incohérences ;
- permettre une recherche en langage naturel.

Exemple :

```text
"Montre-moi toutes les dépenses liées au salon de septembre"
```

Le LLM ne doit jamais effectuer de modification comptable sans validation utilisateur.

---

# 36. Points importants pour le développement

Priorité absolue :

```text
Fiabilité > automatisation
```

Une erreur de classement est acceptable.

Une disparition ou modification silencieuse d’une transaction ne l’est pas.

Chaque donnée sensible doit donc être :

- historisée ;
- traçable ;
- sauvegardée.

---

# 37. Sauvegardes

Prévoir :

```text
backup PostgreSQL quotidien
backup documents quotidien
rotation des sauvegardes
```

Exemple :

```text
7 sauvegardes quotidiennes
4 sauvegardes hebdomadaires
12 sauvegardes mensuelles
```

---

# 38. RGPD

L’application peut contenir :

- noms ;
- emails ;
- informations bancaires ;
- factures ;
- coordonnées de membres.

Il faut donc prévoir :

- contrôle des accès ;
- limitation des données collectées ;
- possibilité de suppression/anonymisation ;
- journalisation ;
- sauvegardes sécurisées.

---

# 39. Exemple de workflow complet

```text
Le trésorier importe le CSV bancaire
                ↓
Les nouvelles transactions apparaissent
                ↓
Les règles automatiques catégorisent certaines opérations
                ↓
Une facture est déposée
                ↓
OCR
                ↓
Montant : 85,20 €
Fournisseur : Amazon
Date : 18/09/2026
                ↓
Recherche transaction correspondante
                ↓
CB AMAZON 85,20 €
                ↓
Proposition de rapprochement
                ↓
Validation utilisateur
                ↓
Transaction complète
                ↓
Catégorie : Matériel
Projet : Atelier électronique
                ↓
Le tableau de bord est mis à jour
```

---

# 40. Structure possible du projet

```text
association-treasury/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── imports/
│   │   ├── ocr/
│   │   ├── reports/
│   │   └── audit/
│   │
│   ├── migrations/
│   └── tests/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── views/
│   │   ├── stores/
│   │   ├── services/
│   │   └── router/
│   └── tests/
│
├── worker/
│   ├── ocr/
│   ├── matching/
│   └── imports/
│
├── docker/
├── docs/
├── tests/
│
├── docker-compose.yml
└── README.md
```

---

# 41. Tests

Minimum attendu :

## Tests unitaires

- parsing CSV ;
- calcul balance ;
- catégories ;
- rapprochement ;
- règles automatiques ;
- calcul budget.

## Tests API

- authentification ;
- permissions ;
- transactions ;
- uploads ;
- exports.

## Tests OCR

Créer un jeu de factures de test.

Mesurer :

```text
date correcte
montant correct
fournisseur correct
```

---

# 42. Critères de réussite

Le projet est considéré fonctionnel lorsqu’un trésorier peut :

1. créer l’association ;
2. créer un compte bancaire ;
3. importer un CSV ;
4. voir les transactions ;
5. catégoriser une transaction ;
6. prendre en photo une facture ;
7. récupérer automatiquement son montant ;
8. associer la facture à la transaction ;
9. consulter les dépenses par catégorie ;
10. consulter le solde ;
11. exporter les comptes de l’année.

---

# 43. Principe directeur

L’application doit permettre à un trésorier bénévole de répondre rapidement à quatre questions :

```text
Combien avons-nous ?

D’où vient l’argent ?

Où est parti l’argent ?

Avons-nous un justificatif pour chaque dépense ?
```

Si ces quatre réponses sont disponibles immédiatement, l’objectif principal de l’application est atteint.


---

# 44. Usage mobile orienté capture documentaire

L’application doit être pleinement utilisable depuis un téléphone via une interface web responsive.

Le but principal sur mobile n’est pas forcément de gérer toute la comptabilité, mais surtout de faciliter la capture immédiate de documents sur le terrain :

- tickets de caisse ;
- factures ;
- chèques ;
- notes de frais ;
- justificatifs divers.

L’utilisateur doit pouvoir, depuis son téléphone :

1. ouvrir l’application web ;
2. accéder immédiatement, depuis le menu principal ou la rubrique `Factures`, au bouton `Scanner / importer une facture` ;
3. choisir `Prendre une photo` ou `Choisir un fichier` ;
4. utiliser directement l’appareil photo ou sélectionner une image/PDF existant ;
5. prévisualiser le document ;
6. laisser l’application vérifier sa qualité ;
7. confirmer, reprendre la photo ou choisir un autre fichier ;
8. lancer automatiquement l’OCR ;
9. consulter, corriger et compléter le récapitulatif des informations extraites ;
10. valider explicitement la facture ;
11. envoyer le document vers le serveur GED ;
12. retrouver ensuite le document dans l’application bureau.

---

# 45. Contraintes ergonomiques mobile

L’interface mobile doit être pensée "capture-first".

Principes :

- très peu d’actions nécessaires ;
- gros boutons ;
- interface rapide ;
- prise de photo possible en quelques secondes ;
- lisibilité en extérieur ;
- fonctionnement correct sur écran vertical ;
- reprise simple si la photo est ratée.

Écrans minimum :

- écran de capture ;
- écran de prévisualisation ;
- écran de validation OCR ;
- écran de confirmation d’envoi ;
- file des documents à traiter.

---

# 46. Contrôle qualité automatique de la photo

Avant envoi définitif, l’application doit analyser automatiquement si la photo est exploitable.

Critères à vérifier :

- document détecté dans l’image ;
- netteté suffisante ;
- luminosité correcte ;
- contraste correct ;
- absence de flou important ;
- document complet visible ;
- cadrage suffisant ;
- orientation correcte ;
- pas de découpe du haut ou du bas ;
- pas de doigts masquant le document ;
- pas d’arrière-plan trop perturbant.

Si la photo est mauvaise, l’application doit afficher une erreur claire.

Exemples :

```text
Photo trop floue
Document mal cadré
Document incomplet
Luminosité insuffisante
Reflet trop important
Merci de reprendre la photo
```

Si la photo est jugée correcte, l’application peut passer à l’étape suivante automatiquement.

---

# 47. Recadrage automatique

Le système doit détecter les bords du document et proposer un recadrage automatique.

Cas visés :

- ticket long et étroit ;
- facture A4 ;
- chèque ;
- document plié ou légèrement incliné.

Fonctionnement :

```text
Capture image
      ↓
Détection du document
      ↓
Détection des 4 coins
      ↓
Correction de perspective
      ↓
Recadrage
      ↓
Amélioration lisibilité
      ↓
Prévisualisation utilisateur
```

L’utilisateur doit pouvoir :

- accepter le recadrage ;
- l’ajuster manuellement ;
- refaire la photo.

---

# 48. Amélioration automatique avant OCR

Avant OCR, l’image peut être préparée automatiquement.

Prétraitements possibles :

- redressement ;
- conversion en niveaux de gris ;
- augmentation du contraste ;
- réduction du bruit ;
- correction perspective ;
- accentuation légère ;
- séparation fond/document.

Objectif :

augmenter la qualité de lecture OCR et la lisibilité archivistique.

---

# 49. Analyse documentaire OCR avancée

Le moteur OCR ne doit pas seulement lire du texte brut.

Il doit essayer d’extraire une structure exploitable.

Informations attendues selon le type de document :

## Ticket de caisse

- enseigne ;
- date ;
- heure ;
- total TTC ;
- moyen de paiement si visible ;
- liste des articles ;
- TVA ;
- adresse éventuelle.

## Facture

- fournisseur ;
- client si présent ;
- date facture ;
- numéro de facture ;
- montant HT ;
- TVA ;
- montant TTC ;
- échéance si présente ;
- lignes produits/services ;
- référence commande éventuelle.

## Chèque

- banque si visible ;
- montant ;
- date ;
- ordre / bénéficiaire ;
- émetteur si identifiable ;
- numéro de chèque si visible.

---

# 50. Détermination du sens financier

L’application doit tenter de déterminer si le document correspond à :

```text
Entrée d’argent
Sortie d’argent
Document neutre / à confirmer
```

Exemples :

## Sortie probable

- ticket de caisse ;
- facture fournisseur ;
- achat CB ;
- note de frais à rembourser ;
- paiement de service.

## Entrée probable

- chèque reçu ;
- facture émise à un tiers ;
- don ;
- cotisation ;
- subvention.

Le résultat ne doit jamais être imposé sans validation humaine.

Le système doit donc proposer :

```text
Sens détecté : Sortie d’argent
Confiance : 88 %
Merci de confirmer
```

---

# 51. Détection source et destinataire

Selon le document, l’OCR et les règles métiers doivent proposer :

- source de l’argent ;
- destinataire de l’argent ;
- émetteur du document ;
- bénéficiaire.

Exemples :

## Cas 1 : ticket de caisse

- source = association
- destinataire = commerçant / fournisseur

## Cas 2 : chèque reçu

- source = membre / donateur / organisme
- destinataire = association

## Cas 3 : facture fournisseur

- source = association
- destinataire = fournisseur

## Cas 4 : facture émise

- source = client / partenaire
- destinataire = association

---

# 52. Extraction des lignes produits

Pour certains documents, l’application doit pouvoir extraire les lignes détaillées.

Exemple attendu :

| Libellé | Quantité | Prix unitaire | TVA | Total ligne |
|---|---:|---:|---:|---:|
| Câble HDMI | 2 | 8,50 € | 20 % | 17,00 € |
| Adaptateur USB | 1 | 12,90 € | 20 % | 12,90 € |

Utilités :

- mieux comprendre la dépense ;
- suivre certains achats ;
- préparer une ventilation par type de produit ;
- conserver le détail en archive.

Cette extraction peut être approximative au début.

Si elle n’est pas fiable, l’application doit au minimum stocker le texte OCR intégral.

---

# 53. Validation utilisateur avant archivage final

Après OCR, l’application doit présenter une fiche de validation avant tout enregistrement définitif. Cette étape est obligatoire pour les factures ajoutées avec le bouton `Scanner / importer une facture` du menu principal.

Champs à afficher :

- type de document ;
- sens financier ;
- fournisseur / émetteur ;
- bénéficiaire / destinataire ;
- date ;
- montant ;
- catégorie proposée ;
- projet proposé ;
- lignes produits si détectées ;
- image finale recadrée ;
- niveau de confiance.

Le récapitulatif doit afficher tous les champs extraits sur un seul écran ou dans un parcours continu clairement identifiable. Les champs incertains ou manquants doivent être mis en évidence, sans empêcher leur correction manuelle.

L’utilisateur peut :

- confirmer ;
- corriger ;
- compléter ;
- supprimer ;
- reprendre la photo.

---

# 54. Sauvegarde automatique dans la GED

Si la photo et les données sont validées, le document doit être automatiquement envoyé et archivé sur le serveur GED.

Objectif GED :

- conservation centralisée ;
- classement ;
- recherche ;
- traçabilité ;
- réutilisation future.

Le document sauvegardé doit comprendre :

- image originale ;
- image recadrée/améliorée ;
- métadonnées OCR ;
- texte OCR brut ;
- type documentaire ;
- date d’import ;
- utilisateur ayant fait la capture ;
- statut de validation ;
- hash SHA256 ;
- lien avec transaction si disponible.

---

# 55. Classement GED

La GED doit permettre un classement logique.

Exemple de structure métier :

```text
Association
└── Année
    ├── Dépenses
    │   ├── Tickets
    │   ├── Factures fournisseurs
    │   └── Notes de frais
    ├── Recettes
    │   ├── Chèques
    │   ├── Dons
    │   ├── Cotisations
    │   └── Factures émises
    └── Divers
```

Le classement physique sur disque peut rester technique, mais l’interface doit présenter un classement métier simple.

---

# 56. File d’attente documentaire

Tous les documents capturés sur mobile ne doivent pas forcément être considérés comme totalement intégrés immédiatement.

Prévoir plusieurs statuts :

```text
CAPTURE
OCR_EN_COURS
A_VALIDER
VALIDE
RAPPROCHE
ARCHIVE
REJETE
```

Une file spéciale doit permettre au trésorier de revoir rapidement :

- les documents à valider ;
- les documents sans transaction ;
- les documents à faible confiance OCR ;
- les documents mal classés.

---

# 57. Mode hors-ligne partiel

Option recommandée à terme.

Si la connexion est mauvaise, l’application mobile web peut :

- stocker temporairement la capture ;
- la mettre en file locale ;
- la synchroniser plus tard.

Cas utile :

- salle associative ;
- cave ;
- gymnase ;
- événement extérieur.

Le document ne doit pas être perdu si la connexion coupe pendant la capture.

---

# 58. Notifications et traitement différé

Après capture validée :

- le trésorier peut recevoir une notification ;
- le document peut apparaître dans la file "à rapprocher" ;
- une tâche OCR/rapprochement peut être exécutée en arrière-plan.

---

# 59. Flux mobile complet visé

```text
Utilisateur ouvre l’application sur téléphone
                ↓
Clique sur "Scanner / importer une facture"
depuis le menu principal ou la rubrique Factures
                ↓
Choisit "Prendre une photo" ou "Choisir un fichier"
                ↓
Prend une photo ou sélectionne une image/PDF
                ↓
Détection document + contrôle qualité
                ↓
Recadrage automatique
                ↓
Prévisualisation
                ↓
OCR + extraction des champs
                ↓
Détection :
- entrée / sortie
- source / destinataire
- montant
- date
- produits
                ↓
Récapitulatif complet et modifiable
                ↓
Validation explicite de l’utilisateur
                ↓
Envoi automatique sur le serveur GED
                ↓
Création du document dans la base
                ↓
Mise en file pour rapprochement comptable
```

---

# 60. Ajouts techniques recommandés

Pour supporter proprement ce besoin, prévoir :

Frontend web mobile :

- accès caméra HTML5 ;
- compression image côté client ;
- aperçu avant envoi ;
- recadrage côté client ou serveur ;
- interface responsive.

Backend :

- endpoint d’upload photo ;
- pipeline OCR asynchrone ;
- stockage original + dérivés ;
- API de validation documentaire ;
- moteur de classification documentaire.

Workers / traitement :

- détection qualité image ;
- détection contours ;
- OCR ;
- extraction structurée ;
- suggestion de classement ;
- rapprochement comptable.

---

# 61. Endpoints API complémentaires

## Capture / GED

```text
POST /api/mobile/capture
POST /api/documents/{id}/validate
POST /api/documents/{id}/retake
GET  /api/documents/pending
GET  /api/documents/{id}
GET  /api/documents/{id}/preview
```

## Analyse documentaire

```text
POST /api/documents/{id}/analyze
GET  /api/documents/{id}/analysis
POST /api/documents/{id}/match-transaction
```

## GED

```text
GET  /api/ged/search
GET  /api/ged/tree
GET  /api/ged/{id}/metadata
```

---

# 62. Données complémentaires à prévoir

## documents

Ajouter par exemple :

```text
original_filename
original_image_path
processed_image_path
thumbnail_path
document_type
financial_direction
confidence_score
detected_issuer
detected_recipient
detected_total
detected_date
raw_ocr_text
validated_by
validated_at
ged_status
```

## document_line_items

Créer une table dédiée :

```text
id
document_id
label
quantity
unit_price
tax_rate
line_total
raw_text
confidence_score
```

---

# 63. Critère de réussite spécifique mobile/GED

La fonctionnalité sera jugée réussie si un bénévole peut, depuis son téléphone :

1. prendre une photo d’un ticket ;
2. voir immédiatement si le cadrage est acceptable ;
3. laisser l’application corriger et recadrer ;
4. obtenir automatiquement la date, le montant et le fournisseur ;
5. obtenir une proposition "entrée" ou "sortie" ;
6. confirmer les informations ;
7. envoyer le document ;
8. retrouver ce justificatif sur le serveur ;
9. le rapprocher ensuite à une opération comptable.

---

# 64. Priorisation de ce besoin

Ce besoin est suffisamment important pour être intégré dès le MVP si l’objectif principal de l’application est la gestion pratique des justificatifs.

Ordre recommandé :

## MVP élargi

- interface web responsive ;
- bouton `Scanner / importer une facture` accessible depuis le menu principal et la rubrique `Factures` ;
- choix entre appareil photo et fichier image/PDF ;
- capture photo depuis mobile ;
- contrôle qualité simple ;
- recadrage ;
- upload serveur ;
- OCR et analyse automatique après sélection ;
- récapitulatif complet et modifiable avant enregistrement ;
- validation explicite de l’utilisateur ;
- archivage GED ;
- rattachement à une transaction.

## Phase 2

- extraction lignes produits ;
- classification entrée/sortie plus fine ;
- suggestion source/destinataire ;
- mode hors-ligne ;
- rapprochement intelligent.

## Phase 3

- analyse documentaire avancée ;
- détection plus fiable des chèques ;
- automatisation forte GED + comptabilité ;
- recherche sémantique.
