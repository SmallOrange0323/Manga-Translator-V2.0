import { state } from '../utils/state.js';
import * as Constants from '../utils/constants.js';
import { extractMangaTitle } from '../utils/manga-utils.js';
import { loadGlossary, saveGlossary, mergeGlossaryTerms, buildGlossaryPromptSnippet } from './glossary-manager.js';
import { translateTexts, extractTermsFromTranslation } from './translate-api.js';
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
        const mangaKey = navigationContext[task.tabId];
        let glossarySnippet = '';
        let currentGlossary = null;

        if (mangaKey) {
            currentGlossary = await loadGlossary(mangaKey);
            if (currentGlossary && currentGlossary.terms) {
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
                
                const translatedText = result?.translations?.[0]?.text || result?.[0] || '（翻譯失敗）';
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

    // 注入作品詞庫（並行前統一讀取）
    let glossarySnippet = '';
    const currentMangaKey = navigationContext[sourceTabId];
    if (currentMangaKey) {
        const gl = await loadGlossary(currentMangaKey);
        if (gl?.terms) glossarySnippet = buildGlossaryPromptSnippet(gl.terms);
    }

    // 4. 建立 Semaphore，並行數 = API Key 數量（至少 1）
    const concurrency = Math.max(1, state.apiKeys?.length || 1);
    const semaphore = new Semaphore(concurrency);
    log.info('Background', `開始並行翻譯：共 ${images.length} 張圖，並行數=${concurrency}，主要模型=${modelName}，備援模型=${fallbackModelName}`);

    // 共用進度計數器
    let completedCount = 0;
    // Kill-Switch 旗標：若結果頁面關閉，設為 true 中斷所有待執行任務
    let aborted = false;

    // 5. 為每張圖建立任務工廠，並透過 semaphore 並行執行
    const taskFactories = images.map((imgData, idx) => async () => {
        // Kill-Switch 檢查：若已中斷，直接拋錯跳過
        if (aborted) {
            throw new Error('Batch aborted: result tab closed');
        }

        // 檢查結果頁面是否還存在
        try {
            await chrome.tabs.get(resultTabId);
        } catch (e) {
            aborted = true;
            log.info('Background', '結果頁面已關閉，中止剩餘任務。');
            throw new Error('Result tab closed');
        }

        const imgSrc = imgData.src || imgData;
        let base64 = null;

        // 取得圖片 Base64
        if (imgSrc.startsWith('data:image')) {
            base64 = imgSrc.split(',')[1];
        } else {
            try {
                // 首選：Background 直接抓取（繞過 CORS）
                const res = await fetch(imgSrc);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const arrayBuffer = await res.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                for (let b = 0; b < bytes.byteLength; b++) {
                    binary += String.fromCharCode(bytes[b]);
                }
                base64 = btoa(binary);
            } catch (backgroundFetchErr) {
                // 備案：退回 Content Script 抓取
                log.warn('Background', `圖片[${idx}] 直接抓取失敗，退回 Content Script。錯誤: ${backgroundFetchErr.message}`);
                if (sourceTabId && sourceTabId !== 'current') {
                    const response = await Promise.race([
                        new Promise(resolve => {
                            chrome.tabs.sendMessage(sourceTabId, { action: 'fetchBase64', url: imgSrc }, resolve);
                        }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
                    ]).catch(err => ({ error: err.message }));
                    base64 = response?.base64;
                }
            }
        }

        if (!base64) {
            chrome.tabs.sendMessage(resultTabId, {
                action: 'appendResult',
                data: { image: imgSrc, error: '無法取得圖片 Base64' }
            });
            return;
        }

        // 呼叫翻譯 API（傳入備援模型，確保失敗時自動切換）
        const result = await translateTexts([], {
            model: modelName,
            fallbackModel: fallbackModelName,
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

        // 更新進度
        completedCount++;
        chrome.tabs.sendMessage(resultTabId, {
            action: 'updateProgress',
            current: completedCount,
            total: images.length
        });

        if (result && result.results) {
            chrome.tabs.sendMessage(resultTabId, {
                action: 'appendResult',
                data: {
                    image: imgSrc,
                    results: result.results,
                    usedModelName: modelName
                }
            });
        } else {
            chrome.tabs.sendMessage(resultTabId, {
                action: 'appendResult',
                data: { image: imgSrc, error: '翻譯失敗或無回應' }
            });
        }
    });

    // 6. 執行所有任務
    const outcomes = await semaphore.runAll(taskFactories);
    const errorCount = outcomes.filter(o => o.error && !o.error.message.includes('aborted') && !o.error.message.includes('Result tab closed')).length;
    if (errorCount > 0) {
        log.warn('Background', `批次翻譯完成，${errorCount} 張圖片失敗。`);
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

// 側邊欄行為設定
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

