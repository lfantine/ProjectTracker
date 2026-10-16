import { NextConfig } from 'next'

const isProd = process.env.NODE_ENV === 'production'

const config: NextConfig = {
  output: 'export',
  // Production builds must not type-check the validators left behind by a
  // previous `next dev` session (.next/dev/types), which duplicate the build ones.
  typescript: {
    tsconfigPath: isProd ? 'tsconfig.build.json' : 'tsconfig.json',
  },
  distDir: isProd ? '../app' : '.next',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
}

export default config
