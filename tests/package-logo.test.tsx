import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { PackageLogo } from '../renderer/components/PackageLogo'
afterEach(cleanup)
it('renders native PNG artwork without changing accessible button names, falling back after decode failure', () => {
  const { container, rerender } = render(<PackageLogo name="Semaine type" logoDataUrl="data:image/png;base64,aGVsbG8=" />)
  const image = container.querySelector('img')!
  expect(image).toHaveAttribute('alt', '')
  expect(image).toHaveAttribute('draggable', 'false')
  fireEvent.error(image)
  expect(container.querySelector('img')).toBeNull()
  expect(container).toHaveTextContent('S')
  rerender(<PackageLogo name="Semaine type" logoDataUrl="data:image/png;base64,bmV3" />)
  expect(container.querySelector('img')).not.toBeNull()
})
it.each([undefined, 'https://example.org/logo.png', 'file:///tmp/logo.png', 'assets/logo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,' + 'A'.repeat(350000)])('never loads an unsafe or unbounded source (%#)', logoDataUrl => {
  const { container } = render(<PackageLogo name="Semaine type" logoDataUrl={logoDataUrl} />)
  expect(container.querySelector('img')).toBeNull()
  expect(container).toHaveTextContent('S')
})
