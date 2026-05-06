/**
 * 漫譯 V2 - 彈出視窗邏輯
 * 仿照 uBlock Origin 的做法：popup 同時支援電腦版（開啟側邊欄）和行動版（開啟設定）
 */

const btnPanel    = document.getElementById('btn-open-panel');
const btnSettings = document.getElementById('btn-open-settings');
const statusMsg   = document.getElementById('status-msg');
const noticeEl    = document.getElementById('panel-not-available');

// ── 開啟設定頁（兩個平台都可用）──
btnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
});

// ── 開啟側邊欄（電腦版才有效）──
btnPanel.addEventListener('click', async () => {
    // 嘗試取得當前分頁
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        showStatus('❌ 無法取得當前分頁');
        return;
    }

    // 嘗試呼叫 sidePanel.open（電腦版 Edge/Chrome）
    if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
        try {
            await chrome.sidePanel.open({ tabId: tab.id });
            window.close();
        } catch (err) {
            // 行動端：sidePanel.open 不被支援，顯示提示
            console.warn('[Popup] sidePanel.open failed:', err.message);
            showPanelNotAvailable();
        }
    } else {
        // API 不存在（行動端或舊版瀏覽器）
        showPanelNotAvailable();
    }
});

function showPanelNotAvailable() {
    noticeEl.style.display = 'block';
    btnPanel.disabled = true;
    btnPanel.style.opacity = '0.5';
    btnPanel.style.cursor = 'not-allowed';
}

function showStatus(msg) {
    statusMsg.textContent = msg;
    setTimeout(() => { statusMsg.textContent = ''; }, 3000);
}
