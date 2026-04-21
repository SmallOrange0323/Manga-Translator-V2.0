import { state } from '../utils/state.js';
import { extractMangaTitle } from '../utils/manga-utils.js';

console.log('[Manga Translator V2] Classic Sidepanel Initialized');

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
    if (progress && progress.status) {
        statusEl.style.display = 'inline';
        statusEl.textContent = `(${progress.status})`;
    } else {
        statusEl.style.display = 'none';
    }
}

// 選圖階段暫存變數
let candidateImages = [];

// 綁定按鈕動作
document.getElementById('mt-start-btn').onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        
        let crawlTimeout = setTimeout(() => {
            alert("掃描請求無回應。請確認網頁沒有變更位址，或嘗試手動重整。");
        }, 8000);

        chrome.tabs.sendMessage(tabs[0].id, { action: "crawlImages" }, (response) => {
            clearTimeout(crawlTimeout);
            if (chrome.runtime.lastError) {
                console.error('[Manga][SP] crawlImages 失敗:', chrome.runtime.lastError.message);
                return;
            }
            if (response && response.images) {
                candidateImages = response.images;
                if (candidateImages.length === 0) {
                    alert("未在此網頁找到候選圖片！\n\n小提醒：部分網站需要往下捲動才會載入圖片，請先捲動網頁後再試一次。");
                    return;
                }
                renderPreviewList();
            }
        });
    });
};

document.getElementById('mt-options-btn').onclick = () => {
    chrome.runtime.openOptionsPage();
};

document.getElementById('mt-selection-btn').onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleSelectionMode' });
    });
};

const resultsContainer = document.getElementById('mt-results-container');

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
                images: selectedUrls
            }
        });
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
