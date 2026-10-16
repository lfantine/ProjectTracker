import { dialog, type BrowserWindow } from 'electron'
import type { Manifest } from '../../shared/manifest'
import { addedPermissions, describePermissions, normalizePermissions, type PermissionSet } from '../../shared/permissions'

export interface ImportProposal {
  manifest: Manifest
  contentSha256: string
  sourceSha256: string
  previousPermissions?: PermissionSet
}
export type ConfirmImport = (proposal: ImportProposal, signal?: AbortSignal) => Promise<boolean>

export function importConfirmationText(proposal: ImportProposal): string {
  const permissions = normalizePermissions(proposal.manifest.permissions)
  const added = addedPermissions(proposal.previousPermissions ?? normalizePermissions(undefined), permissions)
  // No HTML, package-controlled labels cannot replace the native warning/rights.
  return [
    `Identité : ${proposal.manifest.id} — ${proposal.manifest.version}`,
    `Auteur déclaré : ${JSON.stringify(proposal.manifest.author)}`,
    'Éditeur non vérifié. Le nom et les empreintes ne prouvent pas son identité.',
    'Cette opération conserve les fichiers sans activer le package.',
    '', 'Droits demandés :', ...(describePermissions(permissions).length ? describePermissions(permissions) : ['Aucun droit externe.']),
    '', 'Droits supplémentaires :', ...(describePermissions(added).length ? describePermissions(added) : ['Aucun.']),
    '', `Contenu SHA-256 : ${proposal.contentSha256}`, `Archive SHA-256 : ${proposal.sourceSha256}`,
  ].join('\n')
}

export function nativeImportConfirmation(window: BrowserWindow): ConfirmImport {
  return async (proposal, signal) => {
    if (signal?.aborted || window.isDestroyed()) return false
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', title: 'Importer un package — amber',
      message: 'Faire confiance à ce contenu et le conserver localement ?',
      detail: importConfirmationText(proposal), buttons: ['Annuler', 'Importer sans activer'],
      defaultId: 0, cancelId: 0, noLink: true, signal,
    })
    return !signal?.aborted && !window.isDestroyed() && answer.response === 1
  }
}

export function nativeStopConfirmation(window: BrowserWindow): import('./lifecycle').ConfirmStop {
  return async (proposal, signal) => {
    if (signal?.aborted || window.isDestroyed()) return false
    const uninstall = proposal.action === 'uninstall'
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', title: uninstall ? 'Désinstaller un package' : 'Désactiver un package',
      message: `${uninstall ? 'Désinstaller' : 'Désactiver'} ${proposal.packageId} ?`,
      detail: [
        'Les contextes concernés seront fermés. Les données, configurations et emplacements seront conservés.',
        'Les fichiers de version restent disponibles localement ; cette action ne les active pas.',
        ...(proposal.suspendedDependants.length ? ['Packages dépendants qui seront suspendus :', ...proposal.suspendedDependants] : ['Aucun dépendant actif.']),
      ].join('\n'),
      buttons: ['Annuler', uninstall ? 'Désinstaller' : 'Désactiver'], defaultId: 0, cancelId: 0, noLink: true, signal,
    })
    return !signal?.aborted && !window.isDestroyed() && answer.response === 1
  }
}

export function nativeActivationConfirmation(window: BrowserWindow): import('./activation').ActivationHooks['confirm'] {
  return async (proposal, signal) => {
    if (signal?.aborted || window.isDestroyed()) return false
    const extra = describePermissions(addedPermissions(proposal.previousPermissions, proposal.permissions))
    const rights = describePermissions(proposal.permissions)
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', title: 'Activer un package — amber', message: `Activer ${proposal.packageId} — ${proposal.version} ?`,
      detail: ['Éditeur non vérifié. Le code pourra utiliser tous les droits ci-dessous après validation.',
        'Une mise à jour ne remplace la version active qu’après validation et migration réussies.',
        'Activer un thème désactive le thème précédent de la même cible, sans supprimer ses données.',
        'Droits demandés :', ...(rights.length ? rights : ['Aucun droit externe.']),
        'Droits supplémentaires :', ...(extra.length ? extra : ['Aucun.']), `Contenu SHA-256 : ${proposal.contentSha256}`].join('\n'),
      buttons: ['Annuler', 'Valider et activer'], defaultId: 0, cancelId: 0, noLink: true, signal,
    })
    return !signal?.aborted && !window.isDestroyed() && answer.response === 1
  }
}
