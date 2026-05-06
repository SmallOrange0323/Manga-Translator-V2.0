/**
 * 漫譯 V2 - 行動端核心邏輯
 */

const state = {
    sourceTabId: null,
    images: [],
    selectedIndices: new Set()
};

// UI 元素
const views = {
    loading: document.getElementById('view-loading'),
    picker: document.getElementById('view-picker'),
    reader: document.getElementById('view-reader')
};

const elements = {
    statusBadge: document.getElementById('status-badge'),
    imageGrid: document.getElementById('image-grid'),
    scanCount: document.getElementById('scan-count'),
    selectedCount: document.getElementById('selected-count'),
    btnSelectAll: document.getElementById('btn-select-all'),
    btnStartTranslate: document.getElementById('btn-start-translate'),
    btnBackToPicker: document.getElementById('btn-back-to-picker'),
    btnManualScan: document.getElementById('btn-manual-scan'),
    loadingText: document.getElementById('loading-text'),
    readerProgress: document.getElementById('reader-progress'),
    resultsList: document.getElementById('results-list'),
    completeBanner: document.getElementById('complete-banner'),
    btnOpenOptions: document.getElementById('btn-open-options')
};

// 初始化
async function init() {
    console.log('[Mobile] Initializing...');
    const params = new URLSearchParams(window.location.search);
    state.sourceTabId = parseInt(params.get('sourceTabId'));

    if (!state.sourceTabId) {
        showError('找不到來源分頁資訊，請從漫畫分頁重新開啟。');
        return;
    }

    startImageScan();
}

// 切換視圖
function showView(viewName) {
    Object.keys(views).forEach(name => {
        views[name].classList.toggle('active', name === viewName);
    });
}

// 掃描圖片
function startImageScan() {
    showView('loading');
    elements.statusBadge.textContent = '掃描中';
    
    chrome.runtime.sendMessage({
        action: 'MOBILE_CRAWL_IMAGES',
        payload: { sourceTabId: state.sourceTabId }
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('[Mobile] Scan failed:', chrome.runtime.lastError);
            showError('通訊失敗，請重整頁面。');
            return;
        }

        if (response && response.images && response.images.length > 0) {
            state.images = response.images;
            renderPicker();
            showView('picker');
            elements.statusBadge.textContent = '待機';
        } else {
            elements.btnManualScan.style.display = 'block';
            showError('未在來源分頁找到圖片，請確認漫畫已完全載入。');
        }
    });
}

// 渲染選圖器
function renderPicker() {
    elements.imageGrid.innerHTML = '';
    elements.scanCount.textContent = `找到 ${state.images.length} 張圖片`;
    
    state.images.forEach((img, index) => {
        const src = img.src || img;
        const item = document.createElement('div');
        item.className = 'image-item';
        item.dataset.index = index;
        
        const isSelected = state.selectedIndices.has(index);
        if (isSelected) item.classList.add('selected');

        item.innerHTML = `
            <input type="checkbox" class="image-checkbox" ${isSelected ? 'checked' : ''}>
            <img src="${src}" loading="lazy">
            <div class="image-overlay">頁面 ${index + 1}</div>
        `;

        item.onclick = (e) => {
            const checkbox = item.querySelector('.image-checkbox');
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
            }
            toggleSelection(index, checkbox.checked);
        };

        elements.imageGrid.appendChild(item);
    });
    updateFooter();
}

function toggleSelection(index, isChecked) {
    if (isChecked) {
        state.selectedIndices.add(index);
    } else {
        state.selectedIndices.delete(index);
    }
    
    const item = elements.imageGrid.querySelector(`.image-item[data-index="${index}"]`);
    if (item) item.classList.toggle('selected', isChecked);
    
    updateFooter();
}

function updateFooter() {
    elements.selectedCount.textContent = state.selectedIndices.size;
    elements.btnStartTranslate.disabled = state.selectedIndices.size === 0;
}

// 翻譯觸發
elements.btnStartTranslate.onclick = () => {
    const selectedImages = Array.from(state.selectedIndices)
        .sort((a, b) => a - b)
        .map(idx => state.images[idx]);

    elements.resultsList.innerHTML = '';
    elements.completeBanner.style.display = 'none';
    elements.readerProgress.textContent = '準備中...';
    
    showView('reader');
    elements.statusBadge.textContent = '翻譯中';

    chrome.runtime.sendMessage({
        action: 'START_MANGA_BATCH_MOBILE_MODE',
        payload: { 
            sourceTabId: state.sourceTabId,
            images: selectedImages 
        }
    });
};

// 監聽背景訊息
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'updateProgress') {
        elements.readerProgress.textContent = `進度: ${message.current}`;
    }

    if (message.action === 'appendResult') {
        appendReaderResult(message.data);
    }

    if (message.action === 'batchComplete') {
        elements.statusBadge.textContent = '完成';
        elements.readerProgress.textContent = '所有翻譯已完成';
        elements.completeBanner.style.display = 'flex';
    }

    if (message.action === 'clearResults') {
        elements.resultsList.innerHTML = '';
    }
});

// 渲染圖文交錯結果
function appendReaderResult(data) {
    const group = document.createElement('div');
    group.className = 'result-group';

    // 1. 圖片
    const img = document.createElement('img');
    img.className = 'result-image';
    img.src = data.image;
    group.appendChild(img);

    // 2. 翻譯卡片
    if (data.error) {
        const err = document.createElement('div');
        err.className = 'error-text';
        err.textContent = `翻譯失敗: ${data.error}`;
        group.appendChild(err);
    } else if (data.results && data.results.length > 0) {
        const card = document.createElement('div');
        card.className = 'translation-card';
        
        data.results.forEach(res => {
            const item = document.createElement('div');
            item.className = 'translation-item';
            item.innerHTML = `
                <span class="orig-text">${res.original}</span>
                <span class="trans-text">${res.translation}</span>
            `;
            card.appendChild(item);
        });
        group.appendChild(card);
    }

    elements.resultsList.appendChild(group);
}

// 其他按鈕事件
elements.btnSelectAll.onclick = () => {
    const allSelected = state.selectedIndices.size === state.images.length;
    if (allSelected) {
        state.selectedIndices.clear();
    } else {
        state.images.forEach((_, i) => state.selectedIndices.add(i));
    }
    renderPicker();
};

elements.btnBackToPicker.onclick = () => {
    showView('picker');
    elements.statusBadge.textContent = '待機';
};

elements.btnManualScan.onclick = () => {
    startImageScan();
};

elements.btnOpenOptions.onclick = () => {
    chrome.runtime.openOptionsPage();
};



// 以頁面內訊息取代 alert（手機體驗更佳）
function showError(msg) {
    console.error('[Mobile Error]', msg);
    // 顯示在 loading 視圖的文字區
    if (elements.loadingText) {
        elements.loadingText.textContent = msg;
        elements.loadingText.style.color = '#f43f5e';
    }
}

// 啟動
init();
