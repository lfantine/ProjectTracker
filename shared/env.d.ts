// Universal web APIs available in every environment that loads the shared
// contracts (renderer, Electron main, plugin frames). Declared minimally here
// so that shared code cannot accidentally depend on DOM- or Node-only APIs.
declare class URL {
  constructor(url: string, base?: string)
  readonly hash: string
  readonly host: string
  readonly hostname: string
  readonly href: string
  readonly origin: string
  readonly password: string
  readonly pathname: string
  readonly port: string
  readonly protocol: string
  readonly search: string
  readonly username: string
  toString(): string
}
declare class URLSearchParams {
  constructor(init?: Record<string, string> | string)
  get(name: string): string | null
  set(name: string, value: string): void
  toString(): string
}
