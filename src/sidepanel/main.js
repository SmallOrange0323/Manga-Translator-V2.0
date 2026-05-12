import { state } from '../utils/state.js';
import { extractMangaTitle } from '../utils/manga-utils.js';
import { LOADING_GIF_FILENAME } from '../utils/constants.js';

console.log('[Manga Translator V2] Classic Sidepanel Initialized');

// 載入動畫元素
const loadingOverlay = document.getElementById('mt-loading-overlay');
const loadingImg = document.getElementById('mt-loading-gif');
if (loadingImg) loadingImg.src = chrome.runtime.getURL(LOADING_GIF_FILENAME);

// 詞庫狀態列相關元素
const glossaryBar = document.getElementById('mt-glossary-bar');
const glossaryNameEl = document.getElementById('mt-glossary-name');
const glossaryCountEl = document.getElementById('mt-glossary-count');
const manageBtn = document.getElementById('mt-manage-glossary-btn');

let currentMangaKey = null;

/**
 * 刷新側邊欄的作品詞庫狀態
 */
async function refreshGlossaryStatus() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.title) {
            glossaryBar.style.display = 'none';
            return;
        }

        const titleResult = extractMangaTitle(tab.title);
        if (titleResult) {
            currentMangaKey = titleResult.romanKey;
            glossaryBar.style.display = 'flex';
            glossaryNameEl.textContent = titleResult.displayName;
            glossaryNameEl.title = titleResult.displayName;

            // 向背景請求詳情
            chrome.runtime.sendMessage({ 
                action: 'GET_GLOSSARY_INFO', 
                payload: { mangaKey: currentMangaKey } 
            }, (response) => {
                if (response && response.success) {
                    glossaryCountEl.textContent = `${response.termCount} 詞`;
                }
            });
        } else {
            glossaryBar.style.display = 'none';
        }
    } catch (err) {
        console.warn('[Sidepanel] Failed to refresh glossary status:', err);
    }
}

// 監聽背景廣播的事件
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'TITLE_DETECTED') {
        const title = request.payload;
        glossaryBar.style.display = 'flex';
        glossaryNameEl.textContent = title.displayName;
        currentMangaKey = title.romanKey;
        // 觸發重新抓取數量
        refreshGlossaryStatus();
    }

    if (request.action === 'GLOSSARY_UPDATED') {
        const { mangaKey, termCount } = request.payload;
        if (mangaKey === currentMangaKey) {
            glossaryCountEl.textContent = `${termCount} 詞`;
        }
    }
});

// 監聽分頁切換
chrome.tabs.onActivated.addListener(() => {
    // 稍微延遲確保 tab 資訊已更新
    setTimeout(refreshGlossaryStatus, 300);
});

// 管理按鈕：打開選項頁並定位到詞庫區塊 (未來可強化定位)
manageBtn.onclick = () => {
    chrome.runtime.openOptionsPage();
};

const themeToggle = document.getElementById('mt-theme-toggle');
const body = document.body;

// 初始化主題
state.get('theme', 'theme-umamusume').then(theme => {
    body.className = theme;
});

// 主題切換邏輯
themeToggle.onclick = async () => {
    const currentTheme = body.className;
    const nextTheme = currentTheme === 'theme-umamusume' ? 'theme-priconne' : 'theme-umamusume';
    body.className = nextTheme;
    await state.set('theme', nextTheme);
    console.log('[Sidepanel] Theme switched to:', nextTheme);
};

// 訂閱狀態更新 (響應式 UI)
state.onChanged((changes) => {
    if (changes.usageCount || changes.usageTotal) {
        updateQuotaUI();
    }
    
    if (changes.novelProgress) {
        updateNovelStatus(changes.novelProgress.newValue);
    }

        if (changes.isStopping) {
            const stopBtn = document.getElementById('mt-stop-btn');
            const startBtn = document.getElementById('mt-start-btn');
            const pauseBtn = document.getElementById('mt-pause-btn');
            if (changes.isStopping.newValue === true) {
                // isStopping = true 代表使用者主動按了停止
                if (stopBtn) stopBtn.style.display = 'none';
                if (startBtn) startBtn.style.display = 'flex';
                if (pauseBtn) pauseBtn.style.display = 'none';
            }
            // isStopping = false 代表任務完成或新任務開始，不在此處理
        }
});

// 監聽 batchComplete 訊息恢復 UI 狀態
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'TRANSLATION_DONE') {
        const stopBtn = document.getElementById('mt-stop-btn');
        const startBtn = document.getElementById('mt-start-btn');
        const pauseBtn = document.getElementById('mt-pause-btn');
        if (stopBtn) stopBtn.style.display = 'none';
        if (startBtn) startBtn.style.display = 'flex';
        if (pauseBtn) { pauseBtn.style.display = 'none'; pauseBtn.textContent = '⏸️ 暫停'; pauseBtn.classList.remove('is-paused'); }
    }
    // P1 移植：配額即時更新（對齊 v1.8.7 updateTokenDisplay）
    if (request.action === 'updateTokenDisplay') {
        state.get('usageTotal', 1000).then(total => {
            const count = request.count || 0;
            const percent = Math.min(100, (count / total) * 100);
            const countEl = document.getElementById('mt-quota-count');
            const fillEl = document.getElementById('mt-quota-bar-fill');
            if (countEl) countEl.textContent = `${count} / ${total}`;
            if (fillEl) fillEl.style.width = `${percent}%`;
        });
    }
});

async function updateQuotaUI() {
    const count = await state.get('usageCount', 0);
    const total = await state.get('usageTotal', 1000); // 預設 1000
    const percent = Math.min(100, (count / total) * 100);
    
    document.getElementById('mt-quota-count').textContent = `${count} / ${total}`;
    document.getElementById('mt-quota-bar-fill').style.width = `${percent}%`;
}

function updateNovelStatus(progress) {
    const statusEl = document.getElementById('mt-novel-status');
    const progressContainer = document.getElementById('mt-novel-progress-container');
    const progressText = document.getElementById('mt-novel-progress-text');
    const progressFill = document.getElementById('mt-novel-progress-fill');

    if (progress && progress.status) {
        statusEl.style.display = 'inline';
        statusEl.textContent = '(小說中)';
        
        if (progressContainer && progressText && progressFill) {
            progressContainer.style.display = 'block';
            progressText.textContent = progress.status;
            
            if (progress.current && progress.total) {
                const percent = Math.round((progress.current / progress.total) * 100);
                progressFill.style.width = `${percent}%`;
            }
        }
    } else {
        statusEl.style.display = 'none';
        if (progressContainer) {
            progressContainer.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
        }
    }
}

// 選圖階段暫存變數
let candidateImages = [];
let candidateNavLinks = { prev: null, next: null }; // 同步儲存導航連結

// 綁定按鈕動作
document.getElementById('mt-start-btn').onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (!tabs[0]) return;
        const tabId = tabs[0].id;

        // ── 小說模式分流 ──
        const isNovelMode = await state.get('novelModeEnabled', false);
        if (isNovelMode) {
            // 確保 Content Script 已注入
            chrome.runtime.sendMessage({ action: 'prepareTab', tabId }, (prep) => {
                if (!prep || !prep.ready) {
                    alert('網頁環境啟動失敗。請確認網頁已載入完成，或嘗試手動重整一次網頁。');
                    return;
                }
                // 送出小說翻譯訊號給 Content Script
                chrome.tabs.sendMessage(tabId, { action: 'translateNovelPage' }, (res) => {
                    if (chrome.runtime.lastError) {
                        alert('小說模式啟動失敗：' + chrome.runtime.lastError.message);
                    }
                });
            });
            return; // 小說模式不走後面的漫畫流程
        }

        // ── 漫畫模式（原有邏輯）──
        // 顯示載入動畫
        if (loadingOverlay) loadingOverlay.style.display = 'flex';

        // 「對齊 v1.8.7」先呼叫 prepareTab 確保 Content Script 已注入
        chrome.runtime.sendMessage({ action: 'prepareTab', tabId }, (prep) => {
            if (!prep || !prep.ready) {
                if (loadingOverlay) loadingOverlay.style.display = 'none';
                alert("網頁環境啟動失敗。請確認網頁已載入完成，或嘗試手動重整一次網頁。");
                return;
            }

            let crawlTimeout = setTimeout(() => {
                if (loadingOverlay) loadingOverlay.style.display = 'none';
                alert("揃淨請求無回應。請確認網頁沒有變更位址，或嘗試手動重整。");
            }, 8000);

            chrome.tabs.sendMessage(tabId, { action: "crawlImages" }, (response) => {
                clearTimeout(crawlTimeout);
                if (loadingOverlay) loadingOverlay.style.display = 'none';

                if (chrome.runtime.lastError) {
                    console.error('[Manga][SP] crawlImages 失敗:', chrome.runtime.lastError.message);
                    return;
                }
                if (response && Array.isArray(response.images)) {
                    candidateImages = response.images;
                    // 同步儲存導航連結，用於後續批次翻譯時帶入
                    candidateNavLinks = response.navLinks || { prev: null, next: null };
                    if (candidateImages.length === 0) {
                        alert("未在此網頁找到候選圖片！\n\n小提醒：部分網站需要往下捲動才會載入圖片，請先捲動網頁後再試一次。");
                        return;
                    }
                    renderPreviewList();
                }
            });
        });
    });
};

document.getElementById('mt-stop-btn').onclick = () => {
    chrome.runtime.sendMessage({ action: 'STOP_TRANSLATION' }, (res) => {
        // 同時清除暫停狀態，避免下次翻譯發動前還在暫停狀態
        chrome.runtime.sendMessage({ action: 'toggleBatchPause' }).catch(() => {});
        document.getElementById('mt-stop-btn').style.display = 'none';
        document.getElementById('mt-pause-btn')?.style.setProperty('display', 'none');
        document.getElementById('mt-start-btn').style.display = 'flex';
    });
};

// 暫停/繼續按鈕（對齊 v1.8.7 toggleBatchPause）
const pauseBtn = document.getElementById('mt-pause-btn');
if (pauseBtn) {
    pauseBtn.onclick = () => {
        chrome.runtime.sendMessage({ action: 'toggleBatchPause' }, (res) => {
            if (res?.status === 'paused') {
                pauseBtn.textContent = '▶️ 繼續';
                pauseBtn.classList.add('is-paused');
            } else {
                pauseBtn.textContent = '⏸️ 暫停';
                pauseBtn.classList.remove('is-paused');
            }
        });
    };
}

document.getElementById('mt-options-btn').onclick = () => {
    chrome.runtime.openOptionsPage();
};

document.getElementById('mt-selection-btn').onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleSelectionMode' });
    });
};

const resultsContainer = document.getElementById('mt-results-container');

// ── P0 移植：本地圖片上傳與拖放支援 ──
const uploadBtn = document.getElementById('mt-upload-btn');
const fileInput = document.getElementById('mt-file-input');

if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => fileInput.click();
    
    fileInput.onchange = (e) => {
        handleFiles(e.target.files);
    };
}

function handleFiles(files) {
    if (!files || files.length === 0) return;
    
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    
    const fileArray = Array.from(files);
    const readPromises = fileArray.map(file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve({ src: ev.target.result, name: file.name });
            reader.readAsDataURL(file);
        });
    });
    
    Promise.all(readPromises).then(results => {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        
        // 將讀取的 base64 圖片加入候選清單
        candidateImages = results.map(r => r.src);
        candidateNavLinks = { prev: null, next: null }; // 本地上傳無導航
        
        renderPreviewList();
        // 清空 input 讓同一個檔案可以重複選取
        fileInput.value = '';
    });
}

// 拖放支援
if (resultsContainer) {
    resultsContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        resultsContainer.style.background = 'rgba(106, 90, 211, 0.05)';
        resultsContainer.style.border = '2px dashed var(--theme-accent)';
    });

    resultsContainer.addEventListener('dragleave', () => {
        resultsContainer.style.background = '';
        resultsContainer.style.border = '';
    });

    resultsContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        resultsContainer.style.background = '';
        resultsContainer.style.border = '';
        handleFiles(e.dataTransfer.files);
    });
}

document.getElementById('mt-clear-btn').onclick = () => clearPreviewList();
document.getElementById('mt-back-btn').onclick = () => clearPreviewList();
document.getElementById('mt-select-all-btn').onclick = () => {
    const allCheckboxes = resultsContainer.querySelectorAll('.mt-preview-checkbox');
    const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
    allCheckboxes.forEach(cb => { cb.checked = !allChecked; });
    updateBatchCount();
};

document.getElementById('mt-batch-trans-btn').onclick = () => {
    const selectedCheckboxes = resultsContainer.querySelectorAll('.mt-preview-checkbox:checked');
    const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.index);
    const selectedUrls = selectedIds.map(idx => ({
        id: candidateImages[idx].id || Date.now() + idx,
        src: candidateImages[idx].src || candidateImages[idx]
    }));

    if (selectedUrls.length === 0) {
        alert("請至少選取一張圖片！");
        return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id || 'current';
        // 發送給背景以啟動新分頁
        chrome.runtime.sendMessage({
            action: 'START_MANGA_BATCH_PC_MODE',
            payload: {
                tabId: tabId,
                images: selectedUrls,
                navLinks: candidateNavLinks  // 傳入導航連結，供結果頁顯示上下一話按鈕
            }
        });
        
        // 顯示停止按鈕
        document.getElementById('mt-stop-btn').style.display = 'flex';
        document.getElementById('mt-start-btn').style.display = 'none';
        
        clearPreviewList();
    });
};

function clearPreviewList() {
    resultsContainer.innerHTML = '';
    document.querySelector('.mt-batch-controls').style.display = 'none';
    document.querySelector('.mt-main-actions').style.display = 'flex';
    candidateImages = [];
}

function renderPreviewList() {
    resultsContainer.innerHTML = '';
    document.querySelector('.mt-main-actions').style.display = 'none';
    document.querySelector('.mt-batch-controls').style.display = 'block';

    const listContainer = document.createElement('div');
    listContainer.className = 'mt-preview-list';

    candidateImages.forEach((imgObj, index) => {
        const src = imgObj.src || imgObj;
        const item = document.createElement('div');
        item.className = 'mt-preview-item';
        // 為了簡單化，先不實作完整的 drag and drop 事件
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'mt-preview-checkbox';
        checkbox.checked = true;
        checkbox.dataset.index = index;
        
        const previewImg = document.createElement('img');
        previewImg.className = 'mt-preview-img';
        previewImg.src = src;

        const info = document.createElement('div');
        info.className = 'mt-preview-info';
        info.textContent = `圖片 ${index + 1}`;
        info.style.fontSize = "11px";
        info.style.paddingLeft = "8px";

        item.appendChild(checkbox);
        item.appendChild(previewImg);
        item.appendChild(info);

        item.onclick = (e) => {
            if (e.target !== checkbox && e.target !== previewImg) {
                checkbox.checked = !checkbox.checked;
                updateBatchCount();
            }
        };
        checkbox.onchange = updateBatchCount;

        listContainer.appendChild(item);
    });

    resultsContainer.appendChild(listContainer);
    updateBatchCount();
}

function updateBatchCount() {
    const allCheckboxes = resultsContainer.querySelectorAll('.mt-preview-checkbox');
    const checked = Array.from(allCheckboxes).filter(cb => cb.checked).length;
    
    const transBtn = document.getElementById('mt-batch-trans-btn');
    if (transBtn) {
        transBtn.innerHTML = `翻譯所選 (${checked}張) · 開啟新分頁`;
    }

    const selectAllBtn = document.getElementById('mt-select-all-btn');
    if (selectAllBtn) {
        selectAllBtn.textContent = (checked === allCheckboxes.length && checked > 0) ? '取消全選' : '全選';
    }
}

// =====================================================
// 小說模式 & 詞彙庫 Toggle 初始化與事件綁定
// =====================================================
const novelModeToggle = document.getElementById('mt-novel-mode-toggle');
const globalGlossaryToggle = document.getElementById('mt-global-glossary-toggle');

if (novelModeToggle) {
    state.get('novelModeEnabled', false).then(val => {
        novelModeToggle.checked = !!val;
    });
    novelModeToggle.addEventListener('change', async () => {
        await state.set('novelModeEnabled', novelModeToggle.checked);
        console.log('[Sidepanel] 小說模式:', novelModeToggle.checked ? '開啟' : '關閉');
    });
}

if (globalGlossaryToggle) {
    state.get('globalGlossaryEnabled', true).then(val => {
        globalGlossaryToggle.checked = (val !== false);
    });
    globalGlossaryToggle.addEventListener('change', async () => {
        await state.set('globalGlossaryEnabled', globalGlossaryToggle.checked);
        console.log('[Sidepanel] 詞彙庫:', globalGlossaryToggle.checked ? '啟用' : '停用');
    });
}



// 初始化載入
updateQuotaUI();
refreshGlossaryStatus();
