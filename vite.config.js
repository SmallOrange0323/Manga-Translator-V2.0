import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    // 確保輸出的 JS 檔案不會太分散，利於 Chrome 載入
    rollupOptions: {
      input: {
        reader: 'src/reader/result.html'
      },
      output: {
        manualChunks: undefined,
      },
    },
  },
});
