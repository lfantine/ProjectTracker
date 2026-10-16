# Futur outillage npm de création de packages amber

> **Statut : proposition à implémenter plus tard.** Ce document ne décrit pas un
> outil déjà disponible et ne lance pas son développement. Les noms npm,
> commandes et API ci-dessous sont illustratifs : leur disponibilité et leur
> forme définitive restent à vérifier/décider.

## 1. Objectif

Permettre à un développeur de créer un package amber sans écrire manuellement
les fichiers HTML d'entrée, le branchement du SDK et la chaîne de génération ZIP.

L'expérience souhaitée : écrire des composants, déclarer leurs contributions,
puis lancer une commande produisant une archive directement importable.

**Décision d'architecture envisagée :** une API de rendu agréable dans le code
source, mais toujours du HTML, JavaScript, CSS et un manifeste dans le ZIP final.
Ce ne sont pas deux formats concurrents : l'outillage transforme le premier en
second.

## 2. Principes à préserver

- Le format ZIP/manifeste reste public et indépendant de cet outil.
- L'outil reste facultatif : React, Vue, Svelte ou JavaScript classique peuvent
  produire une archive conforme sans lui.
- Amber ne lance ni compilation, ni `npm install`, ni script d'installation à
  l'import. Le code est déjà compilé et les dépendances embarquées.
- L'API de rendu s'exécute **dans la frame isolée de la contribution**, jamais
  dans le renderer principal ou le processus natif d'amber.
- Le SDK reste l'unique accès aux données et capacités autorisées. Un composant
  ne reçoit ni accès SQLite/Node, ni accès au pont natif `window.api`.
- L'outillage ne contourne aucune validation, permission ou confirmation native.
  Son nom ou son origine npm ne constituent pas une preuve d'éditeur vérifié.
- Ne pas réinventer le contrat : réutiliser les schémas, types et limites existants.

Références du dépôt : [format des archives](FORMAT.md),
[installateur](INSTALLER.md), [plan de refonte](../../PLANS/PLAN.md) (local),
`shared/manifest.ts`, `shared/schema/manifest.schema.json`, `shared/limits.ts`
et `sdk/`.

## 3. Répartition envisagée

Les noms suivants représentent des responsabilités, pas des noms npm réservés.

| Élément | Responsabilité |
| --- | --- |
| `@amber/sdk` | Contrat de communication, types et API indépendants du framework. Partir du SDK existant, ne pas créer un protocole parallèle. |
| `@amber/react` | Adaptateur de montage React, provider de contexte et hooks éventuels autour du même SDK. |
| CLI / générateur | Création de projet, compilation, validation et production du ZIP. |

Le CLI et le générateur peuvent commencer dans un seul package npm ; ne pas
multiplier les packages avant qu'une séparation soit utile. L'adaptateur React
ne doit pas devenir une dépendance obligatoire du SDK générique.

## 4. Expérience développeur souhaitée

Commandes illustratives :

```bash
npm create amber-package
npm run dev
npm run check
npm run package
```

Le générateur propose d'abord :

- un module majeur ;
- un module mineur indépendant ;
- un widget indépendant ;
- un package combinant un majeur et ses contributions associées.

Pour un mineur/widget associé à un majeur, produire les références et relations
réciproques attendues par le manifeste. Ne pas inventer un majeur obligatoire
pour les contributions indépendantes.

Les templates d'extensions peuvent venir ensuite : ne pas promettre un moteur
de thèmes/features tant que le runtime amber correspondant n'est pas disponible.

### Exemple React proposé

```tsx
// API illustrative, pas un import utilisable aujourd'hui.
import { createRoot } from '@amber/react'
import { useState } from 'react'

function Planner() {
  const [count, setCount] = useState(0)

  return (
    <button onClick={() => setCount(value => value + 1)}>
      {count}
    </button>
  )
}

createRoot().render(<Planner />)
```

`createRoot()` pourrait retrouver un conteneur généré automatiquement dans
l'HTML. Son nom et sa signature restent à décider ; une API du type
`amber.module.render(...)` est également possible. Ne pas confondre cet adaptateur
avec une nouvelle capacité du protocole SDK.

Le rendu doit respecter l'initialisation du SDK : attendre sa négociation avant
les appels métier, afficher un état d'attente/échec et arrêter les abonnements
et opérations lors du démontage ou de la révocation. Ne pas masquer les refus de
permissions ou présenter une écriture échouée comme enregistrée.

## 5. Sources et résultat compilé

Exemple d'organisation source possible :

```text
mon-package/
├── package.json
├── amber.config.ts           # Configuration de build proposée
└── src/
    ├── planner.tsx
    ├── project-slots.tsx
    ├── today.tsx
    └── styles.css
```

La configuration associerait les métadonnées et contributions à leurs sources.
Le manifeste final serait généré et validé. **Choisir une source de vérité** :
ne pas maintenir deux manifestes concurrents avec des champs divergents.

Archive produite, à titre d'exemple :

```text
mon-package.zip
├── manifest.json
├── planner.html
├── project-slots.html
├── today.html
└── assets/
    ├── planner.js
    ├── project-slots.js
    ├── today.js
    └── styles.css
```

Les entrées pourraient partager des chunks locaux. Tous les chemins doivent
rester relatifs et fonctionner sous le protocole de ressources amber, pas
seulement sous un serveur HTTP de développement. Une migration facultative doit
également être compilée en ressources locales conformes au contrat existant.

Le SDK hôte est fourni par le bootstrap contrôlé d'amber : ne pas embarquer un
second bootstrap privilégié, exposer `ipcRenderer` ou reconstruire la négociation
dans le CLI. Réutiliser le mécanisme de connexion déjà prévu dans le dépôt.

## 6. Fonctions du CLI

### MVP

1. Générer un squelette minimal, documenté et typé.
2. Compiler les entrées et styles en fichiers statiques.
3. Embarquer les dépendances/assets nécessaires, sans CDN ni code distant.
4. Générer l'HTML d'entrée et le manifeste conforme.
5. Vérifier chemins, fichiers référencés, associations, permissions et limites.
6. Créer le ZIP avec `manifest.json` à sa racine, sans dossier enveloppe.
7. Afficher un résumé : identité/version, contributions, permissions, taille,
   destination et avertissements. Un build invalide échoue avec un code non nul.

Ne pas embarquer `.env`, clés/secrets, `node_modules`, sources privées ou fichiers
sans rapport avec le résultat compilé. Définir explicitement le traitement des
source maps ; ne pas les inclure accidentellement avec des chemins locaux.

### Développement et prévisualisation

- Une prévisualisation peut simuler le SDK avec des fixtures et des données jetables.
- Elle doit être clairement identifiée comme une simulation, sans données personnelles.
- Elle ne prouve pas le confinement Electron, la conformité CSP ou l'activation.
- Garder une validation du **ZIP réellement généré** dans le runtime amber isolé.
- Ne pas ajouter un serveur de développement privilégié accessible aux packages
  pour contourner les règles du runtime de production.

La technologie de build et le fonctionnement précis du mode dev restent à
choisir après extraction du cas Semaine type ; ne pas figer un bundler ici.

## 7. Ordre d'implémentation recommandé

- [ ] Terminer le premier vrai package Semaine type sur le SDK dans le dépôt amber.
- [ ] Identifier les étapes communes de sa chaîne de build, sans déplacer les responsabilités de sécurité natives.
- [ ] Stabiliser/exporter les types et le SDK existants pour les auteurs.
- [ ] Extraire un premier outil `build/check/package`, même sans générateur interactif.
- [ ] Ajouter un template minimal et sa documentation de prise en main.
- [ ] Ajouter l'adaptateur React et son API de montage ; conserver le SDK indépendant.
- [ ] Ajouter les variantes majeur/mineur/widget/combiné et leurs fixtures.
- [ ] Ajouter la prévisualisation et les outils de diagnostic après validation du flux ZIP.
- [ ] Vérifier les noms npm, définir versions/compatibilité/licence puis préparer une publication distincte.

Ce travail est une suite possible du portage, **pas un prérequis qui bloque le
lot 5** ni une autorisation de publier sur npm pendant la refonte actuelle.

## 8. Critères d'acceptation

- Un projet généré produit un ZIP accepté par le vrai installateur amber.
- Ce ZIP s'installe sans modification/rebuild de l'hôte et sans compilation à l'import.
- Les contributions chargent depuis leurs ressources gérées, sans CDN ni dev server.
- Majeur, mineur et widget associés utilisent la même instance et ses données via le SDK.
- Une dépendance embarquée ne donne pas accès à Node ou aux capacités natives.
- Des permissions manquantes, un manifeste invalide ou un ZIP hors limites sont refusés,
  même si la commande de build a été exécutée avec succès.
- Suppression du ZIP d'origine sans impact, réimport identique sans conflit et
  conflit explicite si le contenu change sous la même identité/version.
- Test d'activation, mise à jour réussie/échouée et révocation dans un profil temporaire.
- Un auteur peut toujours produire le même format avec une autre chaîne de build.

## 9. Décisions à prendre au démarrage de ce chantier

- Noms publics et organisation exacte des packages npm.
- API de montage : `createRoot().render(...)`, `amber.module.render(...)` ou autre.
- Format de configuration et stratégie de génération du manifeste.
- Bundler, versions de frameworks supportées et traitement des dépendances React.
- Politique de compatibilité entre CLI, SDK, manifeste et versions d'amber.
- Politique de reproductibilité des builds, source maps et diagnostics.
- Niveau de simulation du mode dev et lancement éventuel d'un harnais Electron isolé.

Ne pas interpréter les exemples de ce document comme des décisions déjà figées.
