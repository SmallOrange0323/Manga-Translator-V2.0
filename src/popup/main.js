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
        // 行動端（不支援 sidePanel）的 chrome.runtime.openOptionsPage() 經常失效，故直接使用 tabs.create
        const isMobileDevice = !(chrome.sidePanel && typeof chrome.sidePanel.open === 'function');
        if (isMobileDevice) {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') });
            window.close();
            return;
        }

        // 電腦端採用標準 options page 方法
        chrome.runtime.openOptionsPage(() => {
            if (chrome.runtime.lastError) {
                chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') });
                window.close();
            }
        });
        window.close();
    } catch (e) {
        console.warn('openOptionsPage failed, trying fallback tabs.create:', e);
        try {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') });
            window.close();
        } catch (err) {
            console.error('Options fallback failed:', err);
        }
    }
});

// ── 開啟翻譯面板 ──
btnPanel.addEventListener('click', async () => {
    try {
        if (statusMsg) statusMsg.textContent = "正在啟動...";
        
        // 行動端 query 較寬鬆，不使用 currentWindow: true
        const tabs = await chrome.tabs.query({ active: true });
        const tab = tabs && tabs.length > 0 ? tabs[0] : null;
        
        // 優先嘗試電腦版 SidePanel
        if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
            try {
                if (tab) {
                    await chrome.sidePanel.open({ tabId: tab.id });
                    window.close();
                    return;
                }
            } catch (err) {
                console.warn('SidePanel open failed, falling back to mobile tab');
            }
        }

        // 行動端備援：直接開啟行動版分頁
        // 注意：在 Vite 打包後，路徑依然會維持 src/mobile/index.html
        const mobileUrl = chrome.runtime.getURL('src/mobile/index.html') + (tab ? '?sourceTabId=' + tab.id : '');
        
        if (statusMsg) statusMsg.textContent = "正在跳轉至行動版頁面...";
        
        await chrome.tabs.create({ url: mobileUrl });
        window.close();

    } catch (e) {
        console.error('Popup Error:', e);
        if (statusMsg) {
            statusMsg.style.color = "red";
            statusMsg.textContent = "啟動失敗: " + e.message;
        }
    }
});

// 初始檢查：如果是行動端，調整文字
if (!(chrome.sidePanel && typeof chrome.sidePanel.open === 'function')) {
    if (panelDesc) panelDesc.textContent = "開啟行動版翻譯頁面";
}
