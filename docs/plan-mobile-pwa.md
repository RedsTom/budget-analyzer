# Plan — Mobile, PWA et consolidation d'architecture

> Statut : implémenté en autonomie (lots 0 à 4, une partie du lot 5 et le lot 6).
> Périmètre : rendre l'application installable, utilisable hors ligne et confortable sur mobile, tout en corrigeant les points d'architecture qui bloquent cette évolution.
> Contrainte absolue : rester 100 % local, sans backend, sans télémétrie, avec le coffre chiffré actuel.
>
> Réalisé : PWA (manifest, icônes, service worker, mise à jour, installation),
> thème système, shell mobile (onglets + feuille « Plus »), période en feuille
> inférieure, listes tactiles, dialogues en feuilles inférieures, panneau de
> détail modal avec retour, file d'écriture, grand livre manuel atomique, coffre
> corrompu, export/restauration, erreurs IA typées et popup hors ligne.
>
> Différé : découpage complet de `src/lib/ai.ts` en sous-modules et extraction
> des hooks dérivés (`useRecurringSeries`, `useAssistantContext`). Le reste du
> plan est en place et vérifié par `npm run lint && npm run test && npm run build`.
>
> Ajouts ultérieurs : bouton central « + » ouvrant une feuille de saisie rapide,
> page Saisie manuelle réduite à l'historique, formulaire simplifié (libellé
> unique, catégorie pleine largeur, note optionnelle), et déverrouillage par
> clé d'accès WebAuthn/PRF avec le mot de passe en secours.
>
> Runway : le FIFO automatique a été retiré. L'onglet Paiements traite chaque
> dépense une par une, avec une ou plusieurs parts de revenus, des revenus triés
> par proximité temporelle et les budgets des mois autour du paiement. Aucun
> paiement n'est couvert implicitement.

---

## 1. Objectifs et principes

### Objectifs produit

1. **PWA installable** sur Android, iOS et desktop : icône, écran de lancement, mode standalone, mise à jour contrôlée.
2. **Fonctionnement hors ligne complet** pour tout ce qui est local : déverrouillage, import CSV, analyses, budgets, récurrences, couverture, saisie manuelle, réglages.
3. **IA explicitement en ligne** : si le réseau manque, une popup claire explique la situation, sans casser le reste de l'application.
4. **Expérience mobile quasi native** : navigation par onglets, listes tactiles, feuilles inférieures, zones sûres, clavier, retour Android, thème système.
5. **Performance mobile** : chargement initial plus léger, pages chargées à la demande, graphiques adaptés aux petits écrans.
6. **Fiabilité des données** : aucune écriture concurrente perdue, édition manuelle atomique, sauvegarde/export du coffre, écran dédié si le coffre est corrompu.

### Principes directeurs

- **Local-first d'abord** : le service worker ne met en cache que les assets statiques. Jamais le coffre, jamais les requêtes IA.
- **Dégradation gracieuse** : l'IA est une option ; son absence ne doit jamais bloquer une analyse locale.
- **Changements incrémentaux** : on ne réécrit pas l'application. On ajoute une couche PWA, puis on adapte les écrans, puis on rembourse la dette d'architecture sous couvert de tests.
- **Le desktop ne régresse pas** : la sidebar, les tableaux et les panneaux actuels restent la référence à partir de `lg`.
- **Une seule source de vérité par sujet** : routes, navigation, erreurs IA, écritures du coffre.

---

## 2. Audit de l'existant

### 2.1 Ce qui est déjà solide

- Séparation nette entre logique métier (`src/lib`) et UI (`src/pages`, `src/components`).
- Coffre chiffré bien isolé (`crypto.ts`, `storage.ts`) avec Zod, IV neuf à chaque écriture, PBKDF2 310 000 itérations.
- Dédoublonnage et modèle de données documentés et testés.
- `DetailHost` a déjà un comportement mobile plein écran sous `md`, avec `inert` quand il est fermé.
- La sidebar devient un `Sheet` sous `lg`.
- Les tableaux cachent déjà certaines colonnes sur petit écran.
- `Input` utilise `text-base` sous `md`, ce qui évite le zoom automatique iOS sur les champs.
- Les tests Vitest couvrent la crypto, le CSV, le dédoublonnage, les récurrences, le runway, les outils de l'assistant et les parseurs IA.

### 2.2 Constats mobile

| Constat | Fichier / preuve | Impact |
| --- | --- | --- |
| Tous les écrans sont importés statiquement | `app-shell.tsx` importe les 10 pages | Un seul chunk JS de **1,2 Mo** (351 Ko gzip) au premier chargement |
| Header surchargé et qui passe sur deux lignes | `app-shell.tsx` : menu + marque + `PeriodPicker` + verrou, `flex-wrap` | Perte d'espace vertical, actions serrées |
| Presets de période en overflow horizontal | `period-picker.tsx` | Difficile à utiliser au doigt, pas de vue d'ensemble |
| Tableaux horizontaux | transactions, marchands, analyses, couverture, saisie manuelle | Scroll horizontal, colonnes masquées, actions peu accessibles |
| Boutons souvent < 44 px | `button.tsx` : `sm` = 28 px, `icon-sm` = 28 px | Cibles tactiles trop petites |
| Dialogues centrés, non adaptés au clavier | `ui/dialog.tsx` | Formulaires masqués par le clavier, fermeture difficile |
| Panneau de détail non modal sur mobile | `entity-panels.tsx` | Pas de piège de focus, le fond reste focusable, bouton retour Android non géré |
| Graphiques à hauteur fixe | `balance-timeline.tsx`, `analysis-page.tsx`, `assistant-artifacts.tsx` | Axes et légendes écrasés sur 320–390 px |
| Zone de saisie assistant en `text-sm` | `assistant-page.tsx` | Zoom iOS au focus |
| Indicateur de sauvegarde caché sur mobile | `app-shell.tsx`, `MobileSaving` en `hidden sm:inline` | L'utilisateur ne sait pas si son action est enregistrée |
| Export CSV par simple `a.download` | `transactions-page.tsx` | Comportement variable en PWA iOS |
| Drag & drop mis en avant | `csv-importer.tsx` | Inutile au doigt, encombre l'écran |
| Aucun reset de scroll entre pages | `AppShell` garde le même `<main>` | On arrive au milieu de la page suivante |
| `text-[10px]` / `text-[11px]` nombreux | plusieurs pages et artefacts | Lisibilité insuffisante sur mobile |

### 2.3 Constats PWA / hors ligne

- Aucun `manifest`, aucun service worker, aucune icône PWA, aucun `theme-color`.
- `index.html` ne contient que le viewport de base, sans `viewport-fit=cover`, sans meta Apple.
- Aucun état de connectivité (`online` / `offline`) dans l'application.
- Les erreurs réseau de l'IA sont classées par message texte dans `ai.ts`, avec deux angles morts :
  - `AbortSignal.timeout()` rejette souvent avec `TimeoutError`, pas `AbortError` ;
  - Safari iOS renvoie `TypeError: Load failed`, que le test `/failed to fetch|network/` ne couvre pas.
- Aucune popup ni bannière pour expliquer que l'IA nécessite Internet.
- Le thème sombre existe en CSS (`.dark`) mais n'est jamais activé : `next-themes` est installé, `sonner.tsx` l'utilise, mais aucun `ThemeProvider` n'est monté.

### 2.4 Dette d'architecture et bugs découverts

| Sévérité | Problème | Détail |
| --- | --- | --- |
| **Haute** | Écritures du coffre non sérialisées | `vault-store.ts` appelle `persist()` après chaque mutation. Deux mutations rapprochées lancent deux `encryptVault()` concurrents ; la dernière écriture peut être une snapshot plus ancienne. |
| **Haute** | Erreurs de sauvegarde ignorées | Plusieurs actions font `void setRecurringDecision(...)` sans `catch`. Si `localStorage` est plein, l'état en mémoire change mais le disque non ; perte silencieuse au rechargement. |
| **Haute** | Édition manuelle non atomique | `updateManualTransaction()` supprime puis réinsère via deux `persist()`. Une erreur entre les deux perd l'opération. |
| **Haute** | Coffre corrompu = coffre vide | `readEnvelope()` renvoie `null` si le JSON est invalide. `status` devient `empty` et l'écran de création peut écraser un coffre récupérable. |
| **Haute** | Réglages et saisie manuelle inaccessibles sans données | `PageOutlet` renvoie `<EmptyVault />` avant le `switch`, pour toutes les pages. Impossible d'ouvrir les réglages ou d'ajouter une opération manuelle dans un coffre vide. |
| **Haute** | `batchAnalyzeRecurring` n'est pas découpé | Le commentaire et `AGENTS.md` annoncent 20 éléments par lot, mais toute la liste part dans un seul prompt. |
| **Moyenne** | Résultats partiels silencieux | `batchSuggestMerchantNames` et `batchSuggestMerchantCategories` ignorent les chunks en échec sans le dire à l'utilisateur. |
| **Moyenne** | `ai.ts` monolithique | 1 259 lignes : client HTTP, prompts, parseurs, batches, chat à outils. Difficile à tester et à faire évoluer. |
| **Moyenne** | Dérivations recalculées | `detectRecurring` est calculé dans la vue d'ensemble, les récurrences et le panneau de détail ; `buildAssistantContext` est reconstruit dans 4 pages. |
| **Moyenne** | Aucune route registry | La navigation (`NAV_GROUPS`) et le `switch` de `PageOutlet` dupliquent la même liste de pages. |
| **Moyenne** | Pas d'error boundary | Une erreur dans un graphique ou une page blanchit toute l'application. |
| **Moyenne** | Pas de lazy loading | Voir 2.2 : tout Recharts, toutes les pages et l'assistant sont dans le chunk initial. |
| **Basse** | Pas de sauvegarde/export du coffre | Sur mobile, une éviction du navigateur est irréversible. |
| **Basse** | Thème système inactif | Les tokens `.dark` sont morts. |
| **Basse** | Pas de migration de schéma centralisée | `ignoredRecurring` est migré à la main dans `unlock()`. |

### 2.5 Mesures de départ

- Build actuel : `dist/assets/index-*.js` = 1 202 Ko, 351 Ko gzip ; CSS = 91 Ko.
- 10 pages, 11 fichiers de tests, aucune dépendance PWA.
- Cible raisonnable après lazy loading : **chunk initial ≤ 300 Ko gzip**, plus gros chunk de route ≤ 150 Ko gzip, à vérifier avec `vite build` et un rapport de bundle.

---

## 3. Expérience cible

### 3.1 Navigation mobile

- **Barre d'onglets basse** fixe, 5 emplacements :
  1. Vue d'ensemble ;
  2. Transactions ;
  3. **+** — action centrale pour ajouter une dépense ;
  4. Budgets ;
  5. **Plus**.
- « Plus » ouvre une feuille inférieure avec : Analyses, Assistant, Récurrences, Marchands, Couverture & runway, Saisie manuelle, Réglages, Installer l'application, Verrouiller.
- L'onglet actif est visible ; quand la page courante est dans « Plus », l'onglet « Plus » est actif et la feuille affiche une coche sur la page.
- Hauteur de barre : 56 px + `env(safe-area-inset-bottom)`. Le contenu principal reçoit un padding bas équivalent.
- La sidebar desktop reste inchangée à partir de `lg`.
- Tablette `md`–`lg` : barre basse également, plus confortable qu'un menu hamburger.
- L'assistant conserve la barre, mais la zone de saisie est remontée au-dessus de celle-ci.

### 3.2 Header et période

- Mobile : une seule ligne de 48–56 px.
  - titre de la page (ou marque sur la vue d'ensemble) ;
  - bouton période compact affichant le libellé courant (`12 mois`, `Tout`, etc.) ;
  - indicateur de sauvegarde (petit spinner ou point d'erreur) ;
  - plus de bouton verrou dans le header : il va dans « Plus » et dans Réglages.
- Le bouton période ouvre une **feuille inférieure** :
  - presets en grille de boutons larges ;
  - plage personnalisée avec deux champs date ;
  - bouton « Appliquer » sticky au-dessus de la zone sûre.
- Desktop : le `PeriodPicker` actuel avec pills reste, mais il est déplacé dans `PageHeader` ou gardé dans le header global selon la place.
- `PageHeader` mobile : titre `text-xl`, description `text-xs` limitée à 2–3 lignes, actions sur une ligne scrollable ou dans un menu.

### 3.3 Listes plutôt que tableaux

À partir de `md`, conserver les tableaux. En dessous, utiliser des lignes de liste :

- **Transactions** : date + marchand + libellé brut tronqué + montant signé ; catégorie en badge discret ; tap = panneau de détail. Le crayon disparaît de la ligne, l'édition se fait depuis le panneau.
- **Marchands** : nom + catégorie + volume + nombre d'opérations ; tap = détail ; action « Modifier » dans le panneau.
- **Détail mensuel (Analyses)** : mois + net en vedette, entrées/dépenses en secondaire, tap = drill-down.
- **Couverture** : les dépenses d'un crédit deviennent des lignes lisibles au lieu d'un tableau imbriqué horizontal.
- **Saisie manuelle** : historique en lignes, formulaire au-dessus.
- **Récurrences** : déjà en colonne sur mobile ; augmenter les cibles tactiles et regrouper les actions.
- **Import CSV** : aperçu en fiches (date/libellé, débit/crédit/solde) au lieu d'un tableau horizontal.

Composants proposés :

- `src/components/data-list.tsx` : `DataList`, `DataListRow` avec `primary`, `secondary`, `meta`, `amount`, `onTap`, `actions`.
- `DataListRow` : `min-h-14`, `px-4`, `py-3`, `tabular-nums`, `truncate`, focus visible, `aria-label` si nécessaire.
- Les pages gardent leurs tables dans un conteneur `hidden md:block` et rendent la liste en `md:hidden`. Les données et le tri restent partagés.

### 3.4 Panneau de détail

- Desktop : colonne scindée actuelle.
- Mobile : panneau plein écran rendu dans un **Radix Dialog modal** (piège de focus, `Escape`, blocage du scroll de fond), pas un simple `<aside>`.
- En-tête avec bouton retour + titre + fermer ; footer sticky au-dessus de la zone sûre.
- **Bouton retour Android / geste retour** : ouvrir le détail pousse une entrée d'historique ; le retour ferme le panneau au lieu de quitter l'application.
- Ajouter une action « Modifier le marchand » dans le panneau pour ne pas perdre l'édition inline des tableaux.
- Transition respectant `prefers-reduced-motion`.
- Étape ultérieure : détail deep-linkable (`#/transactions?detail=...`) plutôt qu'un simple état local.

### 3.5 Dialogues et formulaires

- Sous `sm`, tous les `DialogContent` deviennent des **feuilles inférieures** :
  - `top-auto bottom-0 left-0 translate-x-0 translate-y-0` ;
  - `max-h-[85dvh]`, `overflow-y-auto`, coins supérieurs arrondis ;
  - padding bas `env(safe-area-inset-bottom)`.
- Les `DialogFooter` restent visibles et sticky.
- Champs : `inputMode` adapté (`decimal` pour les montants), `autoComplete`, `enterKeyHint`, `autoCapitalize="none"` pour les clés API.
- Le dialogue d'import et le panneau de mapping deviennent des formulaires empilés, pas des grilles à deux colonnes.
- Actions destructives : `AlertDialog` conservé, avec boutons pleine largeur sur mobile.

### 3.6 Graphiques

- Hook `useMediaQuery('(max-width: 639px)')` pour passer un mode `compact` aux composants de graphique.
- En compact :
  - hauteur 180–200 px au lieu de 260–300 ;
  - largeur d'axe Y réduite, moins de ticks, `minTickGap` plus grand ;
  - marges réduites, légende en dessous ;
  - animations Recharts désactivées (`isAnimationActive={false}`), pour la performance et `prefers-reduced-motion`.
- Chaque graphique reçoit un `aria-label` résumant la tendance et, si possible, un tableau ou une liste de valeurs repliée pour les lecteurs d'écran.
- Vérifier les tooltips au doigt (Recharts 3) ; si nécessaire, passer le tooltip en déclenchement au clic.

### 3.7 Détails natifs

- `h-svh` → `h-dvh` avec repli, `min-h-dvh` pour les écrans d'accueil/déverrouillage.
- `viewport-fit=cover` + utilitaires `pt-safe` / `pb-safe` / `px-safe`.
- `overscroll-behavior-y: none` sur le shell pour éviter le pull-to-refresh accidentel ; conserver le scroll normal dans les pages.
- `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`.
- `input, textarea, select { font-size: 16px }` sous `md` pour éviter le zoom iOS.
- Thème `system` par défaut, avec choix Clair / Sombre / Système dans Réglages.
- `theme-color` dynamique selon le thème résolu.
- Toasts remontés au-dessus de la barre d'onglets (`mobileOffset` Sonner ou position haute sur mobile).
- Export CSV : `navigator.share({ files })` si disponible, sinon téléchargement classique.
- Install : carte dans Réglages + entrée dans « Plus » ; instructions iOS (Partager → Sur l'écran d'accueil), prompt natif Android via `beforeinstallprompt`.

---

## 4. IA hors ligne — comportement précis

### 4.1 Modèle d'erreur

Créer une classification typée dans `src/lib/ai/errors.ts` :

```ts
type AiFailureCode =
  | 'offline'
  | 'timeout'
  | 'quota'
  | 'auth'
  | 'server'
  | 'invalid-response'
  | 'unknown'

interface AiFailure {
  code: AiFailureCode
  message: string
  retryable: boolean
  status?: number
}
```

Règles :

- `navigator.onLine === false` → `offline` **avant** tout `fetch`.
- `TypeError` au `fetch` (y compris `Load failed` sur Safari) → `offline`.
- `TimeoutError` ou `AbortError` → `timeout`.
- 400/403 → `auth`.
- 429 → `quota`.
- 5xx → `server`.
- Réponse vide → `invalid-response`.
- Tout le reste → `unknown`.

`AiResult` conserve `error: string` pour ne pas casser les appelants, et ajoute `failure?: AiFailure`.

### 4.2 Popup globale

Composant `AiNoticeDialog` monté dans `App`, piloté par `src/store/ai-notice-store.ts`.

Déclenchement :

- uniquement sur une action IA de l'utilisateur ;
- pas au chargement de l'application ;
- pas pour chaque chunk d'un batch : un seul popup par action, puis un toast de synthèse.

Contenu :

- **Titre** : « L'IA nécessite une connexion »
- **Corps** : « Le reste de l'application continue de fonctionner hors ligne. Vos données restent dans le coffre chiffré. Reconnectez-vous pour utiliser l'assistant, les synthèses et le renommage automatique. »
- **Actions** :
  - « Réessayer » (masqué ou désactivé si toujours hors ligne) ;
  - « Continuer hors ligne » (action principale) ;
  - « Ouvrir les réglages » si `auth`.

Variantes :

- `timeout` : « Le service met trop de temps à répondre. »
- `quota` : « Le service est temporairement saturé. »
- `auth` : « La clé API est invalide ou expirée. »

### 4.3 Bannière et états

- Bannière fine sous le header quand `offline` : « Hors ligne — les analyses locales restent disponibles. »
- Toast « Connexion rétablie » au retour en ligne.
- Boutons IA :
  - restent visibles et actifs ;
  - au clic hors ligne, ouvrent immédiatement la popup sans spinner ni requête ;
  - si le réseau tombe pendant la requête, erreur inline + bouton « Réessayer », et popup si l'échec est réseau.
- Chat :
  - envoi hors ligne : ne pas ajouter le message au fil, conserver le brouillon, ouvrir la popup ;
  - échec en vol : le message utilisateur reste persisté, l'erreur s'affiche avec « Réessayer » comme aujourd'hui.
- Réglages : le test de clé hors ligne ouvre la popup ; l'activation de l'IA et l'enregistrement de la clé restent possibles localement.
- Onboarding : note « L'IA sera testable une fois connecté » ; l'étape reste facultative.

### 4.4 Service worker et IA

- `NetworkOnly` explicite pour `https://generativelanguage.googleapis.com/*`.
- Aucun cache des requêtes POST, aucun cache des réponses contenant des données utilisateur.
- Vérification en recette : inspecter `Cache Storage`, rechercher `AIza`, un libellé bancaire ou un montant ; résultat attendu : aucun.

---

## 5. Architecture cible

### 5.1 Couche PWA

**Dépendances**

- `vite-plugin-pwa@2.x` (compatible Vite 8 selon ses peer dependencies) ;
- `@vite-pwa/assets-generator@2.x` pour générer les icônes depuis un SVG carré.

**Configuration `vite.config.ts`**

- `registerType: 'prompt'` : pas de rechargement automatique pendant une saisie.
- `manifest` :
  - `name`, `short_name`, `description`, `lang: 'fr'` ;
  - `start_url` et `scope` alignés sur le `base` Vite ;
  - `display: 'standalone'`, `display_override: ['standalone']` ;
  - `background_color`, `theme_color` ;
  - icônes 192, 512, maskable 512, Apple 180 ;
  - `shortcuts` : Saisie manuelle, Assistant, Transactions.
- `workbox` :
  - `globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}']` ;
  - `navigateFallback: 'index.html'` ;
  - `cleanupOutdatedCaches: true` ;
  - `clientsClaim: true`, `skipWaiting: false` ;
  - `runtimeCaching` NetworkOnly pour Gemini.
- `devOptions.enabled: false` : le service worker ne perturbe pas le HMR. Recette PWA via `npm run build && npm run preview`.
- Si Rolldown pose problème avec `generateSW`, repli sur `injectManifest` avec un service worker minimal.

**Fichiers**

- `index.html` : viewport `viewport-fit=cover`, `interactive-widget=resizes-content`, `theme-color` clair/sombre, `color-scheme`, meta Apple, icône Apple.
- `public/app-icon.svg` : source carrée simplifiée (le favicon actuel est un SVG 48×46 avec filtres, peu adapté au raster).
- `public/pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`.
- `src/components/pwa/update-prompt.tsx` : `useRegisterSW`, bannière « Nouvelle version disponible » avec « Recharger » / « Plus tard ».
- `src/components/pwa/install-card.tsx` : installation, instructions iOS, détection `display-mode: standalone`.
- `src/lib/install.ts` : capture précoce de `beforeinstallprompt` au chargement du module, pour ne pas rater l'événement avant le montage React.
- `tsconfig.app.json` : ajouter `vite-plugin-pwa/client` aux `types`.

**Cycle de mise à jour**

1. Nouveau service worker détecté → bannière.
2. « Plus tard » → aucun rechargement.
3. « Recharger » → `await flushVaultWrites()` puis `updateServiceWorker(true)`.
4. Ne jamais recharger automatiquement pendant qu'un dialogue est ouvert ou qu'une sauvegarde est en cours.

### 5.2 Routing, navigation et performance

Créer `src/app/routes.tsx` :

```ts
interface AppRoute {
  id: PageId
  label: string
  shortLabel?: string
  icon: LucideIcon
  group: 'Pilotage' | 'Explorer' | 'Opérations' | 'Système'
  component: LazyExoticComponent<ComponentType>
  requiresData: boolean
  mobileTab: boolean
}
```

- `NAV_GROUPS`, la barre mobile, la feuille « Plus » et `PageOutlet` dérivent de cette registry.
- `React.lazy` + `Suspense` avec `PageSkeleton`.
- `requiresData` : `overview`, `analysis`, `budgets`, `transactions`, `recurring`, `merchants`, `coverage` ; `assistant`, `manual`, `settings` restent accessibles avec un coffre vide.
- `document.title` mis à jour à chaque route.
- Scroll du `<main>` remis à zéro à chaque changement de page.
- `ErrorBoundary` par route : message court, boutons « Réessayer » et « Verrouiller ».
- Le routeur hash reste : compatible GitHub Pages, aucun fallback serveur nécessaire.

### 5.3 Couche données

**File d'écriture sérialisée**

Extraire `src/lib/persist-queue.ts` :

- une seule écriture à la fois ;
- coalescence des mutations qui arrivent pendant une écriture ;
- la promesse retournée résout après l'écriture qui inclut la mutation ;
- `flush()` pour la mise à jour PWA et l'export ;
- `saving` reflète l'état de la file, pas une simple booléenne.

Pseudo-flux :

```text
schedule() -> marque dirty, retourne la promesse du tour courant
si une écriture tourne -> elle rebouclera sur le dernier snapshot
sinon -> boucle : snapshot(get()) -> encrypt -> write -> tant que dirty
```

**Édition manuelle atomique**

- Extraire une fonction pure `applyManualTransaction(transactions, input)` qui calcule le nouveau grand livre, les soldes et les `order`.
- `updateManualTransaction` fait un seul `set` + un seul `persist`.
- Tests : insertion au début, au milieu, à la fin ; changement de date ; suppression ; chaîne de soldes continue.

**Coffre corrompu**

- `storage.ts` expose `inspectEnvelope(): { status: 'missing' | 'valid' | 'corrupted'; raw?: string }`.
- `vault-store` ajoute `status: 'corrupted'`.
- `App.tsx` affiche un `VaultRecoveryScreen` :
  - « Le coffre enregistré est illisible. » ;
  - « Télécharger la sauvegarde brute » (le JSON chiffré, inutilisable sans mot de passe mais récupérable) ;
  - « Supprimer et repartir de zéro » avec confirmation.
- Ne jamais afficher l'écran de création par-dessus un coffre corrompu.

**Sauvegarde / export**

- Bouton « Exporter le coffre chiffré » dans Réglages : télécharge l'enveloppe JSON.
- Bouton « Restaurer une sauvegarde » : sélection de fichier, validation Zod, écriture, rechargement.
- `navigator.storage.persist()` demandé après le déverrouillage ou l'installation, pour réduire les évictions.
- Afficher `navigator.storage.estimate()` dans Réglages si disponible.

**Erreurs de sauvegarde**

- `vault-store.error` affiché dans le shell (bandeau + toast), avec action « Réessayer ».
- Ne plus faire de `void mutation()` sans gestion d'erreur : soit l'appelant `await` et affiche un toast, soit un helper central le fait.

**Schéma**

- `src/lib/vault-schema.ts` : version, migrations pures, validation.
- Migrer `ignoredRecurring` et les futures évolutions dans une fonction unique testée.

### 5.4 Couche IA

Découper `src/lib/ai.ts` (1 259 lignes) en modules :

```text
src/lib/ai/
  client.ts       fetch, timeout, cascade de modèles, classification
  errors.ts       AiFailure, classifyAiError, describeError
  merchants.ts    nom + batch
  categories.ts   catégorisation + batch
  recurring.ts    décisions + batch découpé par 20
  budgets.ts      propositions
  insights.ts     synthèse de période
  assistant.ts    chat à outils, artefacts, curation
  index.ts        réexports (compatibilité)
```

- Conserver `src/lib/ai.ts` comme barrel temporaire pour ne pas casser les imports.
- `requestJson` / `requestText` partagent timeout, cascade, classification et logs éventuels.
- Les batches retournent un statut partiel exploitable (`failed`, `processed`) pour que l'UI dise « 12 marchands traités, 3 non traités ».
- `batchAnalyzeRecurring` découpe réellement par 20.
- Ajouter un `AbortSignal` optionnel pour annuler une requête quand l'utilisateur quitte la page ou clique « Stop ».

### 5.5 Système UI

- `ThemeProvider` (`next-themes`) dans `App.tsx`, `attribute="class"`, `defaultTheme="system"`.
- `ThemeColor` : met à jour `<meta name="theme-color">` selon le thème résolu.
- `index.css` :
  - `color-scheme: light dark` ;
  - utilitaires safe-area ;
  - cibles tactiles minimales ;
  - `font-size: 16px` sur les champs mobiles ;
  - `overscroll-behavior` ;
  - `@media (prefers-reduced-motion: reduce)`.
- `DialogContent` : feuille inférieure sous `sm`.
- `SheetContent side="bottom"` : safe area.
- `Toaster` : offset mobile.
- `PageHeader` : variante compacte.
- `DataList` : primitives de listes.
- `useMediaQuery`, `useOnline`, `useAiAction`.
- `ErrorBoundary`.

### 5.6 Données dérivées

Créer des hooks partagés pour éviter les recalculs :

- `useRecurringSeries()` : cache par identité de `transactions`, `recurringDecisions`, `aliases`.
- `useAssistantContext()` : remplace les 4 constructions dupliquées.
- `useBalanceData()` : points + projection + runway.
- `useDeferredValue` sur la recherche des transactions et des marchands.
- Les caches sont invalidés par identité, pas par contenu, pour rester simples et sûrs.

### 5.7 Tests et qualité

Tests unitaires à ajouter :

- `ai/errors.test.ts` : `TimeoutError`, `AbortError`, `TypeError: Load failed`, 400/403/429/503, réponse vide.
- `persist-queue.test.ts` : ordre, coalescence, `flush`, erreur.
- `manual-ledger.test.ts` : édition atomique, dates, soldes.
- `routes.test.ts` : pages accessibles sans données, titres, onglets.
- `vault-recovery.test.ts` : enveloppe absente, JSON invalide, enveloppe invalide.
- `ai-batches.test.ts` : découpage 20, résultats partiels.

Recette manuelle :

- Chrome Android, Safari iOS, Firefox desktop, Chrome desktop.
- 320 / 375 / 390 / 430 / 768 / 1024 px.
- Installation, lancement standalone, mise à jour, offline, retour arrière, clavier, safe areas.
- Lighthouse mobile : Performance, Accessibilité, Best Practices. La catégorie PWA n'existe plus dans les versions récentes de Lighthouse ; l'installabilité se vérifie manuellement.

---

## 6. Lots d'exécution

### Lot 0 — Fondations et quick wins (2–3 j)

**But** : corriger les points qui bloquent tout le reste, sans encore toucher au design global.

- `PageOutlet` : gating `requiresData`, accès Réglages/Saisie manuelle sans données.
- File d'écriture sérialisée + `flushVaultWrites()`.
- Édition manuelle atomique.
- `inspectEnvelope` + état `corrupted`.
- Error boundary racine.
- `useOnline` + bannière offline minimale.
- Classification d'erreurs IA (`TimeoutError`, `Load failed`) + tests.
- Reset du scroll et `document.title` au changement de page.
- `viewport-fit=cover`, safe-area de base, `text-base` sur le textarea assistant.
- Indicateur de sauvegarde visible sur mobile.
- `npm run lint && npm run test && npm run build`.

**Critère de sortie** : les bugs de données sont couverts par des tests, l'application ne peut plus perdre silencieusement une écriture, et un coffre vide donne accès aux réglages et à la saisie manuelle.

### Lot 1 — Socle PWA (2–3 j)

**But** : application installable et réellement disponible hors ligne.

- Installation de `vite-plugin-pwa` + `@vite-pwa/assets-generator`.
- `manifest`, icônes, meta Apple, `theme-color`.
- Service worker `generateSW`, précache des assets, `navigateFallback`.
- `NetworkOnly` Gemini.
- `UpdatePrompt` avec `useRegisterSW`, flush avant rechargement.
- `InstallCard` + capture précoce de `beforeinstallprompt`.
- `tsconfig` types.
- Documentation de déploiement (HTTPS, `base` GitHub Pages).

**Critère de sortie** : après un premier chargement, couper le réseau, recharger, déverrouiller le coffre et naviguer partout. Aucune requête IA mise en cache. Une nouvelle version déclenche une bannière, pas un rechargement surprise.

### Lot 2 — Shell mobile et navigation (3–4 j)

**But** : sensation d'application native.

- `routes.tsx` + lazy loading + `Suspense`.
- Barre d'onglets basse + feuille « Plus ».
- Header compact, bouton période, `PeriodSheet`.
- `PageHeader` responsive.
- `ThemeProvider` + sélecteur Clair/Sombre/Système + `ThemeColor`.
- Padding bas du contenu, safe areas header/nav.
- Toaster au-dessus de la nav.
- `motion-reduce` sur les transitions.

**Critère de sortie** : aucune page n'a besoin du menu hamburger ; la période est accessible en deux taps ; le thème système fonctionne ; les onglets et le header ne créent ni overflow ni saut de mise en page.

### Lot 3 — Contenus tactiles (5–7 j)

**But** : tous les écrans sont confortables au doigt.

- `DataList` + déclinaisons Transactions, Marchands, Analyses, Couverture, Saisie manuelle.
- Actions secondaires déplacées dans le panneau de détail ou un menu.
- `DetailHost` mobile en Dialog modal + historique + focus trap.
- `DialogContent` en feuille inférieure ; footers sticky.
- Formulaires : `inputMode`, `autoComplete`, suppressions des grilles trop larges.
- CSV : import au doigt, aperçu en fiches.
- Graphiques : mode compact, animations coupées, `aria-label`.
- Export CSV via Web Share API si disponible.
- Audit des tailles de texte et des cibles tactiles.

**Critère de sortie** : à 320 px, aucun scroll horizontal de page ; toutes les actions principales sont à ≥ 44 px ; le clavier ne cache jamais le bouton de validation ; le retour ferme le panneau de détail.

### Lot 4 — IA hors ligne (2 j)

**But** : l'IA échoue proprement et explique pourquoi.

- `AiFailure` typé, `describeError` remplacé.
- `ai-notice-store` + `AiNoticeDialog`.
- `useAiAction` / helper pour centraliser les erreurs des cartes, du chat, des batches, des réglages et de l'onboarding.
- Préflight `navigator.onLine` avant tout appel.
- Bannière offline + toast de reconnexion.
- Textes français validés.
- Tests des classifications et des parcours.

**Critère de sortie** : réseau coupé, clic sur « Synthétiser » → popup immédiate, zéro requête réseau, application toujours utilisable. Réseau rétabli → « Réessayer » fonctionne.

### Lot 5 — Dette d'architecture et performance (4–6 j)

**But** : l'application reste maintenable après l'ajout du mobile.

- Découpage `ai.ts` en modules + barrel.
- Découpage ou slices du `vault-store` (session / données / préférences) sans changer l'API publique.
- Hooks dérivés (`useRecurringSeries`, `useAssistantContext`, `useBalanceData`).
- `DataList`/tableaux : mutualiser le tri, la pagination et l'état vide si la duplication devient excessive.
- Export/restauration du coffre + `storage.persist()`.
- Migrations de schéma centralisées.
- Analyse du bundle : lazy loading, `manualChunks` si nécessaire, budget de taille.
- Tests de non-régression sur les parcours critiques.

**Critère de sortie** : chunk initial ≤ 300 Ko gzip, aucun module > 400 lignes dans la couche IA, aucune duplication de `buildAssistantContext`, tests verts.

### Lot 6 — Recette, documentation et livraison (2 j)

- Matrice d'appareils et de largeurs.
- Recette PWA complète (installation, offline, update, cache).
- Lighthouse + axe.
- Mise à jour `README.md` et `AGENTS.md` : PWA, offline, IA, architecture.
- Ajout d'un `docs/pwa-test-plan.md`.
- Vérification finale `npm run lint && npm run test && npm run build`.

---

## 7. Ordre recommandé et jalons

```text
Jalon A — Fiabilité      : Lot 0
Jalon B — Installable    : Lot 1
Jalon C — Mobile natif   : Lots 2 + 3
Jalon D — IA gracieuse   : Lot 4
Jalon E — Dette remboursée : Lot 5
Jalon F — Livraison      : Lot 6
```

- **MVP démontrable** : Lots 0 + 1 + 2 + 4 (environ 9–12 jours).
- **Version mobile complète** : + Lot 3 (environ 15–19 jours).
- **Version consolidée** : + Lots 5 et 6 (environ 21–27 jours).

Les lots 1 et 2 peuvent partiellement se chevaucher, mais le Lot 0 doit précéder toute mise à jour PWA pour ne pas risquer de perdre une écriture au rechargement.

---

## 8. Critères d'acceptation globaux

### PWA

- [ ] `manifest.webmanifest` valide, `name`, `short_name`, `start_url`, `scope`, `display`, icônes 192/512/maskable.
- [ ] Service worker actif sur HTTPS et `localhost`.
- [ ] Application installable sur Android et iOS (instructions iOS).
- [ ] Lancement en `standalone`, sans barre d'adresse.
- [ ] Après premier chargement : reload hors ligne, déverrouillage, navigation, import, analyses, budgets, récurrences, couverture, saisie manuelle.
- [ ] Aucun contenu du coffre ni requête Gemini dans `Cache Storage`.
- [ ] Bannière de mise à jour, « Plus tard », « Recharger » ; les données restent intactes.
- [ ] `theme-color` correct en clair et sombre.

### Mobile

- [ ] 320, 375, 390, 430, 768 px : aucun scroll horizontal de page.
- [ ] Cibles tactiles principales ≥ 44 × 44 px.
- [ ] Aucun zoom automatique iOS au focus d'un champ.
- [ ] Clavier : le champ actif et le bouton de validation restent visibles.
- [ ] Safe areas respectées en standalone (encoche, barre gestuelle).
- [ ] Retour Android : ferme d'abord le détail/dialogue, puis navigue.
- [ ] Barre d'onglets + « Plus » : toutes les pages accessibles en ≤ 2 taps.
- [ ] Période accessible en ≤ 2 taps, lisible sans overflow.
- [ ] Dialogues en feuilles inférieures, scrollables, fermables au clavier.
- [ ] Graphiques lisibles, tooltips utilisables au doigt.
- [ ] Thème système respecté ; choix manuel persistant.

### IA hors ligne

- [ ] Réseau coupé : clic IA → popup immédiate, aucune requête réseau.
- [ ] Popup explique que le reste de l'application fonctionne hors ligne.
- [ ] « Réessayer » après reconnexion fonctionne.
- [ ] Le chat conserve le brouillon hors ligne et ne crée pas de message fantôme.
- [ ] Les batches partiels affichent un bilan honnête.
- [ ] Test de clé et onboarding gèrent l'absence de réseau.

### Données

- [ ] Deux mutations rapprochées ne peuvent pas s'écraser.
- [ ] Édition manuelle atomique, chaîne de soldes continue.
- [ ] Erreur de quota `localStorage` visible et actionnable.
- [ ] Coffre corrompu : écran de récupération, pas d'écrasement.
- [ ] Export/restauration du coffre chiffré.
- [ ] Tests unitaires des points ci-dessus.

### Qualité

- [ ] `npm run lint`, `npm run test`, `npm run build` passent.
- [ ] Chunk initial ≤ 300 Ko gzip (objectif).
- [ ] Lighthouse mobile : Performance et Accessibilité aussi hautes que possible ; pas de régression majeure.
- [ ] axe : aucune violation critique.
- [ ] `README.md` et `AGENTS.md` décrivent la PWA, l'offline et les nouvelles règles.

---

## 9. Risques et parades

| Risque | Probabilité | Parade |
| --- | --- | --- |
| `vite-plugin-pwa` incompatible avec Vite 8 / Rolldown | Faible | Peer dependency annonce Vite 8 ; sinon `injectManifest` + service worker manuel |
| Mauvais `base` sur GitHub Pages | Moyenne | Configurer `base` et tester le build sous le sous-chemin ; manifest en chemins relatifs |
| Service worker qui sert une vieille version | Moyenne | `registerType: 'prompt'`, `cleanupOutdatedCaches`, bannière explicite |
| Rechargement pendant une écriture | Moyenne | `flushVaultWrites()` avant `updateServiceWorker(true)` |
| Perte de données iOS (éviction) | Moyenne | Export/restauration + `storage.persist()` + documentation |
| Graphiques Recharts illisibles au doigt | Moyenne | Mode compact, tooltip au clic, fallback textuel |
| Refonte mobile trop large | Haute | Lots, listes page par page, desktop préservé, tests visuels |
| Popup IA trop intrusive | Moyenne | Uniquement à l'action, pas au chargement, un popup par action |
| Dette de store difficile à découper | Moyenne | Extraire d'abord la file d'écriture et les fonctions pures, sans changer l'API Zustand |
| Quota `localStorage` | Faible | Coffre ~1 Mo pour 1 728 lignes ; export, message d'erreur, surveillance dans Réglages |

---

## 10. Hors périmètre (pour cette itération)

- Notifications push : nécessitent un serveur, incompatible avec le 100 % local.
- Synchronisation multi-appareils.
- Assistant IA entièrement local (modèle embarqué).
- Application native Capacitor/Electron : la PWA suffit pour l'objectif.
- Refonte du desktop.
- Changement de KDF, de chiffrement ou de format de coffre.
- Synchronisation bancaire automatique.
- Mode multi-utilisateur.

---

## 11. Décisions prises en autonomie

1. **Barre d'onglets** : `Vue d'ensemble / Transactions / + / Budgets / Plus`. L'assistant reste dans « Plus » ; le bouton central ouvre la saisie d'une dépense vide.
2. **Déploiement** : `base` piloté par `VITE_BASE` (défaut `/`) ; un build sous
   `/budget-analyzer/` a été vérifié. Sur GitHub Pages, définir
   `VITE_BASE=/budget-analyzer/`.
3. **Export/restauration** : intégré dans les Réglages et dans l'écran de
   récupération du coffre.
4. **Verrouillage automatique** : non ajouté.
5. **Thème** : `system` par défaut, choix manuel dans Réglages.
6. **Mise à jour PWA** : toujours demander, jamais recharger automatiquement.
7. **Panneau de détail mobile** : Dialog modal plein écran avec entrée
   d'historique, plutôt qu'une simple colonne adaptée.
8. **Clé d'accès** : WebAuthn PRF pour sceller le mot de passe, avec le mot de
   passe conservé comme secours. Pas de mode sans mot de passe, afin de ne pas
   rendre le coffre irrécupérable sur un gestionnaire sans PRF.
9. **Saisie rapide** : feuille inférieure partagée par le « + » et la page
   Saisie manuelle ; la page ne contient plus que l'historique et un bouton
   « Nouvelle opération ».

---

## 12. Résumé en une phrase

On ajoute une couche PWA propre (manifest, service worker, installation, mise à jour), on transforme le shell et les tableaux en expérience mobile tactile, on rend l'IA explicitement dépendante du réseau avec une popup dédiée, et on sécurise les écritures du coffre avant de toucher au reste de l'architecture.
