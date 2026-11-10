# AGENTS.md

Application web d'analyse budgétaire, 100 % locale : import de relevés bancaires CSV, dédoublonnage, chiffrement dans `localStorage`, timeline de solde, couverture des dépenses par les crédits (FIFO), analyses par période, détection des paiements récurrents et classement par catégories/marchands.

## État actuel

- Projet initialisé : Vite 8 (Rolldown), React 19, TypeScript 6, Tailwind CSS 4, shadcn/ui (style `radix-nova`), Recharts 3, PapaParse, Zod, Zustand, Vitest.
- Application multi-pages (sidebar + routeur par hash) : vue d'ensemble, analyses, budgets, assistant, transactions, récurrences, marchands, couverture, saisie manuelle, réglages.
- Dépôt git, branche `master`. Les relevés de référence ne sont **jamais versionnés** (données personnelles) : les copier dans `fixtures/`. Il reste à publier sur GitHub.
- UI en français, devise EUR, locale `fr-FR`.

## Commandes

- `npm run dev` — serveur local (obligatoire : `file://` casse WebCrypto et les modules ES).
- `npm run build` — `tsc -b` **puis** `vite build` ; échoue si le typecheck échoue.
- `npm run test` — Vitest, environnement `node`, fichiers `src/**/*.test.ts`.
- `npm run test -- src/lib/dedupe.test.ts` — un seul fichier de test.
- `npm run lint` / `npm run typecheck`.

Ordre de vérification avant de livrer : `npm run lint && npm run test && npm run build`.

## Données de référence (vérifiées)

- `fixtures/releve-complet.csv` — historique complet : 1 728 lignes, 2023-10-23 → 2026-11-05.
- `fixtures/releve-partiel.csv` — 198 lignes, 2026-08-25 → 2026-11-05. **Sous-ensemble exact et ordonné des 198 dernières lignes du fichier complet.**
- Format : `;`, **Windows-1252** (pas UTF-8 : `0xE9` = `é`), sans guillemets, colonnes `Date;Date de valeur;Débit;Crédit;Libellé;Solde`.
- Dates `jj/mm/aaaa` ; montants à virgule, sans séparateur de milliers ; **`Débit` est déjà négatif — ne pas réinverser le signe** ; `Débit` et `Crédit` ne sont jamais renseignés ensemble.
- `Solde` est un solde courant continu dans l'ordre du fichier : 0 rupture sur 1 727 transitions. L'ordre du fichier fait foi ; ne pas trier par `Date de valeur` (51 lignes ont une valeur future).
- Libellés tronqués par la banque (≤ 108 car.) ; référence extractible sur 638/1 728 lignes seulement → aucun identifiant de transaction fiable.

## Dédoublonnage (piège majeur)

- Clé = **ligne brute complète** `date|valueDate|debit|credit|rawLabel|solde`, hashée SHA-256 → `id` = `<hash>:<occurrence>` (`src/lib/dedupe.ts`).
- Ne **jamais** dédoublonner sur `date + montant + libellé` : 17 groupes partagent ces champs avec des soldes différents (vrais achats répétés).
- Fusion **multiensemble** : on ne retire que la sur-occurrence déjà présente. Deux lignes identiques d'un même export peuvent être deux opérations réelles : en supprimer une casse la chaîne des soldes.
- Attendu en important les deux fichiers : **1 728 transactions**, 198 ignorées (chevauchement), 0 doublon interne.
- Le hash porte sur `rawLabel` immuable, jamais sur le nom renommé.
- Conserver `sourceFile` et `order` pour la traçabilité, hors de la clé.

## Chiffrement / persistance

- `localStorage` sous une clé unique `budget.vault.v1` ; enveloppe `{ v, kdf: 'PBKDF2-SHA256', iterations: 310000, salt, iv, ciphertext }` (base64).
- AES-GCM 256 bits ; **IV neuf à chaque écriture** ; mot de passe jamais stocké ; clé dérivée en mémoire seulement (`let vaultKey` dans le store) ; verrouiller = l'oublier et vider l'état déchiffré.
- Pas de récupération de mot de passe (averti à la création). Pas de middleware Zustand `persist` : il écrirait en clair.
- WebCrypto exige `localhost`/`https` ; `crypto.subtle` n'existe pas en `file://`.

## Architecture

- `src/lib/csv.ts` — décodage (UTF-8 strict puis Windows-1252), détection du séparateur et des colonnes, parse générique et validation. `inspectCsvText` renvoie un aperçu + mappage deviné ; `parseCsvText(text, options)` accepte un `mapping` manuel, un `hasHeader`, un `decimalSeparator`, un `debitSign` et un `delimiter`. Montants FR/US et dates `jj/mm/aaaa`, `aaaa-mm-jj`, `jj-mm-aaaa` acceptés ; sans colonne Solde, un solde courant continu est reconstruit depuis 0.
- `src/lib/dedupe.ts` — empreinte, hash, fusion multiensemble, ordre du grand livre.
- `src/lib/crypto.ts` — dérivation PBKDF2, enveloppe AES-GCM, schémas Zod.
- `src/lib/labels.ts` — nettoyage des libellés, `merchantKey`, alias.
- `src/lib/runway.ts` — points de solde, ruptures, couverture FIFO, projection, agrégats mensuels, `balanceAt`. `detailedCoverageSegments` applique d'abord les affectations manuelles (`customAllocations` : `expenseId → creditId`), puis le FIFO, et expose catégories financées, durée et date de survie par crédit.
- `src/lib/period.ts` — presets (30 j → tout), résolution période/précédente, libellés, bornes du jeu de données.
- `src/lib/analytics.ts` — totaux, séries mensuelles, marchands, catégories, jours de la semaine, faits saillants, `percentChange`.
- `src/lib/categories.ts` — 15 catégories + règles par mots-clés ordonnées (`CATEGORIES` puis `autoCategoryId`). `categoryIdOf` donne la priorité à `transaction.categoryId`, puis à l'alias marchand, puis à l'heuristique.
- `src/lib/recurring.ts` — détection des séries : fréquence votée, découpage cadence/montant, régularisations absorbées, intervalle médian, régularité, stabilité, confiance, équivalent mensuel, prochaine échéance au jour ouvré, décision pending/accepted/refused.
- `src/lib/import.ts` — pipeline décodage → parse (avec options de mappage) → dédoublonnage.
- `src/lib/table-sort.ts` — tri générique partagé : `SortState`, `nextSort` (premier clic = sens fourni, clics suivants inversés) et `sortRows` (copie triée, nombres en numérique, texte en `localeCompare('fr')`). Le composant `src/components/sortable-header.tsx` ne contient que `SortableHeader` (sinon `react-refresh/only-export-components` échoue).
- `src/lib/ai.ts` — intégration optionnelle Google Gemini REST, clé API chiffrée dans le coffre (opt-in). Deux cascades : les fonctions d'analyse (`gemini-3.5-flash-lite` → `gemini-3.8-flash`) et le chat, qui privilégie la qualité (`gemini-3.8-flash` → `gemini-3.5-flash-lite`). Repli automatique sur saturation (503/429). Batchs : renommage (15), catégorisation (15), récurrences (20). Propositions de budgets (`proposeBudgets`) et analyse de période (`analyzePeriod`) ne reçoivent que des agrégats. Parseurs purs testés. L'interface reste sans noms de modèles internes.
- `src/lib/assistant-tools.ts` — 11 outils en lecture seule du chat (`period_summary`, `search_transactions`, `get_transaction`, `top_merchants`, `category_breakdown`, `monthly_series`, `balance_history`, `budget_status`, `recurring_series`, `coverage_status`, `allocations`). Chaque exécuteur renvoie un `summary` compact (seul contenu transmis au modèle) et des `artifacts` visuels. Schémas en types Gemini majuscules (`OBJECT`, `STRING`, `INTEGER`, `NUMBER`). `resolveToolRange` applique plage explicite > fenêtre en mois ancrée sur `referenceDate` > période globale.
- `src/lib/assistant-tools.ts` et `askAssistantWithTools` — boucle de function calling bornée (5 tours, 8 appels) puis requête finale sans outils. Renvoyer les parts du modèle telles quelles (dont `thoughtSignature`), une `functionResponse` par `functionCall` avec le même `id`, rôle `user` pour les réponses d'outil. Un outil en échec renvoie `{ error }` sans interrompre la réponse. Les appels d'outils sont **silencieux** : chaque artefact rejoint un pool avec un indice, et le modèle choisit lui-même 1 à 3 cartes via l'outil `present_artifacts` (indices fournis dans `artefacts_disponibles`). Sans choix, repli déterministe : un artefact par type, tours récents d'abord, pertinence décroissante.
- `src/lib/assistant-context.ts` — contexte agrégé (période, catégories, marchands, récurrences acceptées, budgets, runway) utilisé par les cartes d'analyse à la demande. Aucun libellé brut ni IBAN. Le chat, lui, interroge le coffre via `assistant-tools.ts`.
- `src/lib/router.ts` — routeur minimal par hash (`#/overview`, `#/analysis`, `#/budgets`, `#/assistant`, `#/transactions`, `#/recurring`, `#/merchants`, `#/coverage`, `#/manual`, `#/settings`).
- `src/store/vault-store.ts` — état Zustand + sauvegarde chiffrée après chaque mutation (alias, catégories, décisions de récurrence, budgets, affectations de couverture, saisies manuelles, préférences IA, conversation de l'assistant, mot de passe). `setup` accepte les fichiers déjà parsés de l'onboarding ; `importRows` fusionne des lignes parsées (import avec mappage). Plus de `importFile`.
- `src/store/ui-store.ts` — période globale (preset + plage personnalisée), filtres transactions, actions de drill-down.
- `src/hooks/use-period.ts` — période courante/précédente dérivée du store UI.
- `src/pages/*.tsx` — les 10 pages ; `src/components/app-shell.tsx` — sidebar (groupes Pilotage / Explorer / Opérations / Système) + page active. `assistant-page` est un chat persistant (markdown léger, indicateur « Analyse en cours… », bouton « Nouveau chat ») : les appels d'outils ne sont pas montrés, seuls les artefacts choisis apparaissent. `src/components/assistant-artifacts.tsx` rend les cartes cliquables (opérations, marchands, récurrences, couverture, affectations) et les graphiques (anneau catégories, barres mensuelles, courbe de solde, jauges budgets) ; les transactions sont référencées par `id` et recalculées depuis le coffre.
- `src/components/ai-insight-card.tsx` — carte d'analyse à la demande (prompt libre + suggestions), masquée si l'IA est désactivée. Branchée sur la vue d'ensemble, les analyses, les budgets et la couverture.
- `src/pages/budgets-page.tsx` — budgets mensuels par catégorie ou globaux : CRUD, jauges vertes < 80 %, orange 80–100 %, rouges > 100 %, évaluées sur le mois de `referenceDate` pour rester cohérent avec des plafonds mensuels.
- `src/pages/manual-entry-page.tsx` — saisie manuelle (dépense/recette, date, montant, libellé, nom lisible, catégorie, note), modification et suppression ; le store propage le décalage de solde aux opérations suivantes.
- `src/components/balance-timeline.tsx` — timeline de solde découpée sur la période globale, sans brush ; `period-picker.tsx` — presets + plage personnalisée.
- `src/components/csv-importer.tsx` — sélecteur de fichiers CSV partagé par l'onboarding, la page Réglages et le coffre vide. Détecte le format ; si les en-têtes ne couvrent pas les champs requis, ouvre un panneau d'association des colonnes (date, date de valeur, débit, crédit, montant signé, libellé, solde), avec séparateur, séparateur décimal, signe des débits, en-têtes et aperçu des 4 premières lignes. Chaque fichier est parsé puis remis au parent via `onParsed` (`ParsedCsvFile`).
- `src/components/{setup,unlock}-screen.tsx`, `merchant-dialog.tsx`, `stat-card.tsx`, `category-badge.tsx` ; composants shadcn dans `src/components/ui/` (ne pas éditer si évitable ; `react-refresh` désactivé pour ce dossier). `setup-screen.tsx` suit 3 étapes : mot de passe → premier relevé facultatif (avec mappage) → IA opt-in ; les fichiers sont fusionnés au moment de `setup(password, aiConfig, imports)` pour une seule écriture chiffrée.
- Alias `@/*` → `src/*` (tsconfig + Vite). Le style shadcn utilise le paquet `cn`, pas `clsx`/`tailwind-merge` directement.

## Navigation & période

- Une seule période globale dans `ui-store` ; toutes les pages la consomment via `usePeriod()`. Défaut `12m`, ancré sur la dernière date du jeu de données (`referenceDate`), pas sur la date du jour.
- Les barres mensuelles et les lignes de tableau appellent `drillIntoRange()` : preset `custom` + bascule sur `#/transactions` + remise à zéro des filtres. Le graphique de solde, lui, ne fait que suivre la période globale.
- `PercentChange` renvoie `null` si la base est quasi nulle (`|previous| < 1`) ; les KPI « Net » affichent une variation **en euros** (`deltaAmount`) car un pourcentage sur un net proche de zéro est illisible.
- Ne jamais trier ni filtrer sur `Date de valeur` : l'ordre du fichier et le solde courant font foi.

## Import CSV

- Le format historique est reconnu automatiquement (séparateur `;`, en-têtes français). L'import n'est plus figé : `CsvImporter` accepte `;`, `,`, tabulation et `|`, avec en-têtes anglais ou français.
- Si le mappage deviné est incomplet, l'utilisateur associe les colonnes aux champs attendus. `mappingIssue` reste la source de vérité : Date et Libellé obligatoires, plus un Montant signé **ou** le couple Débit/Crédit. Le Solde et la Date de valeur sont facultatifs.
- Sans colonne Solde, le parseur reconstruit un solde courant depuis 0 dans l'ordre du fichier ; ne pas l'utiliser pour conclure à une rupture de chaîne bancaire.
- Les débits sont supposés déjà négatifs (convention de la banque) ; `debitSign: 'positive'` inverse le signe pour les exports qui les publient en positif.
- Décodage : UTF-8 strict d'abord, repli Windows-1252. Ne pas revenir à un décodage Windows-1252 systématique, qui casserait les exports UTF-8.
- Onboarding : l'import du premier relevé est facultatif et précède la création du coffre ; les lignes parsées sont passées à `setup` et fusionnées avant la première écriture. Réglages et coffre vide réutilisent le même composant via `importRows`.
- L'ancien import au format fixe (`import-dropzone.tsx`, `use-import-files.ts`, `importFile`) a été supprimé ; ne pas le réintroduire.

## Tri des tableaux

- Tous les tableaux de données trient par clic sur l'en-tête via `SortableHeader` + `sortRows` (`src/lib/table-sort.ts`). Pas de sélecteur de tri séparé.
- Premier clic : sens fourni par `initialDirection` (desc pour montants/dates, asc pour texte) ; clic suivant : inversion. `aria-sort` est renseigné.
- Ne pas réintroduire `nextSort`/`sortRows` dans un fichier de composant : `react-refresh/only-export-components` échoue.

## Catégories & marchands

- Catégorie effective = override du marchand (stocké dans l'alias) > règles par mots-clés sur `merchantKey + rawLabel` > `autres`.
- Les règles sont **ordonnées** : une règle plus spécifique doit passer avant une règle générique (ex. `RESTAURANT` avant `ALIMENTATION`).
- Renommage et catégorie sont persistés par `merchantKey`, jamais par transaction : les imports futurs héritent des choix.
- Pendant un batch IA de renommage ou de catégorisation, les cellules concernées de la page Marchands et les champs concernés de `merchant-dialog.tsx` affichent un `Skeleton` (même hauteur que `Input`/`SelectTrigger`, `aria-busy`, libellé `role="status"`). Un champ traité n'est ni éditable ni enregistrable avant la fin de la requête.
- Les décisions de récurrence sont stockées par identifiant de série dans `recurringDecisions` (`accepted` | `refused`) ; l'absence de décision vaut `pending`. Seules les séries **acceptées et actives** comptent dans les totaux mensuels et les échéances. Les refusées sont masquées par défaut, les terminées aussi tant que « afficher les séries refusées et terminées » n'est pas coché. L'ancien champ `ignoredRecurring` est migré en `refused` au déverrouillage.

## Panneau de détail

- `src/components/detail-panel.tsx` — contenu du panneau (`DetailPanel` : en-tête, bouton fermer, tuiles de statistiques, pied d'actions) et `TransactionList`.
- `src/components/entity-panels.tsx` — `RecurringDetailPanel` (paiements de la série + accepter/refuser), `MerchantDetailPanel` (historique complet), `TransactionDetailPanel` (titre = montant signé, date/date de valeur/solde après, libellé bancaire, puis « Autres opérations de la source » repliées pour que le panneau décrive l'opération et non la personne) et `DetailHost`.
- `DetailHost` est monté dans `AppShell` **à côté** de `<main>` : le panneau scinde la page (le contenu se rétrécit) au lieu de s'empiler par-dessus. Sa largeur s'anime de 0 à `md:w-[20rem] lg:w-[24rem] xl:w-[28rem] 2xl:w-[32rem]` (tiers à moitié d'écran) ; sous `md` il devient plein écran fixe et glisse par `translate-x`.
- La cible vit dans `ui-store` (`detail` + `detailOpen`) : les pages appellent seulement `openDetail(...)`, `closeDetail()` referme, et la cible n'est purgée qu'à la fin de l'animation (`transitionend` → `clearDetail`). Un changement de page (`hashchange`) et `focusMerchant`/`drillIntoRange` ferment le panneau.
- Les lignes des pages Récurrences, Transactions et Marchands sont cliquables ; les boutons d'action (décision, renommage) appellent `stopPropagation` pour ne pas ouvrir le panneau.
- Les panneaux sont dérivés de l'état vivant (`id`/`merchantKey` → objet recalculé), donc une décision prise dans le panneau met à jour la liste, les totaux et le panneau sans le fermer.
- Sous `md`, le panneau recouvre l'écran : c'est le seul mode où il n'est pas une colonne. Garder `inert`/`aria-hidden` quand il est fermé.
- Le corps scrollable est un `div` natif (`overflow-y-auto overflow-x-hidden`), **pas** `ScrollArea` : le wrapper interne Radix (`display: table`) se dimensionne sur le `max-content` et déborde d'un panneau étroit (montants hors écran). Le conteneur interne garde `min-w-0` et les libellés `truncate`.

## Assistant conversationnel

- Conversation persistée dans le coffre chiffré (`assistantChat`, 60 messages max), effacée uniquement par « Nouveau chat » ; un rechargement la restitue.
- Les appels d'outils sont silencieux : chaque artefact rejoint un pool, le modèle en désigne 1 à 3 avec `present_artifacts`. Repli sans choix : un artefact par type, tours récents d'abord, 3 maximum.
- Un artefact ne fige jamais les montants : il conserve des `id` et des agrégats, recalculés depuis l'état vivant du coffre à l'affichage.
- L'IA reste opt-in ; le texte sous la zone de saisie décrit ce qui est envoyé au service. Aucune clé API ni message n'est stocké hors du coffre.

## Règles de modélisation

- `rawLabel` immuable ; `displayName = override transaction > alias marchand > nettoyage auto`.
- Renommage persisté par `merchantKey` (pas par transaction) pour que les imports futurs héritent du nom.
- `merchantKey` est heuristique (la banque tronque) : ne jamais bloquer un import sur un libellé inconnu.
- `amount = debit ?? credit` ; le solde bancaire est la source de vérité pour la timeline ; alerter si `balanceChainBreaks` n'est pas vide.
- Saisies manuelles : `sourceFile: 'manual'`, `isManual: true`, id `manual:*`, `solde` recalculé en propageant le décalage aux opérations postérieures (jamais de rupture de chaîne). Une modification passe par suppression puis réinsertion pour conserver la continuité, y compris si la date change.
- Budgets : plafond **mensuel** comparé au mois de `referenceDate` (dernière opération), pas à la période globale. Un budget global et des budgets de catégorie ne se cumulent pas dans le KPI « dépensé ».
- Couverture : les `customAllocations` sont appliquées **avant** le FIFO ; une réaffectation vers `auto` supprime l'entrée.

## Pièges outillage

- TypeScript 6 : `baseUrl` est déprécié → ne pas le remettre, `paths` suffit.
- WebCrypto + TS 6 : typer les octets `Uint8Array<ArrayBuffer>` (pas `Uint8Array<ArrayBufferLike>`), sinon `BufferSource` refuse.
- Les tests d'intégration lisent `fixtures/releve-complet.csv` et `fixtures/releve-partiel.csv` et sont **sautés** (`describe.skipIf`) si ces fichiers sont absents.
- `npm run build` inclut le typecheck : lancer les tests d'abord pour un diagnostic plus clair.
- Quota `localStorage` ≈ 5 Mo : suffisant pour ~1 700 lignes ; garder une seule clé.
- Recharts 3 : `Bar.onClick` reçoit `(data, index, event)`. Le graphique de solde n'a plus de `Brush` : c'est le sélecteur de période global qui pilote la fenêtre.
- Règle ESLint `react-hooks/set-state-in-effect` : pas de `setState` dans un effet. Resynchroniser sur l'ouverture d'un popover, indexer la pagination sur une signature de filtres, ou remonter un dialogue via `key`.
- Recharts ne fournit pas de ticks lisibles sur les courtes périodes si le formateur reste mensuel : `balance-timeline` bascule en `d MMM` sous 120 jours.
- Icônes lucide absentes du build : `BarChart3`, `Filter`, `Trash2`, `CircleAlert`, `MoreHorizontal`, `CircleHelp` — choisir des équivalents disponibles.

## Tests de non-régression (fixtures locales, non versionnées)

- Fichier complet : 1 728 lignes, 0 erreur ; fichier court : 198 lignes, 0 erreur.
- Import complet puis court : 1 728 transactions, 198 ignorées, 0 ajout au second import.
- Identifiants uniques, dates triées, chaîne des soldes sans rupture.
- 17 groupes `date + montant + libellé` à soldes distincts conservés.
- `src/lib/period.test.ts` couvre résolution des presets, plage précédente et bornes du jeu de données.
- `src/lib/recurring.test.ts` couvre la détection, les décisions pending/accepted/refused et l'exclusion des séries non acceptées des totaux mensuels.
- `src/lib/analytics.test.ts` couvre totaux, séries, catégories et `percentChange` (base quasi nulle → `null`).
- `src/lib/runway.test.ts` couvre le FIFO et les affectations manuelles de couverture.
- `src/lib/assistant-tools.test.ts` couvre les 11 outils : plages, recherche d'opérations, agrégats, budgets, récurrences, couverture et affectations.
- `src/lib/ai.test.ts` couvre les prompts, la normalisation, les parseurs de réponses batch (marchands, catégories, récurrences, budgets, assistant), la boucle de function calling (signature et identifiant conservés, repli 503, outil inconnu) et la curation `present_artifacts`.
- Crypto : aller-retour, IV différent à chaque écriture, mauvais mot de passe et ciphertext altéré rejetés.
