# Manga Translator V2.0 — 專案規格書 (AI 協作開發用)

> 最後更新：2026-04-22
> 本文件是所有參與開發的 AI 模型的共同參考基準。修改代碼前請先閱讀完整文件。

---

## 一、專案概述

Manga Translator V2.0 是一個 Chrome / Edge 瀏覽器擴充功能，用於將日文漫畫與輕小說即時翻譯為繁體中文。後端呼叫 Google Gemini API 進行圖片 OCR + 翻譯。

**現階段目標：**
1. 提升翻譯效率（Gemini Context Caching、Model-Gating）
2. 實現行動端 UI（Edge Android 不支援 Sidepanel，需改用 Content Script Overlay）

---

## 二、技術棧

| 項目 | 詳情 |
|---|---|
| 規範 | Chrome Extension Manifest V3 |
| 建置 | Vite 5 + @crxjs/vite-plugin (beta) |
| 語言 | ES Module (全程 `import/export`，無 CommonJS) |
| 後端 | Google Gemini API (REST，`generativelanguage.googleapis.com`) |
| 狀態管理 | `chrome.storage.local`（Storage-first 架構，不依賴記憶體） |
| UI 框架 | 無（原生 HTML + CSS + JS） |

### 模型配置（截至 2026-04）

| 用途 | 模型 | 發布時間 | 隱式快取 |
|---|---|---|---|
| 漫畫翻譯（主要） | `gemini-3.1-flash-lite-preview` | 2026-03 | ✅ 支援（90% Token 折扣） |
| 漫畫翻譯（備援） | `gemma-4-26b-it` (MoE) | 2026-04 | ❌ 不支援 |
| 小說翻譯 | `gemma-4-31b-it` (Dense) | 2026-04 | ❌ 不支援 |
| 術語萃取 | 跟隨主模型設定 | — | 同主模型 |

> **隱式快取說明：** Gemma 系列為開源模型，透過 Google AI API 託管時不具備 Gemini 系列的快取基礎設施。階段一的 Prompt 優化僅對 Gemini 3.1 Flash-Lite 生效。

> **關鍵約束：Service Worker 環境**
> - `background/index.js` 運行於 Service Worker，**沒有 `window` 物件**。
> - **禁止使用** `await import()` 動態匯入。所有依賴必須在檔案頂部靜態匯入。
> - 全域函式使用 `self` 而非 `window`。

---

## 三、目錄結構與檔案職責

```
src/
├── background/                 # Service Worker（核心引擎）
│   ├── index.js                # 訊息路由 + 批次翻譯主迴圈 (784 行)
│   ├── translate-api.js        # Gemini API 封裝（單張/批次/術語萃取）
│   └── glossary-manager.js     # 語彙庫 CRUD（載入/儲存/合併/注入 Prompt）
│
├── content/                    # Content Script（注入到網頁中）
│   ├── main.js                 # 訊息監聽入口、小說翻譯啟動器
│   ├── manga-engine.js         # 框選翻譯 + 圖片掃描 (crawlImages)
│   ├── novel-engine.js         # 小說段落擷取與譯文注入
│   └── ui/                     # （目前為空，未來行動端 Overlay 預計放此處）
│
├── sidepanel/                  # Sidepanel UI（僅桌電版）
│   ├── index.html              # 側邊欄 HTML
│   ├── main.js                 # 側邊欄互動邏輯
│   └── sidepanel.css           # 側邊欄樣式
│
├── reader/                     # 翻譯結果閱讀頁
│   ├── result.html             # 結果頁 HTML
│   ├── result.js               # 結果渲染 + 匯出邏輯
│   └── result.css              # 結果頁樣式
│
├── options/                    # 設定頁面
│   ├── index.html              # 設定頁 HTML（含模型選擇、API Key 輸入）
│   ├── main.js                 # 設定讀寫邏輯
│   └── options.css             # 設定頁樣式
│
└── utils/                      # 共用工具庫
    ├── state.js                # StateManager 單例（Storage-first 狀態管理）
    ├── constants.js            # 所有 Prompt 定義 + 批次處理規則
    ├── logger.js               # 統一 log 工具（log.info/warn/api/state）
    ├── concurrency.js          # Semaphore 實作（併發控制）
    ├── json-utils.js           # LLM 輸出 JSON 預處理（清理換行/Markdown）
    └── manga-utils.js          # 漫畫標題解析（extractMangaTitle）
```

---

## 四、核心資料流

### 漫畫批次翻譯

```
使用者操作 (Sidepanel)
  → [message: crawlImages] → content/manga-engine.js → 回傳圖片列表
  → [message: START_MANGA_BATCH_PC_MODE] → background/index.js
    → 圖片分組 (batchSize，預設 10)
    → 每組：fetch 圖片 → 轉 Base64 → Payload Guard 檢查
    → callGeminiAPIBatch() → 打包多圖 + 結構化錨點 → API 請求
    → parseBatchOutput() → 頁碼對位後回填
    → 失敗時降級：Semaphore 並行逐張翻譯
    → 結果透過 [message: appendResult] 串流至 reader/result.js
  → 異步：extractTermsFromTranslation() → 分片萃取術語 → 寫入語彙庫
```

### 訊息通道（Message Actions 清單）

| Action | 方向 | 用途 |
|---|---|---|
| `crawlImages` | Background → Content | 掃描頁面圖片 |
| `fetchBase64` | Background → Content | 透過 Content Script 代為抓取圖片 |
| `START_MANGA_BATCH_PC_MODE` | Sidepanel → Background | 啟動批次翻譯 |
| `appendResult` | Background → Result Page | 串流單頁翻譯結果 |
| `updateProgress` | Background → Result Page | 更新進度顯示 |
| `batchComplete` | Background → Result Page | 批次翻譯完成 |
| `PROCESS_SCREENSHOT` | Content → Background | 框選翻譯 |
| `ADD_TO_QUEUE` | Content → Background | 小說段落加入翻譯佇列 |
| `GET_GLOSSARY_INFO` | Sidepanel → Background | 查詢當前語彙庫 |

---

## 五、已完成功能清單

| 功能 | 狀態 | 說明 |
|---|---|---|
| 多圖批次翻譯 | ✅ 穩定 | callGeminiAPIBatch + PAGE_BOUNDARY 錨點 |
| Payload Guard | ✅ 穩定 | Base64 總量 > 15MB 自動拆分子批次 |
| 批次失敗降級 | ✅ 穩定 | 自動退回 Semaphore 並行逐張翻譯 |
| JSON 預處理 | ✅ 穩定 | sanitizeJsonForParsing 自動修補 |
| 語彙庫萃取 | ✅ 穩定 | 分片萃取 + 模型名稱連動 |
| API Key 輪替 | ✅ 穩定 | Round-Robin，支援多組 Key |
| 框選翻譯 | ✅ 基本可用 | 桌電版可在頁面上框選區域翻譯 |
| 小說翻譯 | ⚠️ 基本可用 | 核心流程完成，尚未大量測試 |

---

## 六、開發路線圖（三個階段）

### 階段一：Prompt 結構優化（隱式快取對齊）

**目標：** 在不修改 API 端點或新增 API 功能的前提下，調整 Prompt 排列順序，使 Gemini 3.1 Flash-Lite 的隱式快取機制自動生效。

**原理：** Gemini 3.x 模型會自動偵測「連續請求中相同的前綴」，並對這些重複的 Token 套用快取折扣（90%）。只要確保所有批次請求的 Prompt 以相同順序開頭（System Prompt → 語彙庫 → 批次規則 → 最後才放圖片），就能自動觸發。此優化僅對 Gemini 系列模型生效，Gemma 系列不受影響也不會出錯。

**具體改動範圍：**
- `translate-api.js` 的 `callGeminiAPIBatch()`：調整 `parts` 陣列的排列順序。
- `constants.js`：可能需要微調 Prompt 結構，確保每次傳送的前綴部分一致。

**約束：**
- 不得修改 `index.js` 的分組邏輯。
- 不得改動 `response_schema`。
- 修改後，翻譯結果的格式與現有結構必須完全向後相容。

**驗收標準：**
- `npm run build` 通過。
- 執行翻譯後，在 API response 的 `usage_metadata` 中觀察到 `cached_content_token_count > 0`（同一漫畫第二批起生效）。

---

### 階段二：行動端 UI (Mobile Overlay)

**目標：** 在 Edge Android 上提供完整的翻譯操作介面。

**設計原則：**
- 桌電版繼續使用現有 Sidepanel。
- 行動端透過 Content Script 注入浮動按鈕 + 全螢幕 Overlay（抽屜式）。
- Background 引擎**不做任何改動**。行動端 UI 透過與桌電版相同的 Message Actions 溝通。
- 所有行動端 UI 使用 **Shadow DOM** 進行 CSS 隔離，避免干擾原始網頁樣式。

**具體改動範圍：**
- `content/ui/` 下新增行動端面板模組（例如 `mobile-panel.js`、`mobile-panel.css`）。
- `content/main.js`：加入環境偵測（UserAgent 判斷），決定載入 Sidepanel 邏輯或 Mobile Overlay。
- `manifest.json`：可能需要在 `web_accessible_resources` 中追加新資源。

**約束：**
- 禁止修改 `background/` 目錄下的任何檔案。
- 禁止修改 `sidepanel/` 目錄下的任何檔案。
- 禁止修改 `reader/` 目錄下的任何檔案。
- Mobile Overlay 必須能發送與 Sidepanel 相同的 Message Actions（如 `crawlImages`、`START_MANGA_BATCH_PC_MODE`）。

**驗收標準：**
- `npm run build` 通過。
- 桌電版 Sidepanel 功能完全不受影響（回歸測試）。
- 在 Edge Android 上，能看到浮動按鈕、點擊後展開面板、執行圖片掃描與批次翻譯。

---

### 階段三：Model-Gating（多模型智慧路由）

**目標：** 根據圖片特徵自動選擇不同等級的模型。

**路由邏輯草案：**
- Base64 長度 > 某個門檻值 → 圖片細節多 → 使用 Pro 模型
- Base64 長度 ≤ 門檻值 → 簡單場景 → 使用 Flash 模型
- 門檻值初期以可配置參數形式寫在 Options 中

**具體改動範圍：**
- `background/index.js`：在圖片 Base64 抓取後、打包送出前，根據圖片 Payload 大小進行分流。
- `options/main.js` + `options/index.html`：新增「進階模型」設定欄位。
- `translate-api.js`：`callGeminiAPIBatch` 需能接受不同 model 參數（目前已支援從 state 讀取）。

**約束：**
- 不得修改 `utils/` 工具庫（除非新增全新檔案）。
- 不得修改 Prompt 結構（已在階段一定案）。
- 分流邏輯出錯時必須有 fallback（回退到主模型）。

**驗收標準：**
- `npm run build` 通過。
- Console 日誌清楚顯示哪些圖片被分配到哪個模型。
- 翻譯結果格式不受模型切換影響。

---

## 七、通用開發規則（所有 AI 模型必須遵守）

1. **一次只改一件事。** 每個修改任務只處理一個功能或一個問題。
2. **禁止動態 import。** Service Worker 不支援 `await import()`。
3. **所有輸出使用繁體中文。** 包含日誌訊息、註解、變數命名中的中文字串。
4. **改動後必須說明驗收方式。** 告訴使用者「怎麼確認修改有效」。
5. **改動前先讀完相關檔案。** 不得基於猜測修改代碼。如果不確定某個函式的行為，先閱讀原始碼。
6. **不得刪除現有的 `log` 呼叫。** 這些日誌是排查問題的關鍵。可以新增，不得刪除。
7. **修改 Prompt 時，必須同時確認 JSON Schema 是否需要同步調整。** `constants.js` 中的 Prompt 與 `translate-api.js` 中的 `response_schema` 是成對的。
8. **建置指令：** `npm run build`（Vite 生產建置，輸出至 `dist/`）。
