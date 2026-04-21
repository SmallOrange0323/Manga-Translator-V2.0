# Manga Translator V2.0

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Manifest](https://img.shields.io/badge/Manifest-V3-green.svg)
![Build](https://img.shields.io/badge/Build-Vite-blueviolet.svg)

Manga Translator V2.0 是一個基於 Chrome Extension Manifest V3 的現代化重構專案。本專案旨在提供更穩定、更流暢的漫畫與小說翻譯體驗，並解決 Service Worker 隨機失效、CSS 污染以及行動端適配等實務痛點。

## 🌟 核心特色

- **防禦性建置系統**：採用 Vite 與 CRXJS，確保 background scripts 與資源路徑在 MV3 環境下穩定運作。
- **Storage-First 狀態機**：以 `chrome.storage.local` 為唯一真理來源，即使 Background 重啟，翻譯進度與 UI 狀態也能瞬間恢復。
- **Shadow DOM 懸浮介面**：透過 Shadow DOM 注入翻譯 UI，完全隔離宿主網頁 CSS，支援桌機與行動端瀏覽器。
- **混合式翻譯引擎**：
  - **漫畫模式**：支援局部預覽與批次圖框畫布。
  - **小說模式**：支援即時串流（Streaming）與預加載（Prefetch）技術，實現零延遲閱讀。

## 🏗️ 技術架構

- **建置工具**：Vite + `@crxjs/vite-plugin`
- **狀態管理**：基於 `chrome.storage.onChanged` 的響應式同步機制。
- **UI 策略**：Shadow DOM 注入模式，取代傳統 Popup，提供更好的互動穩定性。
- **資料流**：解耦複雜 JSON 解析，小說模式採用 Text Streaming。

## 🚀 開發說明

### 環境要求
- Node.js (推薦最新 LTS 版本)
- npm 或 pnpm

### 安裝依賴
```bash
npm install
```

### 開發模式
```bash
npm run dev
```
執行後，將 `dist` 資料夾載入 Chrome 擴充功能頁面（開發者模式）。

### 打包編譯
```bash
npm run build
```

## 📁 專案結構
- `src/background/`: 背景服務邏輯（Manifest V3 Service Worker）。
- `src/content/`: 網頁注入腳本與 Shadow DOM UI。
- `src/utils/`: 共用工具函式與狀態管理封裝。
- `dist/`: 打包後的產出目錄。

---
*本專案為 Manga Translator Extension 的現代化重構版本。*
