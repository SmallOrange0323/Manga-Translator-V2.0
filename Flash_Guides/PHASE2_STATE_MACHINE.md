> [!WARNING]  
> ## 🛑 開發環境與基準路徑設定 (CRITICAL ENVIRONMENT SETUP)  
> **接手的 AI 模型請注意，我們正在進行專案延伸的「異地重構」，請嚴格遵守以下路徑規則：**  
> 1. **你的開發目標區 (Write Target)：** `E:\OneDrive - 寰宇知識科技股份有限公司\Manga Translator V2.0`  
>    所有的程式碼與重構結果**只能**寫入這個資料夾。  
> 2. **你的參考基準區 (Read-Only Baseline)：** `E:\OneDrive - 寰宇知識科技股份有限公司\MangaTranslatorExtension_v1.0`  
>    遇到缺失的邏輯時，請去這個目錄讀取碼作為參考，但**絕對禁止**修改或覆蓋裡面的舊檔案。

# Flash 協作開發指南：Phase 2 - Storage-First 狀態機重構

> **🎯 機器人設定 (For Flash Model)**
> 你的任務是消滅 `background.js` 裡所有的全域陣列與變數，將專案改造成「不害怕 Service Worker 猝死」的架構。

## ⚠️ 絕對禁止 (DO NOT)
1. **禁止使用全域變數做運算**：像 `let novelQueue = []` 這樣放在頂層的變數必須被清除。
2. **禁止 UI 互相依賴**：`sidepanel.js` 不能再透過 `chrome.runtime.sendMessage` 去問 `background.js` "現在進度到哪了？"

## ✅ 實作標準 (MUST DO)
1. **唯一真理庫 (Single Source of Truth)**：
   寫一個管理類 `StateManager` 封裝 `chrome.storage.local.get` 和 `set`。所有狀態變更（包含推入對列）都必須直接寫入 local storage。
2. **事件驅動更新**：
   在 `sidepanel.js` 實作：
   ```javascript
   chrome.storage.onChanged.addListener((changes, namespace) => {
       if (changes.novelQueue) {
           updateQueueUI(changes.novelQueue.newValue);
       }
   });
   ```
3. **優化頻繁寫入**：
   若進度條每秒跳動 10 次，寫入 `chrome.storage` 會造成效能災難。你必須實作 Throttle (節流) 機制，確保至少每 200ms 才更新一次 UI 狀態。

## 💡 當你寫 Code 時的口吻
在輸出 `chrome.storage` 替換的代碼時，主動附帶 `console.warn` 告訴開發者：「這裡已替換為 Storage 操作，請注意效能是否受影響」。
