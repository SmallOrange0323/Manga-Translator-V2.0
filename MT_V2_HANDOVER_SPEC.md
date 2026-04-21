# Manga Translator V2.0 技術交接與檢核文件 (AI Handover Spec)

本文件旨在為接手審查此專案的其他 AI 模型提供完整的技術背景、架構說明以及目前的功能完成度。

## 1. 專案背景與開發目標
*   **來源版本**：基於 V1.8.6 (Manifest V3) 早期架構。
*   **V2.0 目標**：
    1. 從「單體腳本」重構為符合 **Vite** 模組化規範的專案。
    2. 解決舊版中 Service Worker 被終止時因狀態未持久化而導致的功能失效。
    3. 實現 PC 模式與未來的行動端 (Mobile) 差異化 UI 策略。

## 2. 核心架構組成 (System Architecture)

### 2.1 Storage-First 狀態機 (`src/utils/state.js`)
*   **關鍵邏輯**：放棄在後台腳本保持全域變數。所有關鍵狀態（如翻譯進度、API Key、作品名稱）皆持久化於 `chrome.storage.local`。
*   **原子更新 (Atomic Updates)**：`state.update()` 會先從 Storage 重新讀取值再寫入，防止跨組件（Sidepanel/Background）的寫入衝突。

### 2.2 背景通訊協議 (Background Messaging)
*   **非同步穩定性**：遵循「同步回應回傳 `false`，非同步回應回傳 `true`」原則。
*   **容錯機制**：在 `onMessage` 監聽器中對所有非同步 Promise 加入了 `.catch` 攔截，確保通訊頻道不會因報錯而死鎖。

### 2.3 圖片掃描與 Base64 處理 (`src/content/manga-engine.js`)
*   **混合獲取策略**：優先由背景腳本直接 `fetch` URL（繞過 Chrome 訊息通道限制，提升效能），失敗時才退回 Content Script 抓取。
*   **智慧過濾**：具備漫畫網站容器辨識（`.ts-main-image`, `#readerarea` 等），自動過濾導覽圖示。

## 3. 功能搬移進度 (Feature Migration Status)

### 3.1 已完整移入的功能 (Completed)
- [x] **側邊欄 (SidePanel) 選圖介面**：取代舊版浮動圖示，支援縮圖列表、勾選批次翻譯。
- [x] **智慧作品識別**：自動解析分頁標題，偵測作品 Roman 名稱並與詞庫連動。
- [x] **PC 沉浸式閱讀器 (`result.html`)**：獨立分頁顯示，支援串流顯示翻譯結果（卡片式渲染）。
- [x] **備援模型機制 (Fallback)**：主要模型失效時，自動切換至備用模型（如 1.5 Flash -> 1.5 Pro）。
- [x] **術語萃取與詞庫列**：側邊欄即時顯示術語數量，並具備「管理」跳轉功能。

### 3.2 結構已建立但尚待細修的功能 (In Progress)
- [ ] **小說翻譯模式**：邏輯已重構完成，但 UI 整合（Shadow DOM 注入）尚未在手機版上全面測試。
- [ ] **導出功能**：HTML 與 TXT 導出邏輯已搬移至 `result.js`，待驗證跨瀏覽器相容性。

## 4. 給後續審查 AI 的具體建議
1.  **關注通訊序列化**：目前大量 Base64 傳輸可能造成壓力，應檢查背景直接 Fetch 的覆蓋率。
2.  **檢視 Service Worker 喚醒**：檢查 `onMessage` 之外的事件觸發點（如 `onActivated`）是否能正確從 `state.js` 恢復運作。
3.  **UI 組件化**：目前的 Sidepanel 雖然美觀，但樣式仍寫於 `sidepanel.css` 中，未來若要實作 Mobile Shadow DOM 應考慮 CSS 變數的複用。

---
**檢核日期**：2026-04-20  
**當前開發分支**：V2.0 Core-Restoration Phase
