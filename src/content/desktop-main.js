import { state } from '../utils/state.js';
import { getNovelParagraphs, insertPlaceholders, injectTranslation } from './novel-engine.js';
import { toggleSelectionMode, crawlImages } from './manga-engine.js';
import { log } from '../utils/logger.js';

/**
 * 啟動電腦版專用 UI 系統
 */
export function initDesktopMode() {
  log.info('Content-Desktop', 'Initializing Desktop Mode...');

  // 連動狀態機：自動更新畫面翻譯結果
  state.onChanged((changes) => {
    if (changes.novelResults) {
        const results = changes.novelResults.newValue;
        if (results && results.length > 0) {
            const lastResult = results[results.length - 1];
            if (!lastResult.isManga) {
                injectTranslation(lastResult.idx, lastResult.translation, lastResult.failed);
            }
        }
    }
  });

  // 監聽背景訊息 (電腦版專屬)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translateNovelPage' || request.action === 'AUTO_TRANSLATE_PAGE') {
        log.info('Content-Desktop', `收到 ${request.action} 訊息，準備啟動翻譯`);
        try {
            startNovelTranslation();
            sendResponse({ started: true });
        } catch (e) {
            log.error('Content-Desktop', 'startNovelTranslation 發生錯誤:', e);
            sendResponse({ started: false, error: e.message });
        }
    }

    if (request.action === 'crawlImages') {
        const results = crawlImages();
        sendResponse({ 
            images: results.images, 
            navLinks: results.navLinks 
        });
    }

    if (request.action === 'fetchBase64') {
        handleBase64Fetch(request.url, sendResponse);
        return true; 
    }

    if (request.action === 'toggleSelectionMode') {
        chrome.runtime.sendMessage({ action: 'PRE_CAPTURE_FOR_SELECTION' }, (response) => {
            log.info('Content-Desktop', 'Pre-capture response received', response);
            toggleSelectionMode();
        });
        sendResponse({ started: true });
    }

    if (request.action === 'TITLE_DETECTED') {
        log.info('Content-Desktop', `當前作品已識別：${request.payload.displayName}`);
    }

    if (request.action === 'ping') {
        sendResponse({ pong: true });
    }
  });

  log.info('Content-Desktop', 'Desktop Mode initialized.');
}

function handleBase64Fetch(url, sendResponse) {
    if (!/^(https?:|blob:|data:)/i.test(url)) {
        sendResponse({ error: "Blocked: unsupported URL protocol" });
        return;
    }
    fetch(url)
        .then(res => res.blob())
        .then(blob => {
            const reader = new FileReader();
            reader.onloadend = () => sendResponse({ base64: reader.result.split(',')[1] });
            reader.onerror = () => sendResponse({ error: "FileReader failed" });
            reader.readAsDataURL(blob);
        })
        .catch(err => sendResponse({ error: err.message }));
}

function startNovelTranslation() {
    log.info('Content-Desktop', '執行 startNovelTranslation...');
    const paragraphs = getNovelParagraphs();
    log.info('Content-Desktop', `找到 ${paragraphs.length} 個段落`);
    if (paragraphs.length === 0) return;
    
    insertPlaceholders(paragraphs);
    log.info('Content-Desktop', '佔位符插入完成');
    
    chrome.storage.local.remove('novelResults');
    // Bug #2 修復：先 clone 段落並移除 .mt-novel-trans，防止重譯時把中文譯文一起送給 AI
    const texts = paragraphs.map(p => {
        const clone = p.cloneNode(true);
        const trans = clone.querySelector('.mt-novel-trans');
        if (trans) trans.remove();
        return clone.textContent.trim();
    });
    
    log.info('Content-Desktop', `準備發送 ADD_TO_QUEUE 訊息，texts 數量: ${texts.length}`);
    chrome.runtime.sendMessage({
        action: 'ADD_TO_QUEUE',
        payload: {
            tabId: null,
            startIndex: 0,
            texts: texts
        }
    }, (response) => {
        if (chrome.runtime.lastError) {
            log.error('Content-Desktop', 'ADD_TO_QUEUE 失敗:', chrome.runtime.lastError.message);
        } else {
            log.info('Content-Desktop', 'ADD_TO_QUEUE 成功:', response);
        }
    });
}
