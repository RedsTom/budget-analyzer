# Recette PWA et mobile

À exécuter après `npm run lint && npm run test && npm run build`, puis
`npm run preview` (le service worker n'est pas activé dans `npm run dev`).

## 1. Installabilité

- [ ] `manifest.webmanifest` accessible et sans erreur dans Chrome DevTools → Application → Manifest.
- [ ] Icônes 192, 512 et maskable présentes ; l’icône maskable reste lisible dans un cercle.
- [ ] `start_url`, `scope` et `id` correspondent au chemin de déploiement.
- [ ] Le service worker passe à `activated` et contrôle la page.
- [ ] Le bouton « Installer l’application » apparaît sur Android/Chrome, ou les instructions iOS s’affichent dans Réglages.
- [ ] Après installation, le lancement est en `standalone` (pas de barre d’adresse).

## 2. Hors ligne

- [ ] Charger l’application une première fois en ligne.
- [ ] Couper le réseau ou arrêter `vite preview`, puis recharger : l’application se lance.
- [ ] Déverrouiller le coffre hors ligne.
- [ ] Naviguer sur les 10 pages ; les graphiques et tableaux s’affichent.
- [ ] Ajouter une opération manuelle hors ligne, recharger, la retrouver.
- [ ] Vérifier que `Cache Storage` ne contient ni `generativelanguage`, ni `vault`, ni libellé bancaire.

## 3. IA hors ligne

- [ ] Activer l’IA avec une clé factice, puis passer le réseau hors ligne.
- [ ] Un clic sur une synthèse IA ou une question du chat ouvre la popup « L’IA nécessite une connexion ».
- [ ] Aucune requête réseau n’est émise (onglet Network vide).
- [ ] « Continuer hors ligne » ferme la popup ; l’application reste utilisable.
- [ ] Le brouillon du chat est conservé.
- [ ] Après reconnexion, « Réessayer » relance l’action.

## 4. Mobile

Largeurs à tester : 320, 375, 390, 430, 768, 1024 px.

- [ ] Aucun scroll horizontal de page.
- [ ] Barre d'onglets : Accueil, Transactions, + (action centrale), Budgets, Plus.
- [ ] Le bouton « + » ouvre une feuille de saisie rapide par le bas, sans changer de page.
- [ ] Le formulaire rapide contient uniquement type, montant, libellé, catégorie (pleine largeur), date et note optionnelle.
- [ ] « Plus » contient Assistant, Analyses, Récurrences, Marchands, Couverture, Saisie, Réglages.
- [ ] « Plus » ferme la feuille après sélection d’une page.
- [ ] La page Saisie manuelle affiche l’historique et un bouton « Nouvelle opération » ; cliquer une ligne ouvre l’édition dans la même feuille.

## 4 ter. Couverture manuelle et traitement des paiements

- [ ] L’onglet Paiements liste tous les paiements de la période sélectionnée, y compris les virements, avec les états Sans affectation / Partiel / Traité.
- [ ] La file est triée du plus récent au plus ancien par défaut.
- [ ] Changer de période met à jour la file, les compteurs et la liste des revenus ; les soldes et le runway restent globaux.
- [ ] Le bouton Commencer ou Continuer ouvre le premier paiement non traité.
- [ ] Le dialogue affiche les revenus triés par proximité temporelle (avant comme après), avec leur disponible réel.
- [ ] Un paiement peut être fractionné sur plusieurs revenus ; les parts apparaissent et peuvent être retirées.
- [ ] « Afficher toutes les entrées » montre les revenus complets, au-delà des plus proches.
- [ ] Une affectation complète enchaîne automatiquement sur le paiement suivant.
- [ ] « Enregistrer et suivant » enregistre puis ouvre le paiement non traité suivant.
- [ ] Le budget de la catégorie est visible pour le mois précédent, le mois du paiement et le mois suivant.
- [ ] Un revenu postérieur au paiement est proposé et peut financer un découvert.
- [ ] Un paiement sans revenu disponible reste « À traiter » ou « Partiel », sans couverture automatique.
- [ ] Avec un découvert avant un nouveau crédit, « Fonds actifs disponibles » ne dépasse pas le solde bancaire réel.
- [ ] Le ou les crédits actifs les plus anciens affichent la part absorbée par le découvert et un reste net cohérent.

## 4 bis. Clé d’accès

- [ ] Le setup propose « Déverrouiller avec une clé d’accès » à l’étape du mot de passe.
- [ ] Sur un navigateur/gestionnaire compatible PRF, la création du coffre enregistre la clé ; sur un gestionnaire sans PRF, l’erreur est explicite et le coffre n’est pas créé.
- [ ] Réglages → Clé d’accès permet d’ajouter une clé après vérification du mot de passe et de la retirer.
- [ ] Après verrouillage, le bouton « Déverrouiller avec une clé d’accès » ouvre le coffre.
- [ ] Une annulation ou une clé non-PRF laisse le formulaire mot de passe utilisable.
- [ ] Modifier le mot de passe retire la clé d’accès et le signale.
- [ ] L’export du coffre ne contient pas `budget.passkey.v1`.
- [ ] Période accessible en ≤ 2 taps, sans overflow.
- [ ] Les tableaux deviennent des listes sous `md`.
- [ ] Le panneau de détail est plein écran, avec piège de focus et fermeture par le retour.
- [ ] Les dialogues sont des feuilles inférieures, scrollables, avec boutons visibles au-dessus du clavier.
- [ ] Aucun zoom iOS au focus d’un champ.
- [ ] Safe areas respectées en mode standalone.
- [ ] Toasts visibles au-dessus de la barre d’onglets.

## 5. Mise à jour

- [ ] Charger la version A, puis rebuild avec un changement visible.
- [ ] Recharger : la bannière « Nouvelle version disponible » apparaît.
- [ ] « Plus tard » ne recharge pas.
- [ ] « Recharger » attend la fin des écritures du coffre et conserve les données.
- [ ] Le verrouillage et le déverrouillage fonctionnent après mise à jour.

## 6. Données

- [ ] Deux actions rapides (accepter une récurrence + modifier un budget) ne s’écrasent pas.
- [ ] Modifier une opération manuelle en changeant sa date conserve une chaîne de soldes continue.
- [ ] Exporter le coffre chiffré puis restaurer la sauvegarde.
- [ ] Un coffre corrompu affiche l’écran de récupération, pas l’écran de création.
- [ ] Un coffre vide laisse accéder à Réglages et Saisie manuelle.

## 7. Qualité

- [ ] `npm run lint && npm run test && npm run build`.
- [ ] Lighthouse mobile : Performance, Accessibilité, Best Practices.
- [ ] axe DevTools : aucune violation critique.
- [ ] Console sans erreur au chargement, à la navigation et à l’ouverture du détail.
