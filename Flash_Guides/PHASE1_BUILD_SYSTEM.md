> [!WARNING]  
> ## 🛑 開發環境與基準路徑設定 (CRITICAL ENVIRONMENT SETUP)  
> **接手的 AI 模型請注意，我們正在進行專案延伸的「異地重構」，請嚴格遵守以下路徑規則：**  
> 1. **你的開發目標區 (Write Target)：** `E:\OneDrive - 寰宇知識科技股份有限公司\Manga Translator V2.0`  
>    所有的程式碼與重構結果**只能**寫入這個資料夾。  
> 2. **你的參考基準區 (Read-Only Baseline)：** `E:\OneDrive - 寰宇知識科技股份有限公司\MangaTranslatorExtension_v1.0`  
>    遇到缺失的邏輯時，請去這個目錄讀取碼作為參考，但**絕對禁止**修改或覆蓋裡面的舊檔案。

# Flash 協作開發指南：Phase 1 - 建置系統與模組化 (Vite & MV3)

> **🎯 機器人設定 (For Flash Model)**
> 你的任務是協助開發者將原生的 Chrome Extension 轉換為使用 Vite 的架構，但不改變任何核心翻譯邏輯。你必須嚴格遵守以下 Manifest V3 的限制。

## ⚠️ 絕對禁止 (DO NOT)
1. **禁止動態載入**：絕對不能產生 `import()` 或程式碼分割 (Code Splitting)。因為舊版 Chrome 或特定的 Service Worker 環境不支援。
2. **禁止改變邏輯**：你在拆分 `background.js` 時，只能剪下和貼上，絕對不能自作主張優化或刪除原本的 `try-catch` 或重試邏輯。

## ✅ 實作標準 (MUST DO)
1. **Vite 配置標準**：
   請寫出 `vite.config.js`，並明確確保：
   - `build.rollupOptions` 必須將所有資源打包成單一檔案 (或至少限制檔案數量)。
   - 不可以啟動 Hash 檔名，否則 `manifest.json` 找不到檔案。
2. **模組化拆分規則**：
   - 建立 `/src/background` 資料夾。
   - 將通訊 (Message Listeners) 留在 `background/index.js`。
   - 將 API 呼叫移至 `background/api.js`。
   - 要求開發者在 `manifest.json` 中將 background 的類型設為 `"type": "module"`。

## 💡 當你寫 Code 時的口吻
請非常簡潔。給出 `vite.config.js` 範例後，請提醒使用者：「這份配置專注於產生平坦的腳本檔案，避免 Manifest V3 常見的權限錯誤。」
