import { state } from '../utils/state.js';
import * as Constants from '../utils/constants.js';
import { extractMangaTitle } from '../utils/manga-utils.js';
import { loadGlossary, saveGlossary, mergeGlossaryTerms, buildGlossaryPromptSnippet } from './glossary-manager.js';
import { translateTexts, extractTermsFromTranslation, callGeminiAPIBatch } from './translate-api.js';
import { log } from '../utils/logger.js';
import { Semaphore } from '../utils/concurrency.js';

let navigationContext = {}; // tabId -> mangaKey
let lastNovelUrlByTab = {}; // tabId -> url (防止重複觸發)
let capturedScreenshotForSelection = null;
let pendingBatchJobs = {}; // resultTabId -> { sourceTabId, images }

log.info('Background', '漫譯 V2 背景服務程式已啟動');

// 當 Service Worker 啟動或重啟時，初次化狀態
state.init().then(async () => {
    log.info('Background', '狀態載入完成，檢查待處理任務...');
    
    // 範例：檢查是否有遺留的小說翻譯任務
    const queue = await state.get('novelQueue', []);
    if (queue.length > 0) {
        log.warn('Background', `偵測到 ${queue.length} 個小說待處理任務，準備恢復...`);
        // 這裡未來會啟動 processNovelQueue()
    }
});

// 真正的翻譯處理循環
async function processNovelQueue() {
    const isProcessing = await state.get('isProcessingNovel', false);
    if (isProcessing) return;

    await state.set('isProcessingNovel', true);
    
    while (true) {
        const queue = await state.get('novelQueue', []);
        if (queue.length === 0) break;

        const task = queue.shift();
        await state.set('novelQueue', queue);

        // 詞庫整合：獲取當前作品 Key 並載入術語
        // 自癒邏輯：若 SW 重啟導致 navigationContext 遺失，從 Tab 標題重新解析
        let mangaKey = navigationContext[task.tabId];
        if (!mangaKey && task.tabId) {
            try {
                const tabInfo = await chrome.tabs.get(task.tabId);
                const titleResult = extractMangaTitle(tabInfo.title || '');
                if (titleResult) {
                    mangaKey = titleResult.romanKey;
                    navigationContext[task.tabId] = mangaKey;
                    log.info('Background', `小說模式自癒：從標題重新辨識作品 "${titleResult.displayName}"`);
                }
            } catch (e) {
                log.warn('Background', `小說模式自癒失敗，無法取得 Tab 資訊: ${e.message}`);
            }
        }

        let glossarySnippet = '';
        let currentGlossary = null;

        if (mangaKey) {
            currentGlossary = await loadGlossary(mangaKey);
            if (currentGlossary && currentGlossary.terms && currentGlossary.terms.length > 0) {
                glossarySnippet = buildGlossaryPromptSnippet(currentGlossary.terms);
                log.info('Background', `注入詞庫至 ${mangaKey}（${currentGlossary.terms.length} 筆術語）`);
            }
        }

        const allResults = [];
        try {
            // 每段翻譯完就立即更新 Storage (串流)
            for (let i = 0; i < task.texts.length; i++) {
                const text = task.texts[i];
                const result = await translateTexts([text], { glossarySnippet }); 
                
                // translateTexts 無 schema 時回傳裸 JSON：可能是字串、字串陣列、或物件
                const translatedText =
                    (typeof result === 'string' ? result : null) ||
                    (Array.isArray(result) ? result[0] : null) ||
                    result?.translation ||
                    result?.text ||
                    '（翻譯失敗）';
                const resultItem = { 
                    tabId: task.tabId, 
                    idx: task.startIndex + i,
                    original: text,
                    translation: translatedText 
                };
                allResults.push(resultItem);

                await state.update('novelResults', (current = []) => [...current, resultItem]);

                await state.setThrottled('novelProgress', {
                    status: `正在翻譯第 ${i + 1} / ${task.texts.length} 段...`
                });
            }

            // 非同步發起術語萃取 (不阻塞翻譯流程)
            if (mangaKey && allResults.length > 0) {
                (async () => {
                    log.info('Background', `開始非同步術語萃取：${mangaKey}...`);
                    const newTerms = await extractTermsFromTranslation(allResults);
                    if (newTerms.length > 0) {
                        const existingTerms = currentGlossary ? currentGlossary.terms : [];
                        const { terms: mergedTerms, addedCount } = mergeGlossaryTerms(existingTerms, newTerms);
                        if (addedCount > 0) {
                            await saveGlossary(mangaKey, {
                                displayName: currentGlossary?.displayName || mangaKey,
                                terms: mergedTerms
                            });
                        }
                    }
                })();
            }
        } catch (err) {
            log.error('Background', '翻譯迴圈發生錯誤:', err);
        }
    }

    await state.set('isProcessingNovel', false);
    await state.set('novelProgress', null);
}

// 監聽訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log.info('Messenger', `收到訊息: ${message.action}`, { tabId: sender.tab?.id });

  if (message.action === 'PING') {
    sendResponse({ status: 'PONG', version: '2.0.0' });
  }
  
  if (message.action === 'ADD_TO_QUEUE') {
    const payload = message.payload;
    if (!payload.tabId && sender.tab) payload.tabId = sender.tab.id;
    handleAddToQueue(payload).then(() => {
        processNovelQueue(); // 啟動處理器
    }).catch(err => log.error('Background', 'Queue update failed:', err));
    sendResponse({ status: 'queued' });
    return false; // 同步回應
  }

  if (message.action === 'START_MANGA_BATCH_PC_MODE') {
      const { tabId, images } = message.payload;
      // 儲存 payload，等 result.html 的 resultPageReady 訊號再開始翻譯
      chrome.storage.local.set({ mt_batch_payload: { tabId, images } }, () => {
          chrome.tabs.create({ url: chrome.runtime.getURL('src/reader/result.html') + '?tabId=' + tabId }, (tab) => {
              pendingBatchJobs[tab.id] = { sourceTabId: tabId, images };
              // Bug #6 修復：60 秒內未收到 resultPageReady 訊號則自動清除，
              // 避免結果頁在開啟前被關閉導致記錄永久殘留
              setTimeout(() => { delete pendingBatchJobs[tab.id]; }, 60000);
          });
      });
      sendResponse({ status: 'ok' });
      return false;
  }

  if (message.action === 'resultPageReady') {
      const resultTabId = sender.tab?.id;
      if (resultTabId && pendingBatchJobs[resultTabId]) {
          const { sourceTabId, images } = pendingBatchJobs[resultTabId];
          delete pendingBatchJobs[resultTabId];
          processMangaBatchPCMode(sourceTabId, resultTabId, images);
      }
      sendResponse({ status: 'ok' });
      return false;
  }

    if (message.action === 'GET_GLOSSARY_INFO') {
        const { mangaKey } = message.payload;
        loadGlossary(mangaKey).then(entry => {
            sendResponse({ 
                success: true, 
                displayName: entry?.displayName || mangaKey,
                termCount: entry?.terms?.length || 0 
            });
        }).catch(err => {
            console.error('[Background] GET_GLOSSARY_INFO failed:', err);
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    if (message.action === 'PRE_CAPTURE_FOR_SELECTION') {
    const windowId = sender.tab ? sender.tab.windowId : null;
    chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 100 }, (result) => {
        if (chrome.runtime.lastError) {
          console.warn("[PreCapture] 截圖失敗:", chrome.runtime.lastError.message);
          capturedScreenshotForSelection = null;
          sendResponse({ success: false });
        } else {
          capturedScreenshotForSelection = result;
          sendResponse({ success: true });
        }
    });
    return true; // 保持通道以進行異步回應
  }

  if (message.action === 'PROCESS_SCREENSHOT') {
    handleProcessScreenshot(message.rect, sender.tab.id)
        .then(res => sendResponse(res))
        .catch(err => {
            console.error('[Background] PROCESS_SCREENSHOT failed:', err);
            sendResponse({ success: false, error: err.message });
        });
    return true; // 非同步處理中
  }
  

  if (message.action === 'getResultMetadata') {
      const sourceTabId = parseInt(new URL(sender.tab?.url || 'about:blank').searchParams.get('tabId'));
      const mangaKey = navigationContext[sourceTabId] || null;
      const navLinks = { prev: null, next: null };
      let displayName = null;
      if (mangaKey) {
          loadGlossary(mangaKey).then(glossary => {
              displayName = glossary?.displayName || mangaKey;
              sendResponse({ navLinks, mangaKey, displayName });
          }).catch(() => sendResponse({ navLinks, mangaKey, displayName }));
          return true;
      }
      sendResponse({ navLinks, mangaKey, displayName });
      return false;
  }

  if (message.action === 'getGlossaryDetail') {
      const { mangaKey } = message;
      if (!mangaKey) { sendResponse({ entry: null }); return false; }
      loadGlossary(mangaKey).then(entry => {
          sendResponse({ entry: entry || null });
      }).catch(() => sendResponse({ entry: null }));
      return true;
  }

  if (message.action === 'saveGlossaryTerm') {
      const { mangaKey, displayName, ori, trans } = message;
      if (!mangaKey || !ori || !trans) {
          sendResponse({ success: false, error: '缺少必要欄位' });
          return false;
      }
      (async () => {
          try {
              const existing = await loadGlossary(mangaKey) || { displayName: displayName || mangaKey, terms: [] };
              if (existing.terms.some(t => t.ori === ori)) {
                  sendResponse({ success: false, error: '該原文已存在' });
                  return;
              }
              existing.terms.push({ ori: ori.trim(), trans: trans.trim(), source: 'user', createdAt: Date.now() });
              await saveGlossary(mangaKey, existing);
              sendResponse({ success: true });
          } catch(e) {
              sendResponse({ success: false, error: e.message });
          }
      })();
      return true;
  }

  if (message.action === 'retranslateImage') {
      const { url, tabId, mangaKey } = message;
      (async () => {
          try {
              let base64 = null;
              if (url && url.startsWith('data:image')) {
                  base64 = url.split(',')[1];
              } else if (url) {
                  const res = await fetch(url);
                  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
                  const buf = await res.arrayBuffer();
                  const bytes = new Uint8Array(buf);
                  let binary = '';
                  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                  base64 = btoa(binary);
              }
              if (!base64) throw new Error('無法取得圖片 Base64');
              const modelName = await state.get('modelName', 'gemini-1.5-flash');
              let finalPrompt = await state.get('customPrompt', Constants.DEFAULT_PROMPT_ONE_STEP);
              if (modelName.toLowerCase().includes('gemma')) finalPrompt = Constants.DEFAULT_PROMPT_GEMMA_ONE_STEP;
              let glossarySnippet = '';
              if (mangaKey) {
                  const gl = await loadGlossary(mangaKey);
                  if (gl?.terms) glossarySnippet = buildGlossaryPromptSnippet(gl.terms);
              }
              const result = await translateTexts([], {
                  model: modelName,
                  prompt: finalPrompt,
                  glossarySnippet,
                  imageBase64: base64,
                  schema: {
                      type: 'OBJECT',
                      properties: {
                          results: {
                              type: 'ARRAY',
                              items: {
                                  type: 'OBJECT',
                                  properties: {
                                      original: { type: 'STRING' },
                                      translation: { type: 'STRING' }
                                  },
                                  required: ['original', 'translation']
                              }
                          }
                      },
                      required: ['results']
                  }
              });
              if (result?.results) {
                  sendResponse({ results: result.results, usedModelName: modelName });
              } else {
                  throw new Error('API 回應格式異常');
              }
          } catch(e) {
              console.error('[Background] retranslateImage failed:', e);
              sendResponse({ success: false, error: e.message });
          }
      })();
      return true;
  }

  if (message.action === 'retranslateText') {
      const { text, mangaKey } = message;
      (async () => {
          try {
              const modelName = await state.get('modelName', 'gemini-1.5-flash');
              let prompt = await state.get('customPrompt', Constants.DEFAULT_PROMPT_TWO_STEP);
              if (modelName.toLowerCase().includes('gemma')) prompt = Constants.DEFAULT_PROMPT_GEMMA_ONE_STEP;
              let glossarySnippet = '';
              if (mangaKey) {
                  const gl = await loadGlossary(mangaKey);
                  if (gl?.terms) glossarySnippet = buildGlossaryPromptSnippet(gl.terms);
              }
              const texts = text.split('\n\n').filter(t => t.trim());
              const result = await translateTexts(texts, {
                  model: modelName,
                  prompt,
                  glossarySnippet,
                  schema: {
                      type: 'OBJECT',
                      properties: {
                          results: {
                              type: 'ARRAY',
                              items: {
                                  type: 'OBJECT',
                                  properties: {
                                      original: { type: 'STRING' },
                                      translation: { type: 'STRING' }
                                  },
                                  required: ['original', 'translation']
                              }
                          }
                      },
                      required: ['results']
                  }
              });
              if (result?.results) {
                  sendResponse({ results: result.results });
              } else {
                  throw new Error('API 回應格式異常');
              }
          } catch(e) {
              console.error('[Background] retranslateText failed:', e);
              sendResponse({ success: false, error: e.message });
          }
      })();
      return true;
  }

  if (message.action === 'navigateAndTranslate') {
      const { url, tabId } = message;
      if (!url || !tabId) { sendResponse({ status: 'error' }); return false; }
      chrome.tabs.update(tabId, { url }, () => {
          if (chrome.runtime.lastError) {
              console.warn('[Background] navigateAndTranslate failed:', chrome.runtime.lastError.message);
          }
      });
      sendResponse({ status: 'navigating' });
      return false;
  }

  if (message.action === 'MOBILE_CRAWL_IMAGES') {
      const { sourceTabId } = message.payload;
      chrome.tabs.sendMessage(sourceTabId, { action: 'crawlImages' }, (response) => {
          if (chrome.runtime.lastError) {
              log.error('Background', `Mobile crawl failed: ${chrome.runtime.lastError.message}`);
              sendResponse({ images: [] });
          } else {
              sendResponse({ images: response?.images || [] });
          }
      });
      return true; // 非同步
  }

  if (message.action === 'START_MANGA_BATCH_MOBILE_MODE') {
      const { sourceTabId, images } = message.payload;
      const mobileTabId = sender.tab?.id;
      if (mobileTabId) {
          processMangaBatchPCMode(sourceTabId, mobileTabId, images);
      }
      sendResponse({ status: 'ok' });
      return false;
  }

  return false;
});


async function cropImageBase64(fullBase64, rect) {
    if (!fullBase64) throw new Error("No base64 image provided");
    const res = await fetch(fullBase64);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(rect.width, rect.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    const croppedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    
    // ArrayBuffer to Base64 (Safe for Service Workers)
    const arrayBuffer = await croppedBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function handleProcessScreenshot(rect, tabId) {
    try {
        if (!capturedScreenshotForSelection) {
            throw new Error("截圖資料遺失，請重新框選");
        }
        
        // 1. 裁切圖片取得 base64 (不含 data:image/jpeg;base64, 前綴)
        const croppedBase64 = await cropImageBase64(capturedScreenshotForSelection, rect);
        
        // 2. 獲取翻譯設定與詞庫
        const modelName = await state.get('modelName', 'gemini-1.5-flash');
        const customPrompt = await state.get('customPrompt', 'Translate to Traditional Chinese.');
        const mangaKey = navigationContext[tabId];
        let glossarySnippet = '';
        if (mangaKey) {
            const currentGlossary = await loadGlossary(mangaKey);
            if (currentGlossary && currentGlossary.terms) {
                glossarySnippet = buildGlossaryPromptSnippet(currentGlossary.terms);
            }
        }

        // 3. 呼叫翻譯 (一條龍 Vison 模式)
        // 關鍵修正：對齊黃金 Prompt 格式要求
        let finalPrompt = customPrompt;
        if (modelName.toLowerCase().includes('gemma')) {
            finalPrompt = Constants.DEFAULT_PROMPT_GEMMA_ONE_STEP;
        }

        const result = await translateTexts([], {
            model: modelName,
            prompt: finalPrompt,
            glossarySnippet: glossarySnippet,
            imageBase64: croppedBase64,
            schema: {
                type: 'OBJECT',
                properties: {
                    results: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                original: { type: 'STRING' },
                                translation: { type: 'STRING' }
                            },
                            required: ['original', 'translation']
                        }
                    }
                },
                required: ['results']
            }
        });

        if (result && result.results) {
            return { success: true, result: result };
        } else {
            throw new Error("API 請求成功但無回傳文字");
        }
    } catch (err) {
        console.error("[ProcessScreenshot] 處理過程發生錯誤:", err);
        return { success: false, error: err.message };
    }
}

// PC 模式的專屬翻譯處理器 (並行版本 - 使用 Semaphore 控制並發數)
async function processMangaBatchPCMode(sourceTabId, resultTabId, images) {
    // 1. 通知閱讀器清空舊結果並準備開始
    chrome.tabs.sendMessage(resultTabId, { action: 'clearResults' });

    // 2. 初始化進度條
    chrome.tabs.sendMessage(resultTabId, {
        action: 'updateProgress',
        current: 0,
        total: images.length
    });

    // 3. 讀取翻譯設定（在並行前統一讀取，避免重複 I/O）
    const modelName = await state.get('modelName', 'gemini-1.5-flash');
    const fallbackModelName = await state.get('fallbackModelName', 'gemini-1.5-pro');
    const customPrompt = await state.get('customPrompt', Constants.DEFAULT_PROMPT_ONE_STEP);
    let finalPrompt = customPrompt;
    if (modelName.toLowerCase().includes('gemma')) {
        finalPrompt = Constants.DEFAULT_PROMPT_GEMMA_ONE_STEP;
    }
    log.info('Background', `翻譯設定讀取完成 — 主要模型: ${modelName}，備援模型: ${fallbackModelName}`);

    // ── 語彙庫初始化與注入 (遵循 V1.8.6 邏輯) ──
    let glossarySnippet = '';
    let currentMangaKey = navigationContext[sourceTabId];
    let currentDisplayName = currentMangaKey;

    try {
        // 如果執行當下沒有 Key，嘗試從 Tab 標題重新解析 (自癒邏輯)
        if (!currentMangaKey && sourceTabId && sourceTabId !== 'current') {
            const tabInfo = await chrome.tabs.get(sourceTabId);
            const titleResult = extractMangaTitle(tabInfo.title || '');
            if (titleResult) {
                currentMangaKey = titleResult.romanKey;
                currentDisplayName = titleResult.displayName;
                navigationContext[sourceTabId] = currentMangaKey;
                log.info('Glossary', `PC 模式啟動時自動辨識作品: ${currentDisplayName}`);
            }
        }

        if (currentMangaKey) {
            const entry = await loadGlossary(currentMangaKey);
            // 比照 V1.8.6：若是新作品，先建立基礎詞庫存檔
            if (!entry) {
                await saveGlossary(currentMangaKey, {
                    displayName: currentDisplayName || currentMangaKey,
                    terms: []
                });
                log.info('Glossary', `為新作品 "${currentMangaKey}" 建立初始詞庫`);
            } else {
                currentDisplayName = entry.displayName || currentMangaKey;
                if (entry.terms && entry.terms.length > 0) {
                    glossarySnippet = buildGlossaryPromptSnippet(entry.terms);
                    log.info('Glossary', `套用詞庫 "${currentMangaKey}"，共 ${entry.terms.length} 筆術語`);
                }
            }
            
            // 通知側邊欄識別成功 (確保 UI 狀態同步)
            chrome.runtime.sendMessage({
                action: 'TITLE_DETECTED',
                payload: { romanKey: currentMangaKey, displayName: currentDisplayName }
            }).catch(() => {});
        }
    } catch (glossaryErr) {
        log.warn('Glossary', `初始化階段發生錯誤，將以無詞庫狀態繼續: ${glossaryErr.message}`);
    }

    // 4. 讀取批次大小設定 (遵循 V1.8.6：Gemma 強制逐張，其他用使用者設定)
    const isGemmaMode = modelName.toLowerCase().includes('gemma');
    const ocrBatchSizeSetting = await state.get('ocrBatchSize', 5);
    const batchSize = isGemmaMode ? 1 : (parseInt(ocrBatchSizeSetting) || 1);
    const requestDelay = await state.get('requestDelay', 4000);
    // Bug #4 修復：確保 state 已完成初始化後再讀取 apiKeys 池長度，
    // 避免 SW 冷啟動時 apiKeys 為空陣列導致並行度恒等於 1
    if (!state.isInitialized) await state.init();
    const concurrency = Math.max(1, state.apiKeys.length);

    log.info('Background', `開始批次翻譯：共 ${images.length} 張，批次大小=${batchSize}，備援並行度=${concurrency}`);

    let completedCount = 0;
    let allBatchResults = [];

    // 5. 主迴圈：依 batchSize 切塊，逐批處理
    for (let i = 0; i < images.length; i += batchSize) {
        // Kill-Switch：若結果頁已關閉，終止
        try {
            await chrome.tabs.get(resultTabId);
        } catch (e) {
            log.info('Background', '結果頁面已關閉，中止批次任務。');
            break;
        }

        const currentBatch = images.slice(i, i + batchSize);
        const totalBatches = Math.ceil(images.length / batchSize);
        const currentBatchIndex = Math.floor(i / batchSize) + 1;

        // 進度顯示
        const progressText = batchSize > 1
            ? `第 ${currentBatchIndex} / ${totalBatches} 批 (圖片 ${i + 1}~${Math.min(i + batchSize, images.length)})`
            : `${i + 1} / ${images.length}`;
        chrome.tabs.sendMessage(resultTabId, { action: 'updateProgress', current: progressText, total: images.length });

        // 並行抓取本批圖片 Base64
        const base64Results = await Promise.all(currentBatch.map(async (imgData) => {
            const imgSrc = imgData.src || imgData;
            if (imgSrc.startsWith('data:image')) return imgSrc.split(',')[1];
            try {
                const res = await fetch(imgSrc);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const ab = await res.arrayBuffer();
                const bytes = new Uint8Array(ab);
                let binary = '';
                for (let b = 0; b < bytes.byteLength; b++) binary += String.fromCharCode(bytes[b]);
                return btoa(binary);
            } catch (fetchErr) {
                // 退回 Content Script 備援
                log.warn('Background', `圖片直接抓取失敗，退回 Content Script: ${fetchErr.message}`);
                if (sourceTabId && sourceTabId !== 'current') {
                    const resp = await Promise.race([
                        new Promise(resolve => chrome.tabs.sendMessage(sourceTabId, { action: 'fetchBase64', url: imgSrc }, resolve)),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
                    ]).catch(e => ({ error: e.message }));
                    return resp?.base64 || null;
                }
                return null;
            }
        }));

        // 分離有效/無效圖片
        const validItems = base64Results
            .map((b64, idx) => ({ b64, originalIdx: idx }))
            .filter(item => typeof item.b64 === 'string' && item.b64);

        const allPageResults = Array(currentBatch.length).fill(null);
        base64Results.forEach((r, idx) => {
            if (!r || typeof r !== 'string') allPageResults[idx] = { error: '圖片載入失敗' };
        });

        if (validItems.length > 0) {
            try {
                if (batchSize > 1) {
                    // ── 批次路徑：多圖打包成一個 API 請求 ──
                    // 請求大小監管：若總 Base64 長度超過 15MB，拆分為兩個子批次
                    const PAYLOAD_LIMIT = 15_000_000;
                    const totalPayload = validItems.reduce((sum, v) => sum + v.b64.length, 0);
                    const subBatches = totalPayload > PAYLOAD_LIMIT
                        ? [validItems.slice(0, Math.ceil(validItems.length / 2)), validItems.slice(Math.ceil(validItems.length / 2))]
                        : [validItems];

                    if (subBatches.length > 1) {
                        log.warn('Background', `[批次] 請求體過大 (${Math.round(totalPayload / 1_000_000)}MB)，自動拆分為 ${subBatches.length} 個子批次。`);
                    }

                    for (const subBatch of subBatches) {
                        log.info('Background', `[批次] 打包 ${subBatch.length} 張圖送出 API...`);
                        const subResults = await callGeminiAPIBatch(
                            subBatch.map(v => v.b64),
                            finalPrompt,
                            glossarySnippet
                        );
                        subBatch.forEach((item, k) => {
                            allPageResults[item.originalIdx] = subResults[k] || { error: '批次結果不足' };
                        });
                    }
                } else {
                    // ── 逐張路徑 (batchSize=1) ──
                    const item = validItems[0];
                    if (item) {
                        const result = await translateTexts([], {
                            model: modelName,
                            fallbackModel: fallbackModelName,
                            prompt: finalPrompt,
                            glossarySnippet,
                            imageBase64: item.b64,
                            schema: {
                                type: 'OBJECT',
                                properties: { results: { type: 'ARRAY', items: { type: 'OBJECT', properties: { original: { type: 'STRING' }, translation: { type: 'STRING' } }, required: ['original', 'translation'] } } },
                                required: ['results']
                            }
                        });
                        allPageResults[item.originalIdx] = result;
                    }
                }
            } catch (batchErr) {
                // 批次失敗備援：並行逐張翻譯 (Semaphore 已於頂層靜態匯入)
                log.warn('Background', `[批次] 批次處理失敗，啟動備援並行逐張翻譯 (並行度: ${concurrency}): ${batchErr.message}`);
                const fallbackSemaphore = new Semaphore(concurrency);
                const fallbackResults = new Array(validItems.length).fill(null);

                await Promise.all(validItems.map(async (item, k) => {
                    await fallbackSemaphore.acquire();
                    try {
                        const result = await translateTexts([], {
                            model: modelName,
                            fallbackModel: fallbackModelName,
                            prompt: finalPrompt,
                            glossarySnippet,
                            imageBase64: item.b64,
                            schema: {
                                type: 'OBJECT',
                                properties: { results: { type: 'ARRAY', items: { type: 'OBJECT', properties: { original: { type: 'STRING' }, translation: { type: 'STRING' } }, required: ['original', 'translation'] } } },
                                required: ['results']
                            }
                        });
                        fallbackResults[k] = result;
                    } catch (singleErr) {
                        log.warn('Background', `[備援] 第 ${item.originalIdx + 1} 張翻譯失敗: ${singleErr.message}`);
                        fallbackResults[k] = { error: singleErr.message };
                    } finally {
                        fallbackSemaphore.release();
                    }
                }));

                validItems.forEach((item, k) => {
                    allPageResults[item.originalIdx] = fallbackResults[k] || { error: '備援翻譯結果缺失' };
                });
            }
        }

        // 回傳本批結果給 UI
        for (let j = 0; j < currentBatch.length; j++) {
            const imgData = currentBatch[j];
            const imgSrc = imgData.src || imgData;
            const res = allPageResults[j];
            completedCount++;

            if (!res || res.error) {
                chrome.tabs.sendMessage(resultTabId, {
                    action: 'appendResult',
                    data: { image: imgSrc, error: res?.error || '翻譯失敗或無回應' }
                });
            } else {
                allBatchResults.push(...(res.results || []));
                chrome.tabs.sendMessage(resultTabId, {
                    action: 'appendResult',
                    data: { image: imgSrc, results: res.results, usedModelName: modelName }
                });
            }
        }

        // 批次間延遲
        const finalDelay = batchSize > 1 ? requestDelay * 1.5 : requestDelay;
        if (i + batchSize < images.length) {
            await new Promise(r => setTimeout(r, finalDelay));
        }
    }

    // ── 異步術語萃取 (遵循 V1.8.6) ──
    if (currentMangaKey && allBatchResults.length > 0) {
        log.info('Background', `[術語萃取] 開始分析漫畫譯文，共 ${allBatchResults.length} 組對話...`);
        setTimeout(async () => {
            try {
                const newTerms = await extractTermsFromTranslation(allBatchResults, { model: modelName });
                if (newTerms && newTerms.length > 0) {
                    const currentEntry = await loadGlossary(currentMangaKey) || { terms: [] };
                    const { terms: mergedTerms, addedCount } = mergeGlossaryTerms(currentEntry.terms || [], newTerms);
                    if (addedCount > 0) {
                        await saveGlossary(currentMangaKey, {
                            displayName: currentDisplayName || currentMangaKey,
                            terms: mergedTerms
                        });
                        log.info('Background', `[術語萃取] 作品 "${currentMangaKey}" 新增 ${addedCount} 筆術語。`);
                    } else {
                        log.info('Background', `[術語萃取] 分析完成，無新增術語。`);
                    }
                }
            } catch (err) {
                log.warn('Background', `[術語萃取] 發生錯誤: ${err.message}`);
            }
        }, 1500);
    }

    chrome.tabs.sendMessage(resultTabId, { action: 'batchComplete' });
}


// 監聽分頁更新：標題解析與小說續傳
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  // 1. 智慧標題辨識
  const pageTitle = tab.title || '';
  const titleResult = extractMangaTitle(pageTitle);
  if (titleResult) {
    navigationContext[tabId] = titleResult.romanKey;
    log.info('Background', `偵測到作品標題: ${titleResult.displayName} (Key: ${titleResult.romanKey})`);
    
    // 通知 UI 標題已識別 (供 UI 顯示當前作品)
    chrome.runtime.sendMessage({
      action: 'TITLE_DETECTED',
      payload: titleResult
    }).catch(() => {});
  }

  // 2. 小說自動續傳
  const novelModeEnabled = await state.get('novelModeEnabled', false);
  if (!novelModeEnabled) return;

  const currentUrl = tab.url || '';
  if (lastNovelUrlByTab[tabId] === currentUrl) return; // 防止重複觸發
  
  lastNovelUrlByTab[tabId] = currentUrl;
  log.info('Background', `偵測到小說頁面跳轉（分頁 ${tabId}），觸發自動翻譯...`);
  
  // 延遲一點點確保 DOM 穩定
  setTimeout(() => {
    chrome.tabs.sendMessage(tabId, { action: 'AUTO_TRANSLATE_PAGE' })
      .catch(err => log.warn('Background', `Auto-translate signal failed: ${err.message}`));
  }, 1200);
});

async function handleAddToQueue(task) {
    // 使用原子化更新，確保不會覆蓋並發的任務
    await state.update('novelQueue', (currentQueue = []) => {
        return [...currentQueue, task];
    });
    log.info('Background', '任務已原子化新增至儲存佇列');
}

// 側邊欄與行動端點擊行為設定
if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
  // 電腦版：使用 SidePanel
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.warn('[Background] sidePanel.setPanelBehavior failed:', error));
} else {
  // 行動版備援：監聽點擊，開啟行動端頁面
  chrome.action.onClicked.addListener((tab) => {
    log.info('Background', `[行動端] 偵測到點擊，來源分頁: ${tab.id}，開啟行動端頁面`);
    const mobileUrl = chrome.runtime.getURL('src/mobile/index.html') + '?sourceTabId=' + tab.id;
    chrome.tabs.create({ url: mobileUrl });
  });
}

