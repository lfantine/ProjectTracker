import { execFile } from 'child_process'

export function groqErrorMessage(detail: string): string {
  if (detail.includes('missing field `choices`')) {
    return 'Groq n’a pas renvoyé de réponse exploitable et groqtool a échoué. Le motif exact n’est pas fourni par cet outil (une limite de taille ou de quota est possible). Réessaie plus tard ; si le problème persiste, vérifie groqtool et les limites du compte Groq.'
  }
  return `L’appel à Groq a échoué : ${detail}`
}

export function callGroq(request: string, format?: string): Promise<string> {
  const args = ['--request', request]
  if (format) args.push('--format', format)

  return new Promise((resolve, reject) => {
    execFile('groqtool', args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(groqErrorMessage(stderr.trim() || error.message)))
        return
      }
      if (!stdout.trim()) {
        reject(new Error('Groq a renvoyé une réponse vide. Réessaie la génération.'))
        return
      }
      resolve(stdout)
    })
  })
}
