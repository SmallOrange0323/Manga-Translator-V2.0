/**
 * 漫譯 V2 - 純淨版彈出視窗邏輯
 */

const btnPanel    = document.getElementById('btn-open-panel');
const btnSettings = document.getElementById('btn-open-settings');
const statusMsg   = document.getElementById('status-msg');
const noticeEl    = document.getElementById('panel-not-available');
const panelDesc   = document.getElementById('panel-desc');

// 錯誤處理預防
window.onerror = function(msg) {
    if (statusMsg) statusMsg.textContent = "Error: " + msg;
    return false;
};

// ── 開啟設定頁 ──
btnSettings.addEventListener('click', () => {
    try {
        chrome.runtime.openOptionsPage();
        window.close();
    } catch (e) {
        console.error(e);
    }
});

// ── 開啟翻譯面板 ──
btnPanel.addEventListener('click', async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // 優先嘗試電腦版 SidePanel
        if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
            try {
                await chrome.sidePanel.open({ tabId: tab.id });
                window.close();
                return;
            } catch (err) {
                console.warn('SidePanel open failed, falling back to mobile mode');
            }
        }

        // 行動端備援：直接開啟行動版分頁
        const mobileUrl = chrome.runtime.getURL('src/mobile/index.html') + (tab ? '?sourceTabId=' + tab.id : '');
        chrome.tabs.create({ url: mobileUrl });
        window.close();

    } catch (e) {
        if (statusMsg) statusMsg.textContent = "啟動失敗: " + e.message;
    }
});

// 初始檢查：如果是行動端，調整文字
if (!(chrome.sidePanel && typeof chrome.sidePanel.open === 'function')) {
    if (panelDesc) panelDesc.textContent = "開啟行動版翻譯頁面";
}
