# Budget Analyzer

Analyse budgétaire locale à partir de relevés bancaires CSV. Les données sont
dédoublonnées puis chiffrées dans le navigateur : aucun serveur, aucune donnée
qui quitte l'appareil.

## Fonctionnalités

- Import de plusieurs exports CSV, y compris chevauchants (dédoublonnage
  idempotent par ligne brute complète).
- Coffre local chiffré AES-256-GCM, clé dérivée du mot de passe par
  PBKDF2-SHA256 (310 000 itérations, sel aléatoire) ; changement de mot de passe
  et suppression du coffre depuis les réglages.
- Période d'analyse globale : 30 j, 90 j, 6/12/24 mois, tout l'historique ou
  plage personnalisée, ancrée sur la dernière date importée.
- Timeline de solde synchronisée avec la période globale (presets ou plage
  personnalisée) ; les clics sur un mois ouvrent directement les mouvements
  correspondants.
- Vue d'ensemble : KPI (entrées, dépenses, net, taux d'épargne), comparaison
  avec la période précédente, prochaines échéances récurrentes, top catégories.
- Analyses : séries mensuelles entrées/sorties, répartition par catégorie
  (camembert + détail), dépenses par jour de la semaine, détail mensuel
  cliquable, faits saillants.
- Détection automatique des paiements et revenus récurrents : fréquence
  (hebdo, bimensuelle, mensuelle, trimestrielle, annuelle), prochaine échéance
  (reportée au jour ouvré), équivalent mensuel, indice de confiance. Chaque
  série reste **en attente de validation** et ne compte dans les totaux et les
  échéances qu'après acceptation ; les séries refusées sont masquées par défaut.
  Une échéance manquée ou un changement durable de montant clôt la série ; la
  reprise crée une nouvelle série. Les régularisations ponctuelles et les mois
  de 28 à 31 jours sont absorbés.
- Marchands : classement par volume, filtre par catégorie, accès rapide aux
  « à classer », renommage et catégorisation persistés (les imports futurs
  héritent des choix).
- Transactions : recherche, filtres type/catégorie/marchand, tri, pagination,
  export CSV de la sélection, panneau des transactions similaires (même source)
  avec l'opération sélectionnée surlignée.
- Panneau de détail en colonne scindée (droite, tiers à moitié d'écran) : la page
  se rétrécit au lieu d'être recouverte, avec une animation de largeur (plein
  écran glissant sous `md`). Une récurrence ouvre ses paiements associés et
  permet de l'accepter/refuser, un marchand ouvre son historique complet, une
  transaction ouvre toutes les opérations de la même source. Fermer le panneau
  ou changer de page referme la colonne.
- Couverture FIFO : jusqu'à quand chaque crédit finance les dépenses suivantes,
  avec projection du runway.
- Libellés bancaires simplifiés automatiquement, catégorisation par mots-clés.

## Démarrage

```bash
npm install
npm run dev
```

Ouvrir l'URL affichée (`http://localhost:5173`). **Ne pas ouvrir
`dist/index.html` en `file://`** : WebCrypto et les modules ES y sont bloqués.

## Scripts

```bash
npm run dev         # serveur de développement
npm run build       # typecheck + build de production
npm run test        # tests Vitest
npm run lint        # ESLint
npm run typecheck   # TypeScript seul
```

## Format CSV attendu

Export bancaire français, séparé par `;`, encodé en Windows-1252 :

```
Date;Date de valeur;Débit;Crédit;Libellé;Solde
25/08/2026;25/08/2026;;40,00;VIR DE MLE FLORENCE BARILLET CH3V26237L006035;59,21
25/08/2026;25/08/2026;-6,99;;PRLV SEPA PAYPAL EUROPE S A R L 1052563520913/PAYPAL;52,22
```

Le débit est déjà négatif. Le solde est le solde courant après l'opération.

## Architecture

```
src/
  lib/        csv, dedupe, crypto, labels, runway, import, storage
              period, analytics, categories, recurring, format, router, types
  store/      vault-store (données + alias + décisions de récurrence)
              ui-store (période globale, filtres, drill-down)
  hooks/      use-period, use-import-files
  pages/      overview, analysis, transactions, recurring,
              merchants, coverage, settings
  components/ app-shell, balance-timeline, period-picker, ...
              ui/ (shadcn)
```

Navigation par hash : `#/overview`, `#/analysis`, `#/transactions`,
`#/recurring`, `#/merchants`, `#/coverage`, `#/settings`. Une seule période
globale est partagée par toutes les pages ; le graphique de solde, les barres
mensuelles et les lignes du tableau mensuel utilisent cette période, et les
barres/lignes ouvrent les transactions correspondantes.

## Sécurité

- Le mot de passe n'est jamais stocké ; la clé dérivée ne vit qu'en mémoire.
- Aucune récupération possible : mot de passe perdu = données illisibles.
- Le renommage des marchands reste dans le coffre chiffré.
- Le build est 100 % statique ; servez-le depuis un contexte sécurisé.
