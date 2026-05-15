import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      // Plan-PP docker:后端 API 已迁移到 `/api/*` 前缀,dev proxy 不再 rewrite,
      // 与生产单容器路径(`http://localhost:3000/api/*`)保持一致。
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
