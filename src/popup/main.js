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

// ── 全域觸控追蹤器（最底層診斷，任何點擊都會觸發）──
// 直接在 statusMsg 顯示，不依賴 console
document.addEventListener('pointerdown', (e) => {
    const id = e.target.id || e.target.tagName + '.' + e.target.className;
    if (statusMsg) {
        statusMsg.style.color = 'blue';
        statusMsg.textContent = '點到: ' + id;
    }
    if (debugConsole) {
        const el = document.createElement('div');
        el.textContent = '[PTR] target=' + id;
        debugConsole.appendChild(el);
    }
});



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
// Android 擴充功能 Popup 中 <button> 的 click 事件可能被 WebView 攔截
// 使用 touchend + click 雙重綁定，touchend 更快且在 Android 更可靠
function openSettings(e) {
    if (e && e.cancelable) e.preventDefault(); // 防止 touchend 後觸發 click 造成雙重執行
    console.log("⚙️ 開啟設定觸發（事件類型: " + (e ? e.type : 'unknown') + "）");
    
    // 視覺回饋：馬上變色讓使用者知道有點到
    if (btnSettings) {
        btnSettings.style.background = 'rgba(0,120,212,0.1)';
        setTimeout(() => { btnSettings.style.background = ''; }, 300);
    }
    
    try {
        chrome.runtime.openOptionsPage();
        console.log("openOptionsPage() 已呼叫");
        window.close();
    } catch (err) {
        console.error("openOptionsPage 失敗:", err.message);
        if (statusMsg) {
            statusMsg.style.color = "red";
            statusMsg.textContent = "開啟設定失敗: " + err.message;
        }
    }
}

let settingsTouched = false;
btnSettings.addEventListener('touchend', (e) => {
    settingsTouched = true;
    openSettings(e);
    // 重置旗標，防止 click 不會在 300ms 後被攔截
    setTimeout(() => { settingsTouched = false; }, 500);
});

btnSettings.addEventListener('click', (e) => {
    if (settingsTouched) return; // touchend 已經處理過了，忽略重複的 click
    openSettings(e);
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
