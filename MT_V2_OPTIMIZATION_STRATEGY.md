# Manga Translator V2.0 — 速度與品質優化策略

> 最後更新：2026-04-22
> 目標：在不增加 API 成本的前提下，極大化 Gemini 3.1 的效能，並提升漫畫翻譯的準確度與流暢感。

---

## 一、 速度提升方案 (Performance & Latency)

### 1. 隱式快取對齊 (Implicit Context Caching)
*   **核心原理**：Gemini 3.1 Flash-Lite 會快取請求中超過 1024 tokens 的重複前綴。
*   **具體做法**：
    *   **固定順序**：將 `System Prompt` -> `批次規則` -> `語彙庫 (Glossary)` 放在 `parts` 陣列的最前端。
    *   **變動隔離**：確保圖片 (InlineData) 永遠放在 `parts` 陣列的最後。
    *   **效果預期**：
        - 第二批次起的 API 延遲縮短 30%-50%。
        - 快取部分的 Token 費用節省 90%。

### 2. 併發批次處理 (Concurrent Batching)
*   **核心原理**：目前採用的單線程批次 (Serial Batching) 會造成閒置等待。
*   **具體做法**：
    *   修改 `background/index.js`，允許同時啟動 2-3 個翻譯 Job。
    *   配合 `utils/concurrency.js` 的 Semaphore 限制，確保不會超出 API Key 的 Rate Limit。
    *   **效果預期**：總翻譯時間（例如 40 頁漫畫）可從 120 秒縮短至 60 秒以內。

### 3. 圖片輕量化 (Image Minimization)
*   **具體做法**：
    *   在 `content/manga-engine.js` 抓取圖片時，利用 `canvas` 進行預縮放。
    *   限制最大寬高為 1600px，並使用 JPEG 格式 (Quality 0.8) 轉 Base64。
    *   **效果預期**：減少傳輸頻寬需求，降低 `Payload Guard` 觸發子分片的頻率。

---

## 二、 品質提升方案 (Translation Quality & Accuracy)

### 1. 強化語彙庫：角色設定注入 (Character-Aware Translation)
*   **優化方向**：讓模型知道「誰在說話」。
*   **做法**：
    *   在 `glossary-manager.js` 中增加 `context_tags`。
    *   自動識別漫畫標題或第一頁資訊，提取出「故事類型」（例：百合、冒險、恐怖）。
    *   在 Prompt 注入：`這是一部 [故事類型] 漫畫，請使用對應的語氣。`

### 2. 結構化校驗：頁碼與座標對位 (Spatial Anchoring)
*   **優化方向**：解決批次翻譯時，多張圖片內容混淆的問題。
*   **做法**：
    *   在每一張圖的 `parts` 前加入識別碼：`--- IMAGE_ID: PAGE_{N} ---`。
    *   要求 `response_schema` 必須回傳對應的 `image_id`。
    *   **效果預期**：對位準確率提升至 99.9%，杜絕譯文跳頁現象。

### 3. 譯文自檢與潤色 (Self-Correction Prompt)
*   **優化方向**：減少 AI 感，增加台灣漫畫常見的語法。
*   **Prompt 增修內容**：
    - `嚴禁使用「透過」、「進行」等冗長語法。`
    - `根據角色性別正確使用「妳/你」。`
    - `擬聲詞 (SFX) 若無術語表定義，應保持日文或使用自然的擬聲詞翻譯。`

---

## 三、 執行優先級 (Action Plan)

| 優先級 | 項目 | 修改檔案 | 預期收益 |
|---|---|---|---|
| **P0** | Context Caching 優化 | `translate-api.js`, `constants.js` | 速度提升 + 成本降低 |
| **P1** | 頁碼對位強化 (Spatial Anchoring) | `translate-api.js`, `index.js` | 修正跳頁 Bug，提升穩定性 |
| **P1** | 併發批次處理 | `index.js`, `concurrency.js` | 大量翻譯時的速度翻倍 |
| **P2** | 角色語氣注入 | `glossary-manager.js` | 譯文品質提升 |

---

## 四、 驗收指標

1.  **速度**：10 張圖片的批次翻譯時間 < 15 秒。
2.  **快取**：API 響應中的 `cached_content_token_count` 必須大於 0。
3.  **品質**：在 20 張以上的漫畫批次中，不出現任何頁序錯誤。
