/**
 * 漫譯 V2 - 純淨版彈出視窗邏輯
 */

const btnPanel    = document.getElementById('btn-open-panel');
const btnSettings = document.getElementById('btn-open-settings');
const statusMsg   = document.getElementById('status-msg');
const noticeEl    = document.getElementById('panel-not-available');
const panelDesc   = document.getElementById('panel-desc');

// ── 偵錯控制台綁定與劫持 ──
const debugSection = document.getElementById('debug-section');
const debugConsole = document.getElementById('debug-log-console');
const btnToggleDebug = document.getElementById('btn-toggle-debug');

function logToDebugConsole(level, ...args) {
    if (!debugConsole) return;
    const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.style.borderBottom = '1px solid rgba(0,0,0,0.05)';
    line.style.padding = '2px 0';
    if (level === 'error') line.style.color = '#ff3b30';
    if (level === 'warn') line.style.color = '#ff9500';
    line.textContent = `[${time}] [${level.toUpperCase()}] ${msg}`;
    debugConsole.appendChild(line);
    debugConsole.scrollTop = debugConsole.scrollHeight;
}

// 覆寫全域 console
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args) => { originalLog(...args); logToDebugConsole('info', ...args); };
console.warn = (...args) => { originalWarn(...args); logToDebugConsole('warn', ...args); };
console.error = (...args) => { originalError(...args); logToDebugConsole('error', ...args); };

// 偵錯日誌開關
if (btnToggleDebug && debugSection) {
    btnToggleDebug.addEventListener('click', () => {
        if (debugSection.style.display === 'none') {
            debugSection.style.display = 'block';
            btnToggleDebug.textContent = '隱藏偵錯資訊 (Hide Debug)';
        } else {
            debugSection.style.display = 'none';
            btnToggleDebug.textContent = '顯示偵錯資訊 (Show Debug)';
        }
    });
}

// 全域錯誤監聽 (Sync & Async)
window.onerror = function(msg, url, line) {
    console.error(`Sync Error: ${msg} at ${url}:${line}`);
    if (statusMsg) {
        statusMsg.style.color = "red";
        statusMsg.textContent = "Error: " + msg;
    }
    if (debugSection) debugSection.style.display = 'block'; // 報錯時自動展開偵錯資訊
    return false;
};

window.addEventListener('unhandledrejection', (event) => {
    const errorMsg = event.reason ? (event.reason.message || event.reason) : 'Unknown promise rejection';
    console.error(`Promise Error: ${errorMsg}`, event.reason);
    if (statusMsg) {
        statusMsg.style.color = "red";
        statusMsg.textContent = "Promise Error: " + errorMsg;
    }
    if (debugSection) debugSection.style.display = 'block'; // 報錯時自動展開偵錯資訊
});

// ── 開啟設定頁 ──
btnSettings.addEventListener('click', async () => {
    try {
        console.log("⚙️ 點擊設定按鈕...");
        if (statusMsg) {
            statusMsg.style.color = "inherit";
            statusMsg.textContent = "正在開啟設定頁面...";
        }
        
        // 偵測裝置環境與 chrome API
        const sidePanelSupported = (chrome.sidePanel && typeof chrome.sidePanel.open === 'function');
        const openOptionsPageSupported = (chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function');
        const tabsSupported = (chrome.tabs && typeof chrome.tabs.create === 'function');
        
        console.log(`環境偵測: sidePanel=${sidePanelSupported}, openOptionsPage=${openOptionsPageSupported}, tabs=${tabsSupported}`);
        
        // 行動端（不支援 sidePanel）的 chrome.runtime.openOptionsPage() 經常失效，故直接使用 tabs.create
        const isMobileDevice = !sidePanelSupported;
        console.log(`是否判斷為行動端: ${isMobileDevice}`);
        
        if (isMobileDevice) {
            const url = chrome.runtime.getURL('src/options/index.html');
            console.log(`行動端準備使用 tabs.create 開啟: ${url}`);
            
            if (!tabsSupported) {
                throw new Error("此環境不支援 chrome.tabs API");
            }
            
            try {
                const tab = await chrome.tabs.create({ url: url });
                console.log(`✅ tabs.create 成功！回傳 Tab ID: ${tab ? tab.id : 'undefined'}`);
                window.close();
            } catch (err) {
                console.error(`❌ tabs.create 失敗: ${err.message}`);
                throw err;
            }
            return;
        }

        // 電腦端採用標準 options page 方法
        console.log("電腦端採用標準 openOptionsPage");
        chrome.runtime.openOptionsPage(async () => {
            if (chrome.runtime.lastError) {
                console.warn(`openOptionsPage 錯誤, 嘗試 fallback: ${chrome.runtime.lastError.message}`);
                await chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') });
            } else {
                console.log("openOptionsPage 呼叫成功");
            }
            window.close();
        });
    } catch (e) {
        console.warn('最外層攔截 Catch, 嘗試最終 Fallback tabs.create:', e.message);
        try {
            const fallbackUrl = chrome.runtime.getURL('src/options/index.html');
            await chrome.tabs.create({ url: fallbackUrl });
            window.close();
        } catch (err) {
            console.error('Options fallback 最終完全失敗:', err.message);
            if (statusMsg) {
                statusMsg.style.color = "red";
                statusMsg.textContent = "開啟設定失敗，請確認權限";
            }
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
