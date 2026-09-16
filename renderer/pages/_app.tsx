import type { AppProps } from 'next/app'
import { Instrument_Sans, Space_Mono } from 'next/font/google'

import '../styles/globals.css'
import { ThemeProvider } from '../lib/theme'
import { DataProvider } from '../lib/store'
import { ToastProvider } from '../components/Toast'
import { SideBar } from '../components/SideBar'

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument-sans',
  display: 'swap',
})

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
  display: 'swap',
})

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <div className={`${instrumentSans.variable} ${spaceMono.variable} contents`}>
      <ThemeProvider>
        <DataProvider>
          <ToastProvider>
            <div className="flex h-screen w-full overflow-hidden bg-bg text-text">
              <SideBar />
              <Component {...pageProps} />
            </div>
          </ToastProvider>
        </DataProvider>
      </ThemeProvider>
    </div>
  )
}

export default MyApp
