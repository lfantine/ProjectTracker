
export default {
  webpack(config) {
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.thisCompilation.tap('AmberTrustedAssets', compilation => {
          compilation.hooks.processAssets.tapPromise({ name: 'AmberTrustedAssets', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, async () => {
            const { buildShellAssets } = await import('./scripts/build-shell-assets.mjs')
            for (const [name, bytes] of await buildShellAssets()) compilation.emitAsset(name, new compiler.webpack.sources.RawSource(bytes))
          })
        })
      },
    })
    return config
  },
}
