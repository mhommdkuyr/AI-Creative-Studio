import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ai-creative-studio/core': path.resolve(__dirname, '../../packages/core/src'),
      '@ai-creative-studio/creative-engine': path.resolve(__dirname, '../../packages/creative-engine/src'),
      '@ai-creative-studio/timeline-engine': path.resolve(__dirname, '../../packages/timeline-engine/src'),
      '@ai-creative-studio/rendering-engine': path.resolve(__dirname, '../../packages/rendering-engine/src'),
      '@ai-creative-studio/animation-engine': path.resolve(__dirname, '../../packages/animation-engine/src'),
      '@ai-creative-studio/asset-engine': path.resolve(__dirname, '../../packages/asset-engine/src'),
      '@ai-creative-studio/project-engine': path.resolve(__dirname, '../../packages/project-engine/src'),
      '@ai-creative-studio/command-engine': path.resolve(__dirname, '../../packages/command-engine/src'),
      '@ai-creative-studio/ai-engine': path.resolve(__dirname, '../../packages/ai-engine/src'),
      '@ai-creative-studio/state-engine': path.resolve(__dirname, '../../packages/state-engine/src'),
      '@ai-creative-studio/plugin-engine': path.resolve(__dirname, '../../packages/plugin-engine/src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    proxy: { '/api': 'http://localhost:8787', '/media': 'http://localhost:8787' },
  },
});
