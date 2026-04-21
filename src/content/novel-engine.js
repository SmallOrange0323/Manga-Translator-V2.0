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

export function injectTranslation(idx, translation) {
    const placeholder = document.querySelector(`.mt-novel-trans[data-idx="${idx}"]`);
    if (!placeholder) return;

    placeholder.textContent = translation;
    placeholder.classList.remove('mt-novel-placeholder');
    placeholder.style.opacity = '1';
    
    // 增加功能按鈕 (還原 V1.0 風格)
    const btn = document.createElement('span');
    btn.textContent = ' 📚+';
    btn.style.cssText = 'cursor: pointer; font-size: 10px; margin-left: 5px; opacity: 0.5;';
    btn.onclick = () => console.log('Glossary addition not implemented yet');
    placeholder.appendChild(btn);
}
