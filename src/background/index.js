import { state } from '../utils/state.js';
import * as Constants from '../utils/constants.js';
import { extractMangaTitle } from '../utils/manga-utils.js';
import { loadGlossary, saveGlossary, mergeGlossaryTerms, buildGlossaryPromptSnippet, deleteGlossaryTerm, deleteGlossary, updateGlossaryDisplayName, importGlossaryTerms, deleteMultipleGlossaryTerms } from './glossary-manager.js';
import { translateTexts, extractTermsFromTranslation, callGeminiAPIBatch } from './translate-api.js';
import { log } from '../utils/logger.js';
import { Semaphore, KeyRateLimiter } from '../utils/concurrency.js';

let capturedScreenshotForSelection = null;
// 記錄每個分頁最後的小說網址，防止 onUpdated 重複觸發自動翻譯
// 注意：此為記憶體變數，SW 重啟後清空屬正常行為
const lastNovelUrlByTab = {};


log.info('Background', '漫譯 V2 背景服務程式已啟動');

// 當 Service Worker 啟動或重啟時，初次化狀態
state.init().then(async () => {
    log.info('Background', '狀態載入完成，檢查待處理任務...');
    await state.set('isStopping', false); // 重置停止狀態

    
    // 範例：檢查是否有遺留的小說翻譯任務
    const queue = await state.get('novelQueue', []);
    if (queue.length > 0) {
        log.warn('Background', `偵測到 ${queue.length} 個小說待處理任務，準備恢復...`);
        // 這裡未來會啟動 processNovelQueue()
    }
});

// 同步本地鎖，解決 chrome.storage 非同步造成的 race condition
let _localNovelProcessingLock = false;

// 真正的翻譯處理循環
async function processNovelQueue() {
    if (_localNovelProcessingLock) return;
    _localNovelProcessingLock = true;

    // 仍需更新 storage 以便讓 UI 知道狀態
    await state.set('isProcessingNovel', true);
    
    try {
        while (true) {
            const rawQueue = await state.get('novelQueue', []);
            const queue = Array.isArray(rawQueue) ? rawQueue : Object.values(rawQueue || {});
            
            if (queue.length === 0) break;
            
            // 檢查是否中斷
            if (await state.get('isStopping')) {
                log.warn('Background', '小說翻譯任務已被強制停止');
                break;
            }

            const task = queue.shift();
            await state.set('novelQueue', queue);

            // 標題與作品 Key 識別
            const navCtx = await state.get('navigationContext', {});
            let mangaKey = navCtx[task.tabId];
            if (!mangaKey && task.tabId) {
                try {
                    const tabInfo = await chrome.tabs.get(task.tabId);
                    const titleResult = extractMangaTitle(tabInfo.title || '');
                    if (titleResult) {
                        mangaKey = titleResult.romanKey;
                        navCtx[task.tabId] = mangaKey;
                        await state.set('navigationContext', navCtx);
                    }
                } catch (e) {}
            }

            let glossarySnippet = '';
            let currentDisplayName = mangaKey;
            if (mangaKey) {
                const entry = await loadGlossary(mangaKey);
                if (!entry) {
                    // 比照漫畫模式：建立初始存檔
                    await saveGlossary(mangaKey, { displayName: mangaKey, terms: [] });
                    log.info('Glossary', `為新小說作品 "${mangaKey}" 建立初始詞庫`);
                } else {
                    currentDisplayName = entry.displayName || mangaKey;
                    if (entry.terms && entry.terms.length > 0) {
                        glossarySnippet = buildGlossaryPromptSnippet(entry.terms);
                        log.info('Glossary', `套用小說詞庫 "${currentDisplayName}"，共 ${entry.terms.length} 筆術語`);
                    }
                }
            }

            // 讀取小說專用設定
            const modelName = await state.get('novelModelName', 'gemini-1.5-flash');
            const fallbackModelName = await state.get('fallbackModelName', 'gemini-1.5-flash');
            const novelPrompt = await state.get('novelPrompt', '');
            const batchSize = parseInt(await state.get('novelBatchSize', 50)) || 50;
            const requestDelay = await state.get('requestDelay', 3000);

            const allTranslatedResults = []; // 用於結尾萃取

            // 批次翻譯模式
            for (let i = 0; i < task.texts.length; i += batchSize) {
                const batch = task.texts.slice(i, i + batchSize).filter(t => t && t.trim());
                if (batch.length === 0) continue;

                try {
                    log.info('Background', `[小說批次] 翻譯第 ${i + 1}~${Math.min(i + batchSize, task.texts.length)} 段（共 ${task.texts.length} 段）`);

                    // 【修正 1】提早更新進度
                    await state.setThrottled('novelProgress', {
                        status: `[批次處理] 正在翻譯第 ${i + 1} ~ ${Math.min(i + batchSize, task.texts.length)} 段，請稍候...`
                    }, 0); 

                    // 【V1.8.6 移植】為傳送文本加上索引前綴 [N]，強化模型對位
                    const indexedTexts = batch.map((t, idx) => `[${idx}] ${t}`);

                    // 強制要求 JSON 結構化輸出 (Response Schema)
                    const schema = {
                        type: 'OBJECT',
                        properties: {
                            translations: { 
                                type: 'ARRAY', 
                                items: { 
                                    type: 'OBJECT',
                                    properties: {
                                        index: { type: 'INTEGER' },
                                        text: { type: 'STRING' }
                                    },
                                    required: ['index', 'text']
                                }
                            }
                        },
                        required: ['translations']
                    };

                    const finalPrompt = (novelPrompt || '你是一位專業的翻譯師，將日文翻譯為繁體中文。') + 
                        '\n請嚴格遵守 1:1 對位，輸出 JSON 必須包含 index (0-based) 與 text (譯文)。';

                    const result = await translateTexts(indexedTexts, { 
                        model: modelName,
                        fallbackModel: fallbackModelName,
                        prompt: finalPrompt,
                        schema: schema, 
                        glossarySnippet
                    }); 

                    // 解析結果
                    let translations = [];
                    if (result && result.translations) {
                        const sorted = result.translations.sort((a, b) => a.index - b.index);
                        translations = sorted.map(item => item.text);
                    } else if (Array.isArray(result)) {
                        translations = result;
                    }
                    
                    if (translations.length === 0) throw new Error('翻譯結果為空或格式錯誤'); 

                    // 逐條寫入結果
                    for (let k = 0; k < batch.length; k++) {
                        const translation = translations[k] || '（翻譯失敗）';
                        const resultItem = {
                            tabId: task.tabId,
                            idx: task.startIndex + i + k,
                            original: batch[k],
                            translation: translation
                        };
                        allTranslatedResults.push({ original: batch[k], translation: translation });
                        await state.update('novelResults', (current = []) => [...current, resultItem]);
                    }

                    // 批次完成後再次更新進度
                    await state.setThrottled('novelProgress', {
                        status: `已完成第 ${Math.min(i + batchSize, task.texts.length)} / ${task.texts.length} 段`
                    }, 0);

                    if (i + batchSize < task.texts.length) {
                        await new Promise(r => setTimeout(r, requestDelay));
                    }
                } catch (batchErr) {
                    log.error('Background', `批次翻譯失敗 (第 ${i + 1} 批):`, batchErr);
                }
            }

            // ── 異步術語萃取 (與漫畫模式對齊) ──
            if (mangaKey && allTranslatedResults.length > 0) {
                log.info('Background', `[小說萃取] 開始分析小說譯文，提取關鍵術語...`);
                setTimeout(async () => {
                    try {
                        const newTerms = await extractTermsFromTranslation(allTranslatedResults, { model: modelName });
                        if (newTerms && newTerms.length > 0) {
                            const currentEntry = await loadGlossary(mangaKey) || { terms: [] };
                            const { terms: mergedTerms, addedCount } = mergeGlossaryTerms(currentEntry.terms || [], newTerms);
                            if (addedCount > 0) {
                                await saveGlossary(mangaKey, {
                                    displayName: currentDisplayName || mangaKey,
                                    terms: mergedTerms
                                });
                                log.info('Background', `[小說萃取] 作品 "${mangaKey}" 自動新增 ${addedCount} 筆術語。`);
                            }
                        }
                    } catch (err) {
                        log.warn('Background', `[小說萃取] 發生錯誤: ${err.message}`);
                    }
                }, 1000);
            }
        }
    } catch (globalErr) {
        log.error('Background', '小說隊列處理異常:', globalErr);
        await state.set('novelProgress', { status: `[系統錯誤] ${globalErr.message}` });
        await new Promise(r => setTimeout(r, 5000));
    } finally {
        _localNovelProcessingLock = false;
        await state.set('isProcessingNovel', false);
        await state.set('novelProgress', null);
    }
}

// 監聽訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log.info('Messenger', `收到訊息: ${message.action}`, { tabId: sender.tab?.id });

  if (message.action === 'PING') {
    sendResponse({ status: 'PONG', version: '2.0.0' });
  }

  if (message.action === 'STOP_TRANSLATION') {

      state.set('isStopping', true);
      log.warn('Background', '收到停止指令，正在中斷所有任務...');
      sendResponse({ status: 'stopping' });
      return false;
  }
  
  if (message.action === 'ADD_TO_QUEUE') {
    const payload = message.payload;
    if (!payload.tabId && sender.tab) payload.tabId = sender.tab.id;
    if (payload.navLinks) {
        state.get('navLinksStore', {}).then(store => {
            store[payload.tabId] = payload.navLinks;
            state.set('navLinksStore', store);
        });
    }
    
    // Bug #1 修復：重置停止旗標，防止前次按停止後小說無法再次翻譯
    state.set('isStopping', false);
    state.set('isBatchPaused', false);
    
    // 將任務加入全域佇列
    state.get('novelQueue', []).then(queue => {
        const currentQueue = Array.isArray(queue) ? queue : Object.values(queue || {});
        currentQueue.push(payload);
        return state.set('novelQueue', currentQueue);
    }).then(() => {
        processNovelQueue(); // 啟動處理器
    }).catch(err => log.error('Background', 'Queue update failed:', err));
    
    sendResponse({ status: 'queued' });
    return false; // 同步回應
  }

  if (message.action === 'START_MANGA_BATCH_PC_MODE') {
      let { tabId, images, mobile, navLinks } = message.payload;
      if (!tabId && sender.tab) tabId = sender.tab.id;
      

      state.set('isStopping', false);
      
      // 紀錄導航連結
      if (navLinks) {
          state.get('navLinksStore', {}).then(store => {
              store[tabId] = navLinks;
              state.set('navLinksStore', store);
          });
      }
      // 行動端來源時加上 mobile=1 參數，讓結果頁知道要啟用行動閱讀器模式
      const mobileParam = mobile ? '&mobile=1' : '';
      // 儲存 payload，等 result.html 的 resultPageReady 訊號再開始翻譯
      chrome.storage.local.set({ mt_batch_payload: { tabId, images } }, () => {
          chrome.tabs.create({ url: chrome.runtime.getURL('src/reader/result.html') + '?tabId=' + tabId + mobileParam }, (tab) => {
              state.get('pendingBatchJobs', {}).then(jobs => {
                  // 同步儲存 navLinks，供 resultPageReady 時傳給 processMangaBatchPCMode
                  jobs[tab.id] = { sourceTabId: tabId, images, navLinks: navLinks || null };
                  state.set('pendingBatchJobs', jobs);
                  setTimeout(() => {
                      state.get('pendingBatchJobs', {}).then(jobs2 => {
                          delete jobs2[tab.id];
                          state.set('pendingBatchJobs', jobs2);
                      });
                  }, 60000);
              });
          });
      });
      sendResponse({ status: 'ok' });
      return false;
  }

  // 行動端專用：開啟行動版翻譯分頁
  if (message.action === 'OPEN_MOBILE_PANEL') {
      const sourceTabId = sender.tab.id;
      const mobileUrl = chrome.runtime.getURL('src/mobile/index.html') + '?sourceTabId=' + sourceTabId;
      chrome.tabs.create({ url: mobileUrl });
      sendResponse({ status: 'ok' });
      return false;
  }

  if (message.action === 'resultPageReady') {
      const resultTabId = sender.tab?.id;
      if (resultTabId) {
          state.get('pendingBatchJobs', {}).then(jobs => {
              if (jobs[resultTabId]) {
                  const { sourceTabId, images, navLinks } = jobs[resultTabId];
                  delete jobs[resultTabId];
                  state.set('pendingBatchJobs', jobs);
                  // 將 navLinks 一起傳給翻譯處理器
                  processMangaBatchPCMode(sourceTabId, resultTabId, images, navLinks);
              }
          });
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
      (async () => {
          const navCtx = await state.get('navigationContext', {});
          const navStore = await state.get('navLinksStore', {});
          const mangaKey = navCtx[sourceTabId] || null;
          const navLinks = navStore[sourceTabId] || { prev: null, next: null };
          let displayName = null;
          if (mangaKey) {
              try {
                  const glossary = await loadGlossary(mangaKey);
                  displayName = glossary?.displayName || mangaKey;
              } catch(e) {}
          }
          sendResponse({ navLinks, mangaKey, displayName });
      })();
      return true;
  }

  if (message.action === 'getTabMangaKey') {
      const tabId = message.tabId || sender.tab?.id;
      (async () => {
          const navCtx = await state.get('navigationContext', {});
          sendResponse({ mangaKey: navCtx[tabId] || null });
      })();
      return true;
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

  if (message.action === 'deleteGlossaryTerm') {
      const { mangaKey, ori } = message;
      if (!mangaKey || !ori) { sendResponse({ success: false, error: '缺少必要欄位' }); return false; }
      deleteGlossaryTerm(mangaKey, ori).then(res => sendResponse(res));
      return true;
  }

  if (message.action === 'deleteMultipleGlossaryTerms') {
      const { mangaKey, oris } = message;
      if (!mangaKey || !oris) { sendResponse({ success: false, error: '缺少必要欄位' }); return false; }
      deleteMultipleGlossaryTerms(mangaKey, oris).then(res => sendResponse(res));
      return true;
  }

  if (message.action === 'deleteGlossary') {
      const { mangaKey } = message;
      if (!mangaKey) { sendResponse({ success: false, error: '缺少必要欄位' }); return false; }
      deleteGlossary(mangaKey).then(res => sendResponse(res));
      return true;
  }

  if (message.action === 'updateGlossaryDisplayName') {
      const { mangaKey, newDisplayName } = message;
      if (!mangaKey || !newDisplayName) { sendResponse({ success: false, error: '缺少必要欄位' }); return false; }
      updateGlossaryDisplayName(mangaKey, newDisplayName).then(res => sendResponse(res));
      return true;
  }

  if (message.action === 'importGlossaryTerms') {
      const { mangaKey, terms } = message;
      if (!mangaKey || !terms) { sendResponse({ success: false, error: '缺少必要欄位' }); return false; }
      importGlossaryTerms(mangaKey, terms).then(res => sendResponse(res));
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
              const fallbackModelName = await state.get('fallbackModelName', 'gemini-1.5-flash');
              let finalPrompt = await state.get('customPrompt', Constants.DEFAULT_PROMPT_ONE_STEP);
              
              // 救援行動強制使用備援模型
              const usedModel = fallbackModelName || modelName;
              if (usedModel.toLowerCase().includes('gemma')) {
                  finalPrompt = Constants.DEFAULT_PROMPT_GEMMA_ONE_STEP;
              }
              
              let glossarySnippet = '';
              if (mangaKey) {
                  const gl = await loadGlossary(mangaKey);
                  if (gl?.terms) glossarySnippet = buildGlossaryPromptSnippet(gl.terms);
              }
              const result = await translateTexts([], {
                  model: usedModel,
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
                  // 修復 Bug #3：優先採用 translateTexts 回傳的 usedModelName（已由 translate-api.js 注入），
                  // 若為舊版未含該欄位則 fallback 至本次實際使用的 usedModel
                  sendResponse({ results: result.results, usedModelName: result.usedModelName || usedModel });
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
              const fallbackModelName = await state.get('fallbackModelName', 'gemini-1.5-flash');
              let prompt = await state.get('customPrompt', Constants.DEFAULT_PROMPT_TWO_STEP);
              
              // 救援行動強制使用備援模型
              const usedModel = fallbackModelName || modelName;
              if (usedModel.toLowerCase().includes('gemma')) {
                  prompt = Constants.DEFAULT_PROMPT_GEMMA_ONE_STEP;
              }
              
              let glossarySnippet = '';
              if (mangaKey) {
                  const gl = await loadGlossary(mangaKey);
                  if (gl?.terms) glossarySnippet = buildGlossaryPromptSnippet(gl.terms);
              }
              const texts = text.split('\n\n').filter(t => t.trim());
              const result = await translateTexts(texts, {
                  model: usedModel,
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

  if (message.action === 'retranslateNovelParagraph') {
      const { text, mangaKey } = message;
      (async () => {
          try {
              const model = await state.get('novelModelName', 'gemini-1.5-flash');
              const prompt = await state.get('novelPrompt', Constants.DEFAULT_PROMPT_NOVEL);
              
              let glossarySnippet = '';
              if (mangaKey) {
                  const gl = await loadGlossary(mangaKey);
                  if (gl?.terms) glossarySnippet = buildGlossaryPromptSnippet(gl.terms);
              }
              
              const result = await translateTexts([text], {
                  model: model,
                  prompt: prompt,
                  glossarySnippet: glossarySnippet,
                  schema: {
                      type: 'OBJECT',
                      properties: {
                          results: {
                              type: 'ARRAY',
                              items: { type: 'STRING' }
                          }
                      },
                      required: ['results']
                  }
              });
              
              if (result?.results && result.results[0]) {
                  sendResponse({ success: true, translation: result.results[0] });
              } else {
                  throw new Error('API 回應格式異常');
              }
          } catch(e) {
              console.error('[Background] retranslateNovelParagraph failed:', e);
              sendResponse({ success: false, error: e.message });
          }
      })();
      return true;
  }

  if (message.action === 'navigateAndTranslate') {
      const { url, tabId, mangaKey } = message;
      if (!url || !tabId) { sendResponse({ status: 'error' }); return false; }
      // 儲存 resultTabId（發送訊息的分頁），讓 onUpdated 知道要通知哪個結果頁
      const resultTabId = sender.tab?.id || null;
      state.set('pendingAutoTranslate', { tabId, resultTabId, mangaKey: mangaKey || null }).then(() => {
          chrome.tabs.update(tabId, { url }, () => {
              if (chrome.runtime.lastError) {
                  console.warn('[Background] navigateAndTranslate failed:', chrome.runtime.lastError.message);
              }
          });
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
      const { sourceTabId, images, navLinks } = message.payload;
      const mobileTabId = sender.tab?.id;
      if (mobileTabId) {
          processMangaBatchPCMode(sourceTabId, mobileTabId, images, navLinks || null);
      }
      sendResponse({ status: 'ok' });
      return false;
  }

  // ── P0 移植：prepareTab — 確保 Content Script 已注入（對齊 v1.8.7） ──
  if (message.action === 'prepareTab') {
      const targetTabId = message.tabId || sender.tab?.id;
      ensureContentScriptInjected(targetTabId).then(ready => {
          sendResponse({ ready });
      }).catch(() => sendResponse({ ready: false }));
      return true; // 非同步
  }

  // ── P0 移植：toggleBatchPause — 批次翻譯暫停/繼續（對齊 v1.8.7） ──
  if (message.action === 'toggleBatchPause') {
      state.get('isBatchPaused', false).then(currentPaused => {
          const newPaused = !currentPaused;
          state.set('isBatchPaused', newPaused).then(() => {
              log.info('Background', `批次翻譯狀態: ${newPaused ? '暫停' : '繼續'}`);
              sendResponse({ status: newPaused ? 'paused' : 'running' });
          });
      });
      return true; // 非同步
  }


  // ── P0 移植：abortNovelTranslation / setNovelMode / getNovelModeState — 小説翻譯控制（對齊 v1.8.7） ──
  if (message.action === 'abortNovelTranslation') {
      const targetTabId = message.tabId || sender.tab?.id;
      log.info('Background', `[Novel] 中止分頁 ${targetTabId} 的小説翻譯任務`);
      // 对此分頁的 content script 發送中止指令
      chrome.tabs.sendMessage(targetTabId, { action: 'abortNovelTranslation' }).catch(() => {});
      sendResponse({ ok: true });
      return false;
  }

  // ── P1 移植：getDailyTokenCount — API 配額顯示（對齊 v1.8.7） ──
  if (message.action === 'getDailyTokenCount') {
      state.get('usageDate', '').then(async savedDate => {
          const today = new Date().toISOString().split('T')[0];
          if (savedDate !== today) {
              await state.set('usageDate', today);
              await state.set('usageCount', 0);
              sendResponse({ count: 0 });
          } else {
              const count = await state.get('usageCount', 0);
              sendResponse({ count });
          }
      }).catch(() => sendResponse({ count: 0 }));
      return true; // 非同步
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
        const navCtx = await state.get('navigationContext', {});
        const mangaKey = navCtx[tabId];
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

/**
 * openNewResultPage — 開一個新的結果頁並儲存 pendingBatchJobs
 * 供 navigateAndTranslate 的 fallback（結果頁已關閉時）使用
 */
function openNewResultPage(sourceTabId, images, navLinks, mangaKey) {
    const mobileParam = '&mobile=0';
    chrome.tabs.create({
        url: chrome.runtime.getURL('src/reader/result.html') + `?tabId=${sourceTabId}${mobileParam}`
    }, (resultTab) => {
        if (chrome.runtime.lastError || !resultTab) {
            log.warn('Background', 'openNewResultPage: 無法建立結果頁');
            return;
        }
        state.get('pendingBatchJobs', {}).then(jobs => {
            jobs[resultTab.id] = { sourceTabId, images, navLinks: navLinks || null, mangaKey: mangaKey || null };
            state.set('pendingBatchJobs', jobs);
            setTimeout(() => {
                state.get('pendingBatchJobs', {}).then(jobs2 => {
                    delete jobs2[resultTab.id];
                    state.set('pendingBatchJobs', jobs2);
                });
            }, 60000);
        });
    });
}

// PC 模式的專屬翻譯處理器 (並行版本 - 使用 Semaphore 控制並發數)
async function processMangaBatchPCMode(sourceTabId, resultTabId, images, navLinks = null) {
    // 輔助函式：廣播狀態給行動端來源分頁的日誌面板
    const broadcastStatus = (msg, type = 'info') => {
        if (!sourceTabId) return;
        chrome.tabs.sendMessage(sourceTabId, {
            action: 'TRANSLATION_STATUS',
            payload: { msg, type }
        }).catch(() => {});
    };

    // 1. 通知閱讀器清空舊結果並準備開始
    chrome.tabs.sendMessage(resultTabId, { action: 'clearResults' });
    broadcastStatus(`🚀 開始翻譯 ${images.length} 張圖片...`, 'info');

    // 2. 初始化進度條
    chrome.tabs.sendMessage(resultTabId, {
        action: 'updateProgress',
        current: 0,
        total: images.length
    });

    // 3. 讀取翻譯設定（在並行前統一讀取，避免重複 I/O）
    const modelName = await state.get('modelName', 'gemini-1.5-flash');
    const fallbackModelName = await state.get('fallbackModelName', null);
    const customPrompt = await state.get('customPrompt', Constants.DEFAULT_PROMPT_ONE_STEP);
    let finalPrompt = customPrompt;
    if (modelName.toLowerCase().includes('gemma')) {
        finalPrompt = Constants.DEFAULT_PROMPT_GEMMA_ONE_STEP;
    }
    log.info('Background', `翻譯設定讀取完成 — 主要模型: ${modelName}，備援模型: ${fallbackModelName}`);

    // ── 語彙庫初始化與注入 (遵循 V1.8.6 邏輯) ──
    let glossarySnippet = '';
    const navCtx = await state.get('navigationContext', {});
    let currentMangaKey = navCtx[sourceTabId];
    let currentDisplayName = currentMangaKey;

    try {
        // 如果執行當下沒有 Key，嘗試從 Tab 標題重新解析 (自癒邏輯)
        if (!currentMangaKey && sourceTabId && sourceTabId !== 'current') {
            const tabInfo = await chrome.tabs.get(sourceTabId);
            const titleResult = extractMangaTitle(tabInfo.title || '');
            if (titleResult) {
                currentMangaKey = titleResult.romanKey;
                currentDisplayName = titleResult.displayName;
                navCtx[sourceTabId] = currentMangaKey;
                await state.set('navigationContext', navCtx);
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

    // ── 傳送導航連結給結果頁（對齊 v1.8.7 的 setNavigation 邏輯）──
    // 若呼叫方未提供 navLinks，嘗試從 navLinksStore 中補救
    let resolvedNavLinks = navLinks;
    if (!resolvedNavLinks) {
        try {
            const navStore = await state.get('navLinksStore', {});
            resolvedNavLinks = navStore[sourceTabId] || null;
        } catch(_) {}
    }
    // [Debug] 顯示導航連結實際內容，方便診斷
    log.info('Background', `[NavDebug] sourceTabId=${sourceTabId}, navLinks 傳入=${JSON.stringify(navLinks)}, navStore 補救=${JSON.stringify(resolvedNavLinks)}`);
    if (resolvedNavLinks && (resolvedNavLinks.prev || resolvedNavLinks.next)) {
        // 稍等 500ms 確保結果頁 DOM 已準備好
        setTimeout(() => {
            chrome.tabs.sendMessage(resultTabId, {
                action: 'setNavigation',
                navLinks: resolvedNavLinks
            });
        }, 500);
        log.info('Background', `導航連結已送出: prev=${resolvedNavLinks.prev ? '✓' : '✗'}, next=${resolvedNavLinks.next ? '✓' : '✗'}`);
    } else {
        log.warn('Background', '無導航連結可用，上/下一話按鈕將不顯示');
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

        // 檢查是否停止
        if (await state.get('isStopping')) {
            log.warn('Background', '漫畫翻譯任務已被強制停止');
            break;
        }

        // 暫停輪詢（對齊 v1.8.7 toggleBatchPause 功能）
        while (await state.get('isBatchPaused', false)) {
            // 暫停中，每 500ms 檢查一次是否已繼續
            await new Promise(r => setTimeout(r, 500));
            // 暫停期間如果也收到 isStopping，一並結束
            if (await state.get('isStopping')) break;
        }

        // 進度顯示
        const progressText = batchSize > 1
            ? `第 ${currentBatchIndex} / ${totalBatches} 批 (圖片 ${i + 1}~${Math.min(i + batchSize, images.length)})`
            : `${i + 1} / ${images.length}`;
        chrome.tabs.sendMessage(resultTabId, { action: 'updateProgress', current: progressText, total: images.length });
        broadcastStatus(`⏳ 正在處理 ${progressText}...`, 'info');

        // 並行抓取本批圖片 Base64
        const base64Results = await Promise.all(currentBatch.map(async (imgData) => {
            const imgSrc = imgData.src || imgData;
            if (imgSrc.startsWith('data:image')) return imgSrc.split(',')[1];
            try {
                // 加入 10 秒逾時機制，防止 fetch 無限期掛起
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                
                const res = await fetch(imgSrc, { signal: controller.signal });
                clearTimeout(timeoutId);
                
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const ab = await res.arrayBuffer();
                const bytes = new Uint8Array(ab);
                let binary = '';
                for (let b = 0; b < bytes.byteLength; b++) binary += String.fromCharCode(bytes[b]);
                return btoa(binary);
            } catch (fetchErr) {
                // 退回 Content Script 備援
                log.warn('Background', `圖片直接抓取失敗，退回 Content Script: ${fetchErr.message}`);
                broadcastStatus(`⚠️ 圖片抓取逾時或失敗，嘗試透過網頁端抓取...`, 'warn');
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
                    // 使用者的等待時間在此套用
                    if (i > 0 && requestDelay > 0) {
                        await new Promise(r => setTimeout(r, requestDelay));
                    }
                    
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
                // 批次失敗備援：並行逐張翻譯
                log.warn('Background', `[批次] 批次處理失敗，啟動備援並行逐張翻譯 (Key 數量: ${state.apiKeys.length}): ${batchErr.message}`);
                broadcastStatus(`❌ 批次失敗: ${batchErr.message.slice(0, 40)}... 啟動備援機制`, 'err');
                
                // 【核心變更】使用 KeyRateLimiter 實現「每 Key 獨立冷卻」 (已改為靜態匯入)
                const limiter = new KeyRateLimiter(state.apiKeys, requestDelay);
                const fallbackResults = new Array(validItems.length).fill(null);

                await Promise.all(validItems.map(async (item, k) => {
                    const apiKey = await limiter.acquireKey(); // 取得冷卻完畢的 Key
                    try {
                        // 檢查是否中斷
                        if (await state.get('isStopping')) return;

                        const result = await translateTexts([], {
                            model: fallbackModelName,
                            apiKey: apiKey, // 指定該 Key
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
                        broadcastStatus(`第 ${item.originalIdx + 1} 張備援翻譯成功`, 'ok');
                    } catch (singleErr) {
                        log.warn('Background', `[備援] 第 ${item.originalIdx + 1} 張翻譯失敗 (Key: ${state.getApiKeyAlias(apiKey)}): ${singleErr.message}`);
                        broadcastStatus(`❌ 第 ${item.originalIdx + 1} 張備援失敗: ${singleErr.message.slice(0, 30)}`, 'err');
                        fallbackResults[k] = { error: singleErr.message };
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
                broadcastStatus(`❌ 第 ${completedCount} 張翻譯失敗: ${res?.error || '無回應'}`, 'error');
                chrome.tabs.sendMessage(resultTabId, {
                    action: 'appendResult',
                    data: { image: imgSrc, error: res?.error || '翻譯失敗或無回應' }
                });
            } else {
                allBatchResults.push(...(res.results || []));
                chrome.tabs.sendMessage(resultTabId, {
                    action: 'appendResult',
                    data: { 
                        image: imgSrc, 
                        results: res.results, 
                        usedModelName: res.usedModelName || modelName 
                    }
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
    // [DEBUG] 診斷用 log：確認萃取觸發條件
    log.info('Background', `[術語萃取-DEBUG] currentMangaKey = "${currentMangaKey}" | allBatchResults.length = ${allBatchResults.length}`);
    if (allBatchResults.length > 0) {
        log.info('Background', `[術語萃取-DEBUG] allBatchResults 第一筆格式樣本: ${JSON.stringify(allBatchResults[0])}`);
    }

    if (currentMangaKey && allBatchResults.length > 0) {
        log.info('Background', `[術語萃取] 開始分析漫畫譯文，共 ${allBatchResults.length} 組對話...`);
        setTimeout(async () => {
            try {
                const newTerms = await extractTermsFromTranslation(allBatchResults, { model: modelName });
                // [DEBUG] 確認 AI 回傳了什麼
                log.info('Background', `[術語萃取-DEBUG] AI 回傳術語數量: ${newTerms?.length ?? 0} | 內容: ${JSON.stringify(newTerms?.slice(0, 3))}`);
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
    } else {
        // [DEBUG] 明確說明為何跳過萃取
        if (!currentMangaKey) log.warn('Background', `[術語萃取-DEBUG] ⛔ 跳過萃取：currentMangaKey 為空，作品標題可能無法被辨識。`);
        if (allBatchResults.length === 0) log.warn('Background', `[術語萃取-DEBUG] ⛔ 跳過萃取：allBatchResults 為空，翻譯結果可能格式錯誤。`);
    }

    chrome.tabs.sendMessage(resultTabId, { action: 'batchComplete' });
    broadcastStatus(`✅ 全部 ${images.length} 張翻譯完成！請查看結果頁。`, 'success');
    // 廣播任務完成，讓 Sidepanel 恢復開始按鈕
    chrome.runtime.sendMessage({ action: 'TRANSLATION_DONE' }).catch(() => {});
    // 修復 Bug #矛盾2：任務完成後重置為 false，而非設為 true
    // UI 端收到 batchComplete 後自行隱藏停止按鈕，不依賴 isStopping 旗標
    await state.set('isStopping', false);
}


// 監聽分頁更新：標題解析與小說續傳
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  // [P1] 檢查是否為跳轉後自動翻譯
  const pendingAuto = await state.get('pendingAutoTranslate', null);
  if (pendingAuto && pendingAuto.tabId === tabId) {
      log.info('Background', `偵測到跳轉完成，啟動自動翻譯: ${tabId}`);
      await state.set('pendingAutoTranslate', null);
      const { resultTabId, mangaKey } = pendingAuto;
      // 等待 DOM 穩定後再抓取圖片
      setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { action: 'crawlImages' }, (response) => {
              if (chrome.runtime.lastError) {
                  log.warn('Background', `自動跳轉抓圖失敗: ${chrome.runtime.lastError.message}`);
                  return;
              }
              if (response && response.images && response.images.length > 0) {
                  state.set('isStopping', false);
                  const images = response.images;
                  const navLinks = response.navLinks || { prev: null, next: null };

                  // 【對齊 v1.8.7】如果有原來的結果頁 resultTabId，直接向它發送重新載入訊謟
                  if (resultTabId) {
                      chrome.tabs.get(resultTabId, (resultTab) => {
                          if (chrome.runtime.lastError || !resultTab) {
                              // 結果頁已關閉，開新頁
                              log.warn('Background', '結果頁已關閉，開新頁據結果頁');
                              openNewResultPage(tabId, images, navLinks, mangaKey);
                              return;
                          }
                          // 結果頁還在！將它移到前台並發送重載訊謟
                          chrome.tabs.update(resultTabId, { active: true });
                          chrome.tabs.sendMessage(resultTabId, {
                              action: 'reloadAndTranslate',
                              sourceTabId: tabId,
                              images: images,
                              navLinks: navLinks,
                              mangaKey: mangaKey || null
                          }, (res) => {
                              if (chrome.runtime.lastError) {
                                  log.warn('Background', '結果頁無回應，改開新頁');
                                  openNewResultPage(tabId, images, navLinks, mangaKey);
                              } else {
                                  // 結果頁正在自踽啊，啟動翻譯任務
                                  processMangaBatchPCMode(tabId, resultTabId, images, navLinks);
                              }
                          });
                      });
                  } else {
                      openNewResultPage(tabId, images, navLinks, mangaKey);
                  }
              } else {
                  log.warn('Background', '自動跳轉後未找到圖片');
              }
          });
      }, 2000);
  }

  // 1. 智慧標題辨識
  const pageTitle = tab.title || '';
  const titleResult = extractMangaTitle(pageTitle);
  if (titleResult) {
    const navCtx = await state.get('navigationContext', {});
    navCtx[tabId] = titleResult.romanKey;
    await state.set('navigationContext', navCtx);
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
    await state.update('novelQueue', (currentQueue) => {
        // chrome.storage 有時會把陣列反序列化成 {0: item, 1: item} 的物件
        // 必須強制轉回陣列才能正確 spread
        const safeQueue = Array.isArray(currentQueue) 
            ? currentQueue 
            : Object.values(currentQueue || {});
        return [...safeQueue, task];
    });
    log.info('Background', '任務已原子化新增至儲存佇列');
}

// 注意：擴充套件的點擊行為（開啟側邊欄 / 行動版）已改由 src/popup/index.html 統一處理。
// manifest.json 的 action.default_popup 確保在所有平台（電腦 / 行動端）點擊圖示時都會顯示 Popup。
// Popup 內部的按鈕邏輯：
//   - "開啟翻譯面板"  → chrome.sidePanel.open() （電腦版有效，行動端降級顯示提示）
//   - "開啟設定"     → chrome.runtime.openOptionsPage() （兩個平台都有效）

// 右鍵選單：提供額外的「設定」快速入口
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-options',
    title: '⚙️ 設定 (Options)',
    contexts: ['action']
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-options') {
    chrome.runtime.openOptionsPage();
  }
});


/**
 * ensureContentScriptInjected — 確保 Content Script 已在目標分頁中快行
 * 對齊 v1.8.7 的相同函式，用於 prepareTab 與 setNovelMode handler
 * @param {number} tabId 
 * @returns {Promise<boolean>} 是否就緒
 */
async function ensureContentScriptInjected(tabId) {
    try {
        // 1. 先嘗試 Ping — 若成功表示已就緒
        await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        log.info('Background', `[PrepareTab] 分頁 ${tabId} 已具備環境`);
        return true;
    } catch {
        // 2. Ping 失敗，嘗試重新注入
        log.warn('Background', `[PrepareTab] 分頁 ${tabId} 連線失效，嘗試重新注入 Content Script...`);
        try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab.url || !tab.url.startsWith('http')) {
                log.warn('Background', '[PrepareTab] 非網頁分頁，無法注入腳本');
                return false;
            }
            // 注入 CSS 與 JS — V2 的 content scripts 是動態縮紮到 dist 中，需透過 manifest 路徑導入
            const scripts = (await chrome.scripting.getRegisteredContentScripts()).map(s => s.js).flat();
            if (scripts.length > 0) {
                await chrome.scripting.executeScript({ target: { tabId }, files: scripts.slice(0, 1) });
            } else {
                // Fallback: 嘗試透過 scripting API 導入主要 content entry
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => { window.__mt_injected = true; }
                });
            }
            log.info('Background', `[PrepareTab] 分頁 ${tabId} 環境重新注入成功`);
            return true;
        } catch (injectErr) {
            log.error('Background', `[PrepareTab] 環境注入失敗: ${injectErr.message}`);
            return false;
        }
    }
}

/**
 * 更新每日翻譯次數統計（用於 getDailyTokenCount 配額顯示）
 * 在每張圖片翻譯完成後呼叫此函式
 */
async function incrementDailyUsage() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const savedDate = await state.get('usageDate', '');
        if (savedDate !== today) {
            await state.set('usageDate', today);
            await state.set('usageCount', 1);
        } else {
            const count = await state.get('usageCount', 0);
            await state.set('usageCount', count + 1);
        }
        // 廣播更新給 Sidepanel
        const newCount = await state.get('usageCount', 0);
        chrome.runtime.sendMessage({ action: 'updateTokenDisplay', count: newCount }).catch(() => {});
    } catch { /* 統計失敗不影響主要功能 */ }
}
