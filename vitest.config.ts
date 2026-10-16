import { defineConfig } from 'vitest/config'

// Two isolated environments:
// - dom: interface and pure logic, in jsdom;
// - services: main-process services (SQLite, installer...), in a Node
//   environment. scripts/test-runner.mjs runs this project with Electron in
//   Node mode so the embedded runtime (node:sqlite) is the one under test.
export default defineConfig({
  test: {
    reporters: ['verbose'],
    projects: [
      {
        test: {
          name: 'dom',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['tests/services/**', 'tests/electron/**', '**/node_modules/**'],
          environment: 'jsdom',
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        test: {
          name: 'services',
          include: ['tests/services/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/services/setup.ts'],
          pool: 'forks',
        },
      },
    ],
  },
})
