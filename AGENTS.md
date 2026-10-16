# Consignes du projet

## Refonte modulaire et continuité entre sessions

- Avant toute tâche liée à la refonte modulaire, lire `PLANS/PLAN.md` (notes locales, ignorées par Git). Il rassemble les décisions, l'état actuel, les contraintes, les validations attendues et la checklist de reprise.
- Ce document décrit une cible à implémenter, pas les fonctionnalités déjà disponibles. Vérifier le code et les cases de suivi avant de reprendre une étape.
- Pour créer ou modifier un module/package, lire aussi `docs/packages/CREER-UN-MODULE.md` : guide du format et du SDK actuels, exemple complet et checklist. Ne pas confondre avec `docs/packages/AUTHORING-TOOLKIT.md`, proposition d’outillage npm futur.
- La présence du plan n'autorise pas à exécuter toute la refonte : suivre la demande de l'utilisateur.
- Après une étape réalisée, actualiser le suivi et noter les validations réellement exécutées. Conserver les décisions ouvertes comme telles, notamment le nom du produit.

## Préservation du travail existant

- Examiner l'état Git avant de modifier des fichiers et préserver les modifications locales préexistantes, y compris les fichiers non suivis.
- Ne pas réinitialiser ou écraser du travail sans rapport avec la demande.
- Les essais de stockage et de migration doivent utiliser un répertoire de données temporaire, jamais les données personnelles de l'utilisateur.

Les consignes des sous-dossiers restent applicables, notamment `renderer/AGENTS.md` et ses exigences de lecture des guides Next.js locaux avant d'écrire du code renderer.
