import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/attendance-appnpm install --save-dev gh-pages/',   // 👈 VIKTIG: bytt til navnet på GitHub repoet
})