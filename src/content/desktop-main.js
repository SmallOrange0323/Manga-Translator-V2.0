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
                injectTranslation(lastResult.idx, lastResult.translation);
            }
        }
    }
  });

  // 監聽背景訊息 (電腦版專屬)
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
    const paragraphs = getNovelParagraphs();
    if (paragraphs.length === 0) return;
    insertPlaceholders(paragraphs);
    chrome.storage.local.remove('novelResults');
    const texts = paragraphs.map(p => p.textContent.trim());
    chrome.runtime.sendMessage({
        action: 'ADD_TO_QUEUE',
        payload: {
            tabId: null,
            startIndex: 0,
            texts: texts
        }
    });
}
