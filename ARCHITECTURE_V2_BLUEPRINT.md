> [!WARNING]  
> ## 🛑 開發環境與基準路徑設定 (CRITICAL ENVIRONMENT SETUP)  
> **接手的 AI 模型請注意，我們正在進行專案延伸的「異地重構」，請嚴格遵守以下路徑規則：**  
> 1. **你的開發目標區 (Write Target)：** `E:\OneDrive - 寰宇知識科技股份有限公司\Manga Translator V2.0`  
>    你產出的所有新檔案、套件安裝、Vite 建置，**只能**寫入這個資料夾。  
> 2. **你的參考基準區 (Read-Only Baseline)：** `E:\OneDrive - 寰宇知識科技股份有限公司\MangaTranslatorExtension_v1.0`  
>    你可以透過 `view_file` 或搜尋去讀取這個歷史目錄（v1.8.6 版本）的邏輯作為參考，但**絕對禁止**修改裡面的任何一根毛。

# Manga Translator V2.0 現代化架構藍圖 (務實重構版)

經過對 Chrome Manifest V3 環境與行動端（Mobile）限制的嚴格自我檢視，初版藍圖過於理想化。此版本針對「Service Worker 隨機死亡」、「行動端 Popup 見光死」與「Vite 相容性」等實務痛點，提出了防禦性的架構設計。

---

## 🛠️ 階段一：防禦性建置系統 (Defensive Build Setup)
不再盲目依賴純 Vite 的開發體驗，針對擴充功能環境進行特化配置。

1. **基礎工具**：採用 `Vite` 搭配 `@crxjs/vite-plugin` (或類似專為 Extension 設計的外掛)。
2. **打包策略**：
   * 強制將 `background.js` 打包為無外部相依 (No Dynamic Imports) 的單一檔案，迴避舊版瀏覽器的 ES Module 載入錯誤。
   * 將所有資源（如馬娘背景圖、圖示）內聯 (Inline) 或放置於 `public` 資料夾，解決打包後的路徑迷失。

---

## 🗄️ 階段二：Storage-First 狀態機 (State Management)
放棄純記憶體（如 Redux）的全域變數管理，正視 Service Worker 會隨時被系統「殺死」的宿命。

1. **唯一真理來源 (Single Source of Truth)**：
   * 所有狀態（隊列進度、目前選取語彙庫、翻譯字數）皆以 `chrome.storage.local` 為基準。
2. **響應式同步 (Reactive Sync)**：
   * 取代目前大量的 `sendMessage`，各模組（UI、Background）只負責監聽 `chrome.storage.onChanged` 事件來更新自身。
   * **結果**：即使 Background 重啟，UI 也能瞬間從 Storage 讀回最新進度，不再發生「狀態丟失」。

---

## 📱 階段三：行動端 Shadow DOM 注入 (Mobile UI Strategy)
**【重大修正】放棄原本提議的 `popup.html` 方案。** 手機版 Popup 會因點擊網頁其他區域而強制關閉，完全不適合需要常駐看翻譯的情境。

1. **Shadow DOM 浮動元件 (Floating Widget)**：
   * 透過 `content_script` 將翻譯 UI 強行注入到目標網頁的右下角（類似懸浮球或浮動視窗）。
   * 使用 **Shadow DOM** 技術將我們的 UI 包裹起來。
   * **目的**：保證我們擴充功能的 CSS 不會把宿主網頁（如 Rawkuma）的排版搞爛，同時宿主網頁的 CSS 也干擾不了我們的翻譯框。
2. **觸控優先設計 (Touch-First)**：
   * 選單改為 Bottom Sheet（底部抽屜）或大型點擊區塊，替換掉原本依賴精巧滑鼠操作的下拉選單。

---

## 🌊 階段四：混合式翻譯與有限串流 (Hybrid Streaming)
**【重大修正】放棄對複雜 JSON 進行粗暴的串流解析**，改用折衷且穩定的方案解決「體感煩躁」。

1. **雙軌策略**：
   * **漫畫模式（需處理 JSON）**：維持等待整批完成。但加入「**局部預覽**」：每分析完一個對話框就存入 Storage，UI 監聽後直接在原圖上畫框，讓使用者「看得到正在發生的事」。
   * **小說模式（純文字）**：啟用真實 Streaming。因為只需處理純文本，不會有 JSON 殘破的問題。將串流文字用 Markdown 長條圖般即時推送到 Shadow DOM 介面上。
2. **預先拉取 (Prefetch & Cache)**：
   * 小說模式下，當使用者滑動到當前章節的 50% 時，背景默默將下一頁的 DOM 抓取並丟給輕量模型（如 Flash）進行預翻譯，存入本地 Cache。實現「零延遲」換頁。

---

## 🧭 實作優化路徑 (The Pragmatic Path)
這份重構版藍圖才是真正在戰場上能存活的架構。
1. **先防守**：將目前 `background.js` 所有的全域變數重構為 `chrome.storage` 響應式架構。
2. **再分身**：利用 Vite 建置出第一個透過 Shadow DOM 注入的「浮動 UI」雛形。
3. **後進攻**：全面優化小說串流翻譯與預加載。
