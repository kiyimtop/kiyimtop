import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Настройки Vite: подключаем поддержку React.
// base — с какого адреса открывается сайт. Обычно с корня («/»); на GitHub Pages — «/kiyimtop/»
// (его передаёт сборка на GitHub: .github/workflows/pages.yml, переменная BASE_PATH).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
