import { execFile } from 'child_process'

export function aiToolErrorMessage(command: string, detail: string): string {
  if (detail.includes('missing field `choices`')) {
    return `Le programme IA (${command}) n’a pas renvoyé de réponse exploitable. Le motif exact n’est pas fourni par cet outil (une limite de taille ou de quota est possible). Réessaie plus tard ; si le problème persiste, vérifie le programme configuré dans les réglages.`
  }
  return `L’appel au programme IA (${command}) a échoué : ${detail}`
}

export function callAiTool(command: string, request: string, format?: string): Promise<string> {
  const args = ['--request', request]
  if (format) args.push('--format', format)

  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(aiToolErrorMessage(command, stderr.trim() || error.message)))
        return
      }
      if (!stdout.trim()) {
        reject(new Error(`Le programme IA (${command}) a renvoyé une réponse vide. Réessaie la génération.`))
        return
      }
      resolve(stdout)
    })
  })
}
