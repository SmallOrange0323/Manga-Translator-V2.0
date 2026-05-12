// src/content/novel-engine.js
/**
 * NovelEngine: 小說 DOM 偵測與注入核心
 * 移植自 V1.0 的實戰邏輯
 */

const NOVEL_SELECTORS = [
    '#novel_honbun p',       // 舊版 syosetu
    '.p-novel__body p',      // 新版 syosetu
    '.novel_view p',
    'p.novel_view',
    '[class*="honbun"] p',
];

export function getNovelParagraphs() {
    let result = [];
    let seen = new Set();

    for (const sel of NOVEL_SELECTORS) {
        document.querySelectorAll(sel).forEach(el => {
            if (!seen.has(el) && el.textContent.trim().length > 0) {
                seen.add(el);
                result.push(el);
            }
        });
    }

    // fallback: 包含日文字元的 <p>
    if (result.length === 0) {
        result = Array.from(document.querySelectorAll('p')).filter(p => {
            const text = p.textContent.trim();
            return text.length > 0 && /[\u3040-\u9FFF]/.test(text);
        });
    }

    return result;
}

export function insertPlaceholders(paragraphs) {
    paragraphs.forEach((p, i) => {
        if (p.querySelector('.mt-novel-trans')) return;
        
        const placeholder = document.createElement('div');
        placeholder.className = 'mt-novel-trans mt-novel-placeholder';
        placeholder.dataset.idx = i;
        placeholder.style.cssText = 'color: #8d80f1; font-size: 0.9em; margin-top: 4px; opacity: 0.6;';
        placeholder.textContent = '⏳';
        
        p.appendChild(placeholder);
    });
}

// 注入全域樣式（僅注入一次）
function injectStyles() {
    if (document.getElementById('mt-novel-styles')) return;
    const style = document.createElement('style');
    style.id = 'mt-novel-styles';
    style.textContent = `
        .mt-glossary-dialog {
            position: fixed;
            top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: white; color: #242424;
            padding: 20px; border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            z-index: 2147483647; width: 280px;
            display: flex; flex-direction: column; gap: 12px;
            font-family: sans-serif;
        }
        @media (prefers-color-scheme: dark) {
            .mt-glossary-dialog { background: #333; color: white; }
        }
        .mt-glossary-dialog h3 { margin: 0; font-size: 16px; }
        .mt-glossary-dialog input {
            padding: 8px; border-radius: 6px; border: 1px solid #ccc;
            background: transparent; color: inherit;
        }
        .mt-glossary-dialog .btns { display: flex; gap: 8px; justify-content: flex-end; }
        .mt-glossary-dialog button {
            padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer;
        }
        .mt-glossary-dialog .save { background: #0078d4; color: white; }
    `;
    document.head.appendChild(style);
}

async function handleAddGlossary() {
    injectStyles();
    
    // 1. 獲取當前作品 Key
    const { mangaKey } = await new Promise(r => chrome.runtime.sendMessage({ action: 'getTabMangaKey' }, r));
    if (!mangaKey) {
        alert('無法識別作品標題，請重新整理頁面再試');
        return;
    }

    // 2. 建立簡單對話框
    const dialog = document.createElement('div');
    dialog.className = 'mt-glossary-dialog';
    dialog.innerHTML = `
        <h3>新增語彙</h3>
        <input type="text" id="mt-ori" placeholder="日文原文 (如: ラインフェルト)">
        <input type="text" id="mt-trans" placeholder="中文譯名 (如: 萊因哈特)">
        <div class="btns">
            <button class="cancel">取消</button>
            <button class="save">儲存</button>
        </div>
    `;
    document.body.appendChild(dialog);

    const close = () => dialog.remove();
    dialog.querySelector('.cancel').onclick = close;
    dialog.querySelector('.save').onclick = async () => {
        const ori = dialog.querySelector('#mt-ori').value.trim();
        const trans = dialog.querySelector('#mt-trans').value.trim();
        if (!ori || !trans) return;

        const resp = await new Promise(r => chrome.runtime.sendMessage({
            action: 'saveGlossaryTerm',
            mangaKey,
            ori,
            trans
        }, r));

        if (resp.success) {
            alert(`已儲存: ${ori} -> ${trans}\n下次翻譯時將會生效。`);
            close();
        } else {
            alert('儲存失敗: ' + resp.error);
        }
    };
}

export function injectTranslation(idx, translation) {
    const placeholder = document.querySelector(`.mt-novel-trans[data-idx="${idx}"]`);
    if (!placeholder) return;

    placeholder.textContent = translation;
    placeholder.classList.remove('mt-novel-placeholder');
    placeholder.style.opacity = '1';
    
    // 增加功能按鈕 (還原 V1.0 風格)
    const btn = document.createElement('span');
    btn.textContent = ' 📚+';
    btn.title = '新增至語彙庫';
    btn.style.cssText = 'cursor: pointer; font-size: 11px; margin-left: 5px; opacity: 0.5; color: #0078d4; font-weight: bold;';
    btn.onclick = () => handleAddGlossary();
    placeholder.appendChild(btn);

    // 新增：小說單段重譯按鈕
    const retransBtn = document.createElement('span');
    retransBtn.textContent = ' 🔄';
    retransBtn.title = '單段重譯';
    retransBtn.style.cssText = 'cursor: pointer; font-size: 11px; margin-left: 5px; opacity: 0.5; color: #0078d4; font-weight: bold;';
    retransBtn.onclick = () => handleRetranslateParagraph(idx, placeholder);
    placeholder.appendChild(retransBtn);
}

/**
 * 處理單段重譯
 */
async function handleRetranslateParagraph(idx, placeholder) {
    const p = placeholder.parentElement;
    if (!p) return;

    // 獲取原始文字（過濾掉譯文和按鈕）
    const clone = p.cloneNode(true);
    const transDiv = clone.querySelector('.mt-novel-trans');
    if (transDiv) transDiv.remove();
    const originalText = clone.textContent.trim();

    if (!originalText) return;

    // 進入 loading 狀態
    placeholder.textContent = '⏳ 重譯中...';
    placeholder.style.opacity = '0.6';

    // 獲取當前作品 Key
    const { mangaKey } = await new Promise(r => chrome.runtime.sendMessage({ action: 'getTabMangaKey' }, r));

    chrome.runtime.sendMessage({
        action: 'retranslateNovelParagraph',
        text: originalText,
        mangaKey: mangaKey
    }, (response) => {
        if (response && response.success) {
            // 重新注入譯文與按鈕
            injectTranslation(idx, response.translation);
        } else {
            placeholder.textContent = '❌ 重譯失敗';
            placeholder.style.opacity = '1';
            // 保留重試按鈕
            const retryBtn = document.createElement('span');
            retryBtn.textContent = ' 🔄 重試';
            retryBtn.style.cssText = 'cursor: pointer; font-size: 11px; margin-left: 5px; color: #0078d4;';
            retryBtn.onclick = () => handleRetranslateParagraph(idx, placeholder);
            placeholder.appendChild(retryBtn);
        }
    });
}
