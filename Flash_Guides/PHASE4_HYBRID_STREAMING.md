> [!WARNING]  
> ## 🛑 開發環境與基準路徑設定 (CRITICAL ENVIRONMENT SETUP)  
> **接手的 AI 模型請注意，我們正在進行專案延伸的「異地重構」，請嚴格遵守以下路徑規則：**  
> 1. **你的開發目標區 (Write Target)：** `E:\OneDrive - 寰宇知識科技股份有限公司\Manga Translator V2.0`  
>    所有的程式碼與重構結果**只能**寫入這個資料夾。  
> 2. **你的參考基準區 (Read-Only Baseline)：** `E:\OneDrive - 寰宇知識科技股份有限公司\MangaTranslatorExtension_v1.0`  
>    遇到缺失的邏輯時，請去這個目錄讀取碼作為參考，但**絕對禁止**修改或覆蓋裡面的舊檔案。

# Flash 協作開發指南：Phase 4 - 有限串流與體感優化 (Streaming)

> **🎯 機器人設定 (For Flash Model)**
> 你的任務是改善使用者的等待體驗。這很容易造成資料崩潰，你必須非常謹慎地採用串流和預拉取技術。

## ⚠️ 絕對禁止 (DO NOT)
1. **禁止對 Manga Mode (圖片翻譯) 使用串流**：因為圖片翻譯回傳的是帶有座標和原文的強結構 JSON，把半殘的 JSON 丟給 UI 去解析只會造成全盤崩潰。
2. **禁止在未結束前更新最終狀態**：串流只是為了顯示 UI 預覽，真正的「儲存到資料庫」必須等到整個 Response 結束且檢核無誤後才能執行。

## ✅ 實作標準 (MUST DO)
1. **實作小說模式的 Streaming API**：
   當使用 Gemini 的 Stream API 時，利用 `background.js` 解析 Chunk，並且透過建立通道或寫入暫存 Storage 的方式，把 Markdown 純文本字串一段一段秀到畫面上。
2. **實作漫畫模式的「處理中」展示**：
   雖然沒串流 JSON，但你要改寫目前的迴圈，讓 `background.js` 在分析完原本第一頁時就先發個 `partial_translated` 訊號給 Content Script，讓畫面上先冒出第一個譯文框，而不是等 10 張全部分析完才一起跳出來。
3. **錯誤復原 (Resilience)**：
   若串流在中途斷線，必須有能力自動重試或安靜結束，絕不能卡在迴圈裡無限循環。

## 💡 當你寫 Code 時的口吻
請以自信但謹慎的態度回覆：「雖然串流體驗極佳，但我已為此加上了嚴格的 Buffer 邊界防護，以防止出現無效的 JSON 災難。」
