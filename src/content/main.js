import { state } from '../utils/state.js';
import { getNovelParagraphs, insertPlaceholders, injectTranslation } from './novel-engine.js';
import { toggleSelectionMode, crawlImages } from './manga-engine.js';

/**
 * 啟動 UI 系統 (僅保留必要的無干擾邏輯)
 */
function setupUI() {
  // 連動狀態機：自動更新畫面翻譯結果
  state.onChanged((changes) => {
    if (changes.novelResults) {
        const results = changes.novelResults.newValue;
        if (results && results.length > 0) {
            const lastResult = results[results.length - 1];
            // 小說模式直接注入
            if (!lastResult.isManga) {
                injectTranslation(lastResult.idx, lastResult.translation);
            }
        }
    }
  });

  // 監聽背景訊息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translateNovelPage' || request.action === 'AUTO_TRANSLATE_PAGE') {
        startNovelTranslation();
        sendResponse({ started: true });
    }

    if (request.action === 'crawlImages') {
        const images = crawlImages();
        sendResponse({ images });
    }

    if (request.action === 'fetchBase64') {
        if (!/^(https?:|blob:|data:)/i.test(request.url)) {
            sendResponse({ error: "Blocked: unsupported URL protocol" });
            return false;
        }
        fetch(request.url)
            .then(res => res.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => sendResponse({ base64: reader.result.split(',')[1] });
                reader.onerror = () => sendResponse({ error: "FileReader failed" });
                reader.readAsDataURL(blob);
            })
            .catch(err => {
                sendResponse({ error: err.message });
            });
        return true; 
    }

    if (request.action === 'toggleSelectionMode') {
        // Edge 穩定化修復：進入框選模式前先發起預先截圖
        chrome.runtime.sendMessage({ action: 'PRE_CAPTURE_FOR_SELECTION' }, (response) => {
            console.log('[Content] Pre-capture response:', response);
            toggleSelectionMode(); // 呼叫 manga-engine
        });
        sendResponse({ started: true });
    }


    if (request.action === 'TITLE_DETECTED') {
        const title = request.payload;
        console.log(`[Content] 當前作品：${title.displayName}`);
    }
    if (request.action === 'GLOSSARY_UPDATED') {
        const { termCount } = request.payload;
        console.log(`[Content] 詞庫已同步：${termCount} 個術語`);
    }
  });
}

/**
 * 啟動小說翻譯流程 (外殼->核心)
 */
function startNovelTranslation() {
    const paragraphs = getNovelParagraphs();
    if (paragraphs.length === 0) return;

    insertPlaceholders(paragraphs);

    // 清空舊結果，避免跨頁面的 idx 污染
    chrome.storage.local.remove('novelResults');

    const texts = paragraphs.map(p => p.textContent.trim());

    // 取得真實 tabId，讓 Background 能正確查詢 navigationContext
    // 注意：在內容腳本中 sender.tab.id 是由背景腳本自動獲取的，
    // 但明確傳遞 null 並由背景腳本處理也是一種修正方式。
    // 依循指南：我們將 tabId 設為 null，背景腳本收到後會自動填補 sender.tab.id。
    chrome.runtime.sendMessage({
        action: 'ADD_TO_QUEUE',
        payload: {
            tabId: null, // 背景腳本會自動補上 sender.tab.id
            startIndex: 0,
            texts: texts
        }
    });
}

// 在網頁載入後啟動
if (document.readyState === 'complete') {
  setupUI();
} else {
  window.addEventListener('load', setupUI);
}
