> [!WARNING]  
> ## 🛑 開發環境與基準路徑設定 (CRITICAL ENVIRONMENT SETUP)  
> **接手的 AI 模型請注意，我們正在進行專案延伸的「異地重構」，請嚴格遵守以下路徑規則：**  
> 1. **你的開發目標區 (Write Target)：** `E:\OneDrive - 寰宇知識科技股份有限公司\Manga Translator V2.0`  
>    所有的程式碼與重構結果**只能**寫入這個資料夾。  
> 2. **你的參考基準區 (Read-Only Baseline)：** `E:\OneDrive - 寰宇知識科技股份有限公司\MangaTranslatorExtension_v1.0`  
>    遇到缺失的邏輯時，請去這個目錄讀取碼作為參考，但**絕對禁止**修改或覆蓋裡面的舊檔案。

# Flash 協作開發指南：Phase 3 - 行動端 Shadow DOM 注入

> **🎯 機器人設定 (For Flash Model)**
> 你的任務是開發一個跨平台通用的行動端浮動介面，絕對不能破壞使用者的瀏覽器網頁。這需要高度專注的安全 DOM 操作。

## ⚠️ 絕對禁止 (DO NOT)
1. **禁止全域 CSS 污染**：不能在 `content_script.js` 直接插入 `<style>` 標籤並對 `div` 或 `a` 原生標籤下屬性，這會毀了使用者正在看的網站（如 RawKuma）。
2. **禁止使用 `innerHTML` 組合大段 HTML**：這會被 Chrome Web Store 審查打回票。

## ✅ 實作標準 (MUST DO)
1. **使用 Shadow Root 隔離**：
   ```javascript
   const host = document.createElement('div');
   host.id = 'mt-mobile-host';
   const shadowRoot = host.attachShadow({ mode: 'closed' });
   // 所有 UI 只能塞到 shadowRoot 裡面
   ```
2. **安全的元素建立**：
   請大量使用 `document.createElement` 與 `element.textContent` 來構建 DOM，禁止出現將變數串接到字串再塞進 `innerHTML` 的行為。
3. **拖曳與收合功能**：
   這是一個「浮動圓球/面板」，必須附帶 `touchstart` 與 `touchmove` 的行動端滑動支援。

## 💡 當你寫 Code 時的口吻
完成 Shadow DOM 架構後，提醒開發者：「這層 Shadow Root 將確保我們的翻譯控制面板猶如一個獨立的島嶼，完全不受任何亂塗亂畫的網站 CSS 影響。」
