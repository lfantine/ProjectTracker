import React from 'react'
import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SideBar } from '../renderer/components/SideBar'
const { preferences } = vi.hoisted(() => ({ preferences: { sidebarCollapsed: false } }))
vi.mock('next/router', () => ({ useRouter: () => ({ pathname: '/home', asPath: '/home' }) }))
vi.mock('../renderer/lib/composition', () => ({ useComposition: () => ({ snapshot: null }) }))
vi.mock('../renderer/lib/store', () => ({ useData: () => ({ preferences, updatePreferences: vi.fn() }) }))
vi.mock('../renderer/lib/theme', () => ({ useTheme: () => ({ themeMode: 'light', themeLabel: 'Clair', cycleTheme: vi.fn() }) }))
it('shows the supplied amber artwork alongside its wordmark', () => {
  preferences.sidebarCollapsed = false
  const { container } = render(<SideBar />)
  expect(screen.getByText('amber')).toBeInTheDocument()
  expect(container.querySelector('img')).toHaveAttribute('src', '/images/logo.png')
  expect(container.querySelector('img')).toHaveAttribute('alt', '')
})
it('keeps an accessible brand when the sidebar is collapsed', () => {
  preferences.sidebarCollapsed = true
  render(<SideBar />)
  expect(screen.getByRole('img', { name: 'amber' })).toHaveAttribute('src', '/images/logo.png')
  expect(screen.queryByText('amber')).toBeNull()
  preferences.sidebarCollapsed = false
})
