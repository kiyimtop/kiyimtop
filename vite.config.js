import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Настройки Vite: подключаем поддержку React.
// base — с какого адреса открывается сайт: с корня («/»). Если понадобится подпапка — переменная BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
