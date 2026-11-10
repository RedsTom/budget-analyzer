# AGENTS.md

Application web d'analyse budgétaire, 100 % locale : import de relevés bancaires CSV, dédoublonnage, chiffrement dans `localStorage`, timeline de solde, couverture manuelle des dépenses par les crédits (traitement des paiements un par un), analyses par période, détection des paiements récurrents et classement par catégories/marchands.

## État actuel

- Projet initialisé : Vite 8 (Rolldown), React 19, TypeScript 6, Tailwind CSS 4, shadcn/ui (style `radix-nova`), Recharts 3, PapaParse, Zod, Zustand, Vitest.
- Application multi-pages (sidebar + routeur par hash) : vue d'ensemble, analyses, budgets, assistant, transactions, récurrences, marchands, couverture, saisie manuelle, réglages.
- Dépôt git, branche `master`, publié sur https://github.com/RedsTom/budget-analyzer (public, GPL-3.0). Les relevés de référence ne sont **jamais versionnés** (données personnelles) : les copier dans `fixtures/`.
- UI en français, devise EUR, locale `fr-FR`.

## Commandes

- `npm run dev` — serveur local (obligatoire : `file://` casse WebCrypto et les modules ES).
- `npm run build` — `tsc -b` **puis** `vite build` ; échoue si le typecheck échoue.
- `npm run test` — Vitest, environnement `node`, fichiers `src/**/*.test.ts`.
- `npm run test -- src/lib/dedupe.test.ts` — un seul fichier de test.
- `npm run lint` / `npm run typecheck`.
- `npm run pwa:assets` — régénère les icônes PWA depuis `public/app-icon.svg`.

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

- `localStorage` sous la clé `budget.vault.v1` ; enveloppe `{ v, kdf: 'PBKDF2-SHA256', iterations: 310000, salt, iv, ciphertext }` (base64). Une seconde clé `budget.passkey.v1` peut contenir le mot de passe scellé par une passkey (voir section Clés d'accès) ; ne jamais y mettre le mot de passe en clair.
- AES-GCM 256 bits ; **IV neuf à chaque écriture** ; mot de passe jamais stocké en clair ; clé dérivée en mémoire seulement (`let vaultKey` dans le store) ; verrouiller = l'oublier et vider l'état déchiffré. Avec une passkey, le mot de passe est conservé chiffré par PRF dans `budget.passkey.v1`.
- Pas de récupération de mot de passe sans clé d'accès (averti à la création) ; une clé d'accès peut déverrouiller sur l'appareil, pas restaurer une sauvegarde. Pas de middleware Zustand `persist` : il écrirait en clair.
- WebCrypto exige `localhost`/`https` ; `crypto.subtle` n'existe pas en `file://`.

## Architecture

- `src/lib/csv.ts` — décodage (UTF-8 strict puis Windows-1252), détection du séparateur et des colonnes, parse générique et validation. `inspectCsvText` renvoie un aperçu + mappage deviné ; `parseCsvText(text, options)` accepte un `mapping` manuel, un `hasHeader`, un `decimalSeparator`, un `debitSign` et un `delimiter`. Montants FR/US et dates `jj/mm/aaaa`, `aaaa-mm-jj`, `jj-mm-aaaa` acceptés ; sans colonne Solde, un solde courant continu est reconstruit depuis 0.
- `src/lib/dedupe.ts` — empreinte, hash, fusion multiensemble, ordre du grand livre.
- `src/lib/crypto.ts` — dérivation PBKDF2, enveloppe AES-GCM, schémas Zod.
- `src/lib/labels.ts` — nettoyage des libellés, `merchantKey`, alias.
- `src/lib/runway.ts` — points de solde, ruptures, couverture manuelle, projection, agrégats mensuels, `balanceAt`. `detailedCoverageSegments` ne couvre un paiement que par ses parts explicitement affectées (`customAllocations` : chaîne, objet ou tableau de parts). Plus aucun FIFO automatique : `paymentAllocationStatuses()` expose chaque paiement en `todo` / `partial` / `done`, et `allocationCapacity()` donne la place d'un revenu après les autres affectations manuelles. `coverageAvailability()` borne les fonds actifs au solde réel. Expose catégories financées, durée et date de survie par crédit.
- `src/lib/period.ts` — presets (30 j → tout), résolution période/précédente, libellés, bornes du jeu de données.
- `src/lib/analytics.ts` — totaux, séries mensuelles, marchands, catégories, jours de la semaine, faits saillants, `percentChange`.
- `src/lib/categories.ts` — 15 catégories + règles par mots-clés ordonnées (`CATEGORIES` puis `autoCategoryId`). `categoryIdOf` donne la priorité à `transaction.categoryId`, puis à l'alias marchand, puis à l'heuristique.
- `src/lib/recurring.ts` — détection des séries : fréquence votée, découpage cadence/montant, régularisations absorbées, intervalle médian, régularité, stabilité, confiance, équivalent mensuel, prochaine échéance au jour ouvré, décision pending/accepted/refused. `seriesInRange()` filtre l'affichage sur la période sans dégrader la détection globale.
- `src/lib/import.ts` — pipeline décodage → parse (avec options de mappage) → dédoublonnage.
- `src/lib/table-sort.ts` — tri générique partagé : `SortState`, `nextSort` (premier clic = sens fourni, clics suivants inversés) et `sortRows` (copie triée, nombres en numérique, texte en `localeCompare('fr')`). Le composant `src/components/sortable-header.tsx` ne contient que `SortableHeader` (sinon `react-refresh/only-export-components` échoue).
- `src/lib/ai.ts` — intégration optionnelle Google Gemini REST, clé API chiffrée dans le coffre (opt-in). Deux cascades : les fonctions d'analyse (`gemini-3.5-flash-lite` → `gemini-3.8-flash`) et le chat, qui privilégie la qualité (`gemini-3.8-flash` → `gemini-3.5-flash-lite`). Repli automatique sur saturation (503/429). Batchs : renommage (15), catégorisation (15), récurrences (20). Propositions de budgets (`proposeBudgets`) et analyse de période (`analyzePeriod`) ne reçoivent que des agrégats. Parseurs purs testés. L'interface reste sans noms de modèles internes.
- `src/lib/assistant-tools.ts` — 11 outils en lecture seule du chat (`period_summary`, `search_transactions`, `get_transaction`, `top_merchants`, `category_breakdown`, `monthly_series`, `balance_history`, `budget_status`, `recurring_series`, `coverage_status`, `allocations`). Chaque exécuteur renvoie un `summary` compact (seul contenu transmis au modèle) et des `artifacts` visuels. Schémas en types Gemini majuscules (`OBJECT`, `STRING`, `INTEGER`, `NUMBER`). `resolveToolRange` applique plage explicite > fenêtre en mois ancrée sur `referenceDate` > période globale.
- `src/lib/assistant-tools.ts` et `askAssistantWithTools` — boucle de function calling bornée (5 tours, 8 appels) puis requête finale sans outils. Renvoyer les parts du modèle telles quelles (dont `thoughtSignature`), une `functionResponse` par `functionCall` avec le même `id`, rôle `user` pour les réponses d'outil. Un outil en échec renvoie `{ error }` sans interrompre la réponse. Les appels d'outils sont **silencieux** : chaque artefact rejoint un pool avec un indice, et le modèle choisit lui-même 1 à 3 cartes via l'outil `present_artifacts` (indices fournis dans `artefacts_disponibles`). Sans choix, repli déterministe : un artefact par type, tours récents d'abord, pertinence décroissante.
- `src/lib/assistant-context.ts` — contexte agrégé (période, catégories, marchands, récurrences acceptées, budgets, runway) utilisé par les cartes d'analyse à la demande. Aucun libellé brut ni IBAN. Le chat, lui, interroge le coffre via `assistant-tools.ts`.
- `src/lib/router.ts` — routeur minimal par hash (`#/overview`, `#/analysis`, `#/budgets`, `#/assistant`, `#/transactions`, `#/recurring`, `#/merchants`, `#/coverage`, `#/manual`, `#/settings`).
- `src/app/routes.tsx` — registry unique des pages : libellé, icône, groupe de navigation, composant lazy, `requiresData`, onglet mobile. `AppShell`, `NAV_GROUPS`, la barre mobile et `PageOutlet` en dérivent ; ne pas réintroduire une liste de pages en parallèle.
- `src/lib/persist-queue.ts` — file d'écriture sérialisée avec coalescence. Le coffre ne doit jamais lancer deux `encryptVault()` concurrents ; `flushVaultWrites()` est exporté pour la mise à jour PWA et l'export.
- `src/lib/manual-ledger.ts` — fonctions pures `insertIntoLedger`, `removeFromLedger`, `updateInLedger` pour les saisies manuelles. Une mise à jour est atomique et conserve l'identifiant (donc les affectations de couverture).
- `src/lib/storage.ts` — `inspectEnvelope()` distingue coffre absent, valide et corrompu ; `status: 'corrupted'` affiche `VaultRecoveryScreen` et ne doit jamais être écrasé par l'écran de création.
- `src/lib/ai-errors.ts` — `AiFailure`, `classifyAiError`, `classifyAiStatus`. Reconnaît `TimeoutError`, `AbortError` et le `TypeError: Load failed` de Safari iOS.
- `src/lib/ai-notify.ts` — `guardAiOnline()` et `notifyAiFailure()` ouvrent la popup globale `AiNoticeDialog` pour hors ligne, timeout, saturation et clé invalide.
- `src/lib/connectivity.ts` / `src/hooks/use-online.ts` — état réseau réactif ; `navigator.onLine` n'est qu'un indice, les erreurs `fetch` sont classées séparément.
- `src/lib/install.ts` / `src/components/pwa/install-card.tsx` — capture précoce de `beforeinstallprompt`, détection standalone et instructions iOS.
- `src/components/pwa/update-prompt.tsx` — `useRegisterSW`, bannière de mise à jour, `flushVaultWrites()` avant rechargement. Jamais de `autoUpdate`.
- `src/components/theme-provider.tsx` / `theme-context.ts` — thème maison Clair/Sombre/Système, sans script injecté par un provider ; le script inline de `index.html` évite le flash au chargement.
- `src/components/mobile-tab-bar.tsx` — barre d'onglets basse (`lg:hidden`) et feuille « Plus ». Le `Sheet` porte `key={page}` et la navigation est repoussée d'une tâche après la fermeture.
- `src/components/data-list.tsx` — lignes tactiles utilisées sous `md` ; les tableaux restent la référence à partir de `md`.
- `src/components/payment-allocation-dialog.tsx` — traitement d'un paiement : plusieurs parts, revenus triés par proximité temporelle (`daysBefore`), disponible calculé via `allocationCapacity`, budgets des mois autour du paiement, enregistrement et passage au suivant. `CoveragePage` a deux onglets : Paiements (file) et Revenus (ventilation).
- `src/components/ai-notice-dialog.tsx` — popup IA globale montée dans `App`.
- `src/store/vault-store.ts` — état Zustand + sauvegarde chiffrée après chaque mutation (alias, catégories, décisions de récurrence, budgets, affectations de couverture, saisies manuelles, préférences IA, conversation de l'assistant, mot de passe). `setup` accepte les fichiers déjà parsés de l'onboarding ; `importRows` fusionne des lignes parsées (import avec mappage). Plus de `importFile`.
- `src/store/ui-store.ts` — période globale (preset + plage personnalisée), filtres transactions, actions de drill-down.
- `src/hooks/use-period.ts` — période courante/précédente dérivée du store UI.
- `src/pages/*.tsx` — les 10 pages ; `src/components/app-shell.tsx` — sidebar (groupes Pilotage / Explorer / Opérations / Système) + page active. `assistant-page` est un chat persistant (markdown léger, indicateur « Analyse en cours… », bouton « Nouveau chat ») : les appels d'outils ne sont pas montrés, seuls les artefacts choisis apparaissent. `src/components/assistant-artifacts.tsx` rend les cartes cliquables (opérations, marchands, récurrences, couverture, affectations) et les graphiques (anneau catégories, barres mensuelles, courbe de solde, jauges budgets) ; les transactions sont référencées par `id` et recalculées depuis le coffre.
- `src/components/ai-insight-card.tsx` — carte d'analyse à la demande (prompt libre + suggestions), masquée si l'IA est désactivée. Branchée sur la vue d'ensemble, les analyses, les budgets et la couverture.
- `src/pages/budgets-page.tsx` — budgets mensuels par catégorie ou globaux : CRUD, jauges vertes < 80 %, orange 80–100 %, rouges > 100 %, évaluées sur le mois de `referenceDate` pour rester cohérent avec des plafonds mensuels.
- `src/pages/manual-entry-page.tsx` — historique des saisies manuelles et point d'entrée « Nouvelle opération ». Le formulaire vit dans `quick-transaction-sheet.tsx`, partagé avec le « + » de la barre mobile : type, montant, libellé unique, catégorie pleine largeur, date, note optionnelle. Plus de champ « libellé bancaire » ni de nom lisible séparé. Le store propage le décalage de solde aux opérations suivantes.
- `src/components/balance-timeline.tsx` — timeline de solde découpée sur la période globale, sans brush ; `period-picker.tsx` — presets + plage personnalisée.
- `src/components/csv-importer.tsx` — sélecteur de fichiers CSV partagé par l'onboarding, la page Réglages et le coffre vide. Détecte le format ; si les en-têtes ne couvrent pas les champs requis, ouvre un panneau d'association des colonnes (date, date de valeur, débit, crédit, montant signé, libellé, solde), avec séparateur, séparateur décimal, signe des débits, en-têtes et aperçu des 4 premières lignes. Chaque fichier est parsé puis remis au parent via `onParsed` (`ParsedCsvFile`).
- `src/components/{setup,unlock}-screen.tsx`, `merchant-dialog.tsx`, `stat-card.tsx`, `category-badge.tsx` ; composants shadcn dans `src/components/ui/` (ne pas éditer si évitable ; `react-refresh` désactivé pour ce dossier). `setup-screen.tsx` suit 3 étapes : mot de passe → premier relevé facultatif (avec mappage) → IA opt-in ; les fichiers sont fusionnés au moment de `setup(password, aiConfig, imports)` pour une seule écriture chiffrée.
- Alias `@/*` → `src/*` (tsconfig + Vite). Le style shadcn utilise le paquet `cn`, pas `clsx`/`tailwind-merge` directement.

## Navigation & période

- Une seule période globale dans `ui-store` ; toutes les pages la consomment via `usePeriod()`. Défaut `12m`, ancré sur la dernière date du jeu de données (`referenceDate`), pas sur la date du jour.
- Les listes sont bornées à la période : transactions, marchands, saisie manuelle, file de paiements et liste des revenus de couverture, séries de récurrences (`seriesInRange`). La file de paiements est triée du plus récent au plus ancien par défaut et « Continuer »/l'auto-avance suivent cet ordre. Les budgets restent mensuels sur le mois de `referenceDate` ; les soldes, le runway et la disponibilité des fonds restent globaux et ne sont pas tronqués.
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

## PWA, hors ligne et mobile

- `vite-plugin-pwa` en `registerType: 'prompt'` ; `devOptions.enabled: false`. Le service worker ne se teste qu'avec `npm run build && npm run preview` (HTTPS ou `localhost`).
- `base` Vite vient de `VITE_BASE` (défaut `/`). Le manifest, `start_url`, `scope` et les icônes en dépendent : tester un build sous `/budget-analyzer/` avant GitHub Pages.
- Précache limité aux assets statiques ; `generativelanguage.googleapis.com` est en `NetworkOnly`. Ne jamais mettre le coffre, un libellé ou une requête IA dans `Cache Storage`.
- Icônes générées par `@vite-pwa/assets-generator` depuis `public/app-icon.svg`. `favicon.svg` reste l'ancien favicon détaillé ; les icônes PWA utilisent `app-icon.svg`.
- `index.html` : `viewport-fit=cover`, `interactive-widget=resizes-content`, `theme-color` clair/sombre, meta Apple. `AppShell` et les dialogues gèrent `env(safe-area-inset-*)`.
- Mobile : barre d'onglets Accueil / Transactions / **+** / Budgets / Plus sous `lg`. Le bouton central « + » ouvre la feuille de saisie rapide (`requestNewExpense` → `quickEntryOpen`), sans changer de page. « Plus » contient Analyses, Assistant, Récurrences, Marchands, Couverture, Saisie manuelle, Réglages, installation et verrouillage.
- `src/components/quick-transaction-sheet.tsx` — formulaire unique de saisie/édition, ouvert par `openQuickEntry()` depuis le « + », le bouton de la page Saisie ou une ligne d'historique. Il monte dans `AppShell` pour être disponible partout ; fermer la feuille remet `quickEntryEditingId` à `null`.
- `PeriodPicker` bascule en feuille inférieure sous `lg` ; ne pas remettre les presets en overflow horizontal dans le header.
- `DialogContent` accepte `mobileSheet` (défaut `true`) : feuille inférieure sous `sm`. Le panneau de détail passe `mobileSheet={false}` et utilise un Dialog plein écran.
- `DetailHost` : colonne scindée à partir de `md`, Dialog modal sous `md` avec piège de focus et entrée d'historique pour le retour Android. Le bouton retour ferme d'abord le détail.
- Les tableaux de données ont une déclinaison `DataList` sous `md` : transactions, marchands, détail mensuel, couverture, historique manuel.
- `PageOutlet` n'affiche `EmptyVault` que si `requiresData` est vrai. Réglages, Saisie manuelle et Assistant restent accessibles avec un coffre vide.
- `ThemeProvider` maison (pas `next-themes`) : Clair / Sombre / Système, meta `theme-color` mise à jour, script inline dans `index.html`.
- Les toasts passent en haut au centre sur mobile pour ne pas chevaucher la barre d'onglets.

## Clés d'accès (passkeys)

- `src/lib/passkey.ts` — WebAuthn + extension PRF. Le mot de passe du coffre est scellé par une clé HKDF dérivée du secret PRF, puis stocké chiffré dans `budget.passkey.v1` (hors coffre). Le mot de passe reste la méthode de secours ; ne jamais promettre un mode sans mot de passe.
- L'enregistrement se fait dans le setup (case « Déverrouiller avec une clé d'accès », effective à la création du coffre) et dans Réglages (mot de passe actuel demandé une fois). L'écran de verrouillage affiche « Déverrouiller avec une clé d'accès » si un enregistrement existe, puis appelle `unlock()` normalement.
- PRF n'est pas garanti par tous les gestionnaires : si la création ou l'assertion ne renvoie pas `prf.results.first`, échouer avec `no-prf` et laisser le mot de passe disponible. Certains gestionnaires ne renvoient PRF qu'à la seconde cérémonie : `registerPasskey` fait un `get()` de secours.
- Le mot de passe est modifié (`changePassword`) ou le coffre réinitialisé (`reset`) → `removePasskey()` est obligatoire : la clé scellerait l'ancien mot de passe.
- L'export du coffre ne contient ni la clé d'accès ni son secret PRF ; sur un autre appareil, seul le mot de passe fonctionne. Le documenter dans l'UI.
- `verifyPassword()` dans le vault-store sert uniquement à valider le mot de passe avant d'enregistrer une clé depuis Réglages.

## IA hors ligne

- Toute action IA passe par `guardAiOnline()` ou vérifie `isOnline()` avant le `fetch`.
- Les échecs `offline`, `timeout`, `quota` et `auth` ouvrent `AiNoticeDialog` ; les autres restent inline/toast. Ne pas multiplier les popups pour un batch : une par action.
- Le chat conserve le brouillon hors ligne et n'ajoute pas de message fantôme.
- `AiResult.failure` est typé ; `AiResult.error` reste la chaîne lisible pour les appelants existants.
- Les batches de récurrences sont découpés par 20 ; les batches marchands/catégories signalent un succès partiel par le nombre traité.

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
- Couverture : **aucun classement automatique**. Chaque paiement est traité dans la file `CoveragePage` → onglet Paiements, via `PaymentAllocationDialog`. Un paiement peut être réparti sur plusieurs revenus (`CustomAllocationPart[]`), chaque part étant plafonnée par la capacité restante du revenu. Les valeurs historiques chaîne/objet restent lues ; une chaîne vaut la totalité de la dépense, un objet `{ creditId, amount }` une part unique. Un revenu **postérieur** au paiement est autorisé (pas de `canFund`) : il peut résorber un découvert ou financer une dépense en attente. Le dialogue trie les revenus par proximité temporelle (avant comme après), permet d'afficher toutes les entrées et passe au paiement suivant dès que le montant est entièrement affecté. Le reliquat non affecté reste `todo`/`partial` : ne jamais le couvrir implicitement. `coverageAvailability(segments, balance)` borne les fonds actifs au **solde bancaire réel** : un découvert antérieur est imputé aux crédits actifs les plus anciens.

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
- `vite-plugin-pwa` : `injectRegister: null` car l'enregistrement passe par `virtual:pwa-register/react`. Le module virtuel existe aussi en dev, mais le service worker n'y est pas actif.
- `Sheet` de la barre mobile : `key={page}` et navigation repoussée via `setTimeout(..., 0)` après la fermeture. Sans cela, le changement de route annule la fermeture et la feuille reste ouverte.
- `DialogContent` : le prop `mobileSheet={false}` est obligatoire pour un plein écran mobile (panneau de détail), sinon les classes `max-sm` le transforment en feuille inférieure.
- Radix peut laisser un portail à `data-state="closed"` avec l'animation de sortie bloquée (overlay `pointer-events:auto`). `index.css` force `display:none` sur les overlays/contenus fermés ; ne pas retirer cette règle, sinon les feuilles bloquent les clics après fermeture.
- Thème : ne pas réintroduire `next-themes` ; le provider maison évite le script injecté et le warning React 19. `useTheme` s'importe depuis `theme-context.ts`.
- `useIsMobile` est réservé aux comportements structurels (panneau, cache). Pour le reste, préférer les variants CSS `max-sm` / `sm`.

## Tests de non-régression (fixtures locales, non versionnées)

- Fichier complet : 1 728 lignes, 0 erreur ; fichier court : 198 lignes, 0 erreur.
- Import complet puis court : 1 728 transactions, 198 ignorées, 0 ajout au second import.
- Identifiants uniques, dates triées, chaîne des soldes sans rupture.
- 17 groupes `date + montant + libellé` à soldes distincts conservés.
- `src/lib/period.test.ts` couvre résolution des presets, plage précédente et bornes du jeu de données.
- `src/lib/recurring.test.ts` couvre la détection, les décisions pending/accepted/refused et l'exclusion des séries non acceptées des totaux mensuels.
- `src/lib/analytics.test.ts` couvre totaux, séries, catégories et `percentChange` (base quasi nulle → `null`).
- `src/lib/runway.test.ts` couvre l'absence de couverture automatique, les affectations manuelles multi-revenus, le reliquat non affecté, `paymentAllocationStatuses`, `allocationCapacity` (place disponible, split, blocage) et `coverageAvailability` (absorption du découvert, solde positif/négatif).
- `src/lib/assistant-tools.test.ts` couvre les 11 outils : plages, recherche d'opérations, agrégats, budgets, récurrences, couverture et affectations.
- `src/lib/ai.test.ts` couvre les prompts, la normalisation, les parseurs de réponses batch (marchands, catégories, récurrences, budgets, assistant), la boucle de function calling (signature et identifiant conservés, repli 503, outil inconnu) et la curation `present_artifacts`.
- `src/lib/ai-errors.test.ts` couvre `TimeoutError`, `AbortError`, `TypeError: Load failed`, 401/403/429/503 et la reconstruction depuis un message.
- `src/lib/persist-queue.test.ts` couvre la sérialisation, la coalescence, l'échec et `flush()`.
- `src/lib/manual-ledger.test.ts` couvre insertion en tête/milieu/fin, suppression, changement de date, continuité des soldes et immutabilité.
- `src/lib/storage.test.ts` couvre coffre absent, valide, JSON invalide, schéma invalide et effacement.
- `src/lib/passkey.test.ts` couvre l'indisponibilité hors navigateur et les messages d'erreur PRF/annulation.
- Crypto : aller-retour, IV différent à chaque écriture, mauvais mot de passe et ciphertext altéré rejetés.
- Recette manuelle PWA/mobile : `docs/pwa-test-plan.md`.
