# Plan d'implémentation : IA enrichie, Refonte Couverture/Runway, Budgets & Saisie Manuelle

## 1. Schéma de données & Persistance Chiffrée (`src/lib/types.ts`, `src/lib/crypto.ts`, `src/store/vault-store.ts`)
- **Budgets** :
  ```ts
  export interface BudgetPlan {
    id: string
    categoryId?: string // ou undefined pour budget global
    name: string
    monthlyLimit: number
    color?: string
  }
  ```
- **Affectations manuelles de couverture** :
  ```ts
  // expenseId -> creditId choisi manuellement par l'utilisateur
  export type CustomAllocationMap = Record<string, string>
  ```
- **Transactions manuelles** :
  - Intégrées au tableau de transactions avec indicateur `sourceFile: 'manual'` (et drapeau `isManual: true`).

## 2. Navigation & Router (`src/lib/router.ts`, `src/components/app-shell.tsx`)
- Nouvelles pages dans `PAGE_IDS` :
  - `'budgets'` (Gestion des budgets)
  - `'manual'` (Saisie manuelle d'opérations)
- Groupes de navigation réorganisés :
  - **Pilotage** : Vue d'ensemble, Analyses, Budgets
  - **Explorer** : Transactions, Récurrences, Marchands, Couverture & runway
  - **Opérations** : Saisie manuelle
  - **Système** : Réglages

## 3. IA Groupée & Automatisations (`src/lib/ai.ts`, Marchands & Récurrences)
- **Batching strict** :
  - `batchSuggestMerchantNames(merchants: { key: string; labels: string[] }[])` : groupement par 15-20 marchands par prompt JSON unique.
  - `batchAnalyzeRecurring(series: DetectedSeries[])` : classification en bloc des récurrences par l'IA.
- **UI** :
  - Page Marchands : Bouton « Tout renommer par IA » avec modal de prévisualisation et application en masse.
  - Page Récurrences : Bouton « Suggestions IA » pour voter automatiquement sur les séries en attente.
  - Saisie / Dialogue marchand : suggestions immédiates de noms sans surcoût.

## 4. Refonte complète de Couverture & Runway (`src/lib/runway.ts`, `src/pages/coverage-page.tsx`)
- Prise en compte des **affectations manuelles** (`customAllocations`) avant le dispatch FIFO.
- **Visualisation claire & analytique** :
  - Pour chaque crédit : jauges de progression, catégories financées (Alimentation, Logement, Loisirs...), date de survie.
  - Filtre par statut (Actifs / Épuisés) et tri par montant / date.
  - Dialogue interactif permettant de **réaffecter une dépense à un autre revenu** en 1 clic.

## 5. Nouvelle Page Budgets (`src/pages/budgets-page.tsx`)
- Création / édition / suppression de budgets mensuels par catégorie ou globaux.
- Jauges de consommation en temps réel basées sur les dépenses de la période courante.
- Alertes de dépassement (vert < 80%, orange 80-100%, rouge > 100%).
- KPI : Total budgété vs Total dépensé, restant disponible.

## 6. Nouvelle Page Saisie Manuelle (`src/pages/manual-entry-page.tsx`)
- Formulaire rapide : Type (Dépense / Recette), Date, Montant, Libellé, Catégorie, Marchand, Note.
- Calcul cohérent du solde après opération.
- Tableau des opérations manuelles avec actions Modifier / Supprimer.
