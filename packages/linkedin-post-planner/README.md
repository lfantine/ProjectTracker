# LinkedIn Post Planner — package 1.0.0

Package externe `lfantine.linkedin-post-planner`, **non livré** avec amber :
il s'importe comme ZIP depuis le Marketplace. Une seule contribution, le majeur
`planner` (« Posts LinkedIn »). Ses instances sont des **profils** (compte perso,
page entreprise…), chacun avec ses posts, images et réglages.

## Construire et importer

```bash
node scripts/build-linkedin-planner-package.mjs
```

Produit `dist/packages/lfantine.linkedin-post-planner-1.0.0.zip` (reproductible).
Dans amber : **Marketplace → Importer un ZIP** (import puis activation, deux
accords natifs), puis **Ouvrir** ou **Ajouter au menu** depuis la fiche. Au premier
lancement, la page propose de créer un profil.

## Fonctionnalités

- **Idées** : saisie rapide (Entrée), type, `#tags` dans le texte transformés en
  tags. « Planifier » propose le prochain jour sans post, à l'heure par défaut.
- **Planning** : semaines à partir de la semaine courante (au moins 4, une semaine
  vide affiche « Rien de prévu »). Un post planifié dont l'heure est passée est
  « À confirmer » : *Oui, publié*, *Abandonner* ou *Replanifier*.
- **Historique** : posts publiés, abandonnés ou non publiés, par mois, avec le
  nombre de replanifications et le lien vers le post publié.
- Post : sujet, contenu (compteur 3 000, aperçu de l'accroche avant « voir plus »),
  type (Découverte / Expertise / Vente / Autre), statut, date, heure, tags, image
  (choisir, glisser-déposer ou coller), texte alternatif, lien publié, notes.
- Filtres texte / type / tag, nuage de tags cliquable, répartition des types sur
  les 30 prochains jours et des posts publiés sur les 30 derniers.
- **Ouvrir mon LinkedIn** (lien du profil dans les réglages) et **Écrire sur
  LinkedIn** (éditeur de post) via la navigation externe native, confirmée par amber.
- Clavier : Entrée/Espace modifie la carte, Suppr ouvre une confirmation,
  ⌘/Ctrl Entrée enregistre, flèches entre les onglets, Échap ferme.

## Stockage et droits

Stockage **v1**, portée instance. Collections `posts` (un document par post,
UUID), `images` (un document par image, immuable), `settings/profile`.
Écritures CAS par document ; un conflit garde la saisie et ne force rien. Les
documents illisibles sont signalés et conservés. Un post dupliqué partage l'image
de l'original ; elle n'est supprimée qu'avec le dernier post qui l'utilise.

Les images sont ré-encodées localement en JPEG (≤ ~750 000 caractères base64,
2000 px max) avec une miniature dans le post. Avec la limite de 50 Mio par
package, compter environ 100 à 150 images au total.

Aucune permission demandée : ni CORE, ni réseau, ni export. Pas de Node, IPC,
`fetch` ni stockage navigateur. Les liens externes passent par
`sdk.navigation.open` ; le lien de profil doit être en `https://*.linkedin.com`.

## Limites connues

- Pas de publication automatique : il n'y a pas d'accès réseau ni d'API LinkedIn.
- Le presse-papiers est refusé aux frames : « Sélectionner le texte » sélectionne
  le contenu, ⌘/Ctrl C le copie. Les téléchargements sont bloqués : l'image doit
  être ré-uploadée depuis le fichier d'origine (son nom est conservé).

## Validation

```bash
npm run typecheck
node node_modules/vitest/vitest.mjs run --project dom tests/linkedin-planner-model.test.ts tests/linkedin-planner-view.test.ts
npm run test:services -- tests/services/linkedin-planner-package.test.ts
```
