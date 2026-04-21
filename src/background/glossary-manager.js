import { state } from '../utils/state.js';
import { log } from '../utils/logger.js';

/**
 * GlossaryManager: 作品專屬詞彙對照表系統
 * 移植自 V1.8.6 的實戰邏輯，適配 V2.0 模組化架構。
 * 
 * 設計守則：
 * 1. 只增不覆寫：AI 萃取的詞彙只能新增不存在的原文，不可覆蓋現有條目。
 * 2. 使用者權威：source: "user" 的條目永久鎖定。
 * 3. 500 詞限制：防止 storage 溢出。
 */

export const GLOSSARY_STORAGE_KEY = 'mangaGlossaries';
export const GLOSSARY_MAX_TERMS = 500;

/**
 * 讀取指定作品的詞庫
 * @param {string} mangaKey 
 * @returns {Promise<Object|null>}
 */
export async function loadGlossary(mangaKey) {
    if (!mangaKey) return null;
    try {
        const data = await chrome.storage.local.get([GLOSSARY_STORAGE_KEY]);
        const all = data[GLOSSARY_STORAGE_KEY] || {};
        return all[mangaKey] || null;
    } catch (e) {
        log.warn('Glossary', `讀取失敗: ${e.message}`);
        return null;
    }
}

/**
 * 儲存詞庫並執行上限修剪
 * @param {string} mangaKey 
 * @param {Object} glossaryEntry 
 */
export async function saveGlossary(mangaKey, glossaryEntry) {
    if (!mangaKey || !glossaryEntry) return;
    try {
        const data = await chrome.storage.local.get([GLOSSARY_STORAGE_KEY]);
        const all = data[GLOSSARY_STORAGE_KEY] || {};

        // 執行 500 詞上限修剪
        let terms = glossaryEntry.terms || [];
        if (terms.length > GLOSSARY_MAX_TERMS) {
            const userTerms = terms.filter(t => t.source === 'user');
            const aiTerms = terms.filter(t => t.source === 'ai');
            const remainingSlots = GLOSSARY_MAX_TERMS - userTerms.length;
            const trimmedAi = remainingSlots > 0 ? aiTerms.slice(-remainingSlots) : [];
            terms = [...userTerms, ...trimmedAi];
            log.info('Glossary', `詞庫已修剪至 ${terms.length} 詞 (保留全部使用者條目)`);
        }

        const oldEntry = all[mangaKey] || {};
        all[mangaKey] = {
            displayName: oldEntry.displayName || glossaryEntry.displayName || mangaKey,
            rawJapanese: glossaryEntry.rawJapanese || oldEntry.rawJapanese || null,
            romanKey: glossaryEntry.romanKey || oldEntry.romanKey || mangaKey,
            terms,
            lastUsed: Date.now()
        };

        await chrome.storage.local.set({ [GLOSSARY_STORAGE_KEY]: all });
        log.info('Glossary', `已儲存作品 "${mangaKey}" 詞庫，共 ${terms.length} 詞`);
        
        // 通知 UI 更新
        chrome.runtime.sendMessage({ 
            action: 'GLOSSARY_UPDATED', 
            payload: { mangaKey, termCount: terms.length } 
        }).catch(() => {});

    } catch (e) {
        log.warn('Glossary', `儲存失敗: ${e.message}`);
    }
}

/**
 * 整併 AI 萃取的新術語
 */
export function mergeGlossaryTerms(existingTerms, newTerms) {
    if (!Array.isArray(newTerms) || newTerms.length === 0) {
        return { terms: existingTerms, addedCount: 0 };
    }

    const existingOriSet = new Set(existingTerms.map(t => t.ori.toLowerCase().trim()));
    let addedCount = 0;
    const merged = [...existingTerms];

    for (const newTerm of newTerms) {
        if (!newTerm.ori || !newTerm.trans) continue;
        const oriKey = newTerm.ori.toLowerCase().trim();

        if (existingOriSet.has(oriKey)) continue;

        merged.push({
            ori: newTerm.ori.trim(),
            trans: newTerm.trans.trim(),
            source: 'ai'
        });
        existingOriSet.add(oriKey);
        addedCount++;
    }

    if (addedCount > 0) {
        log.info('Glossary', `詞庫整併完成，新增了 ${addedCount} 個術語`);
    }

    return { terms: merged, addedCount };
}

/**
 * 生成 Prompt 注入片段
 */
export function buildGlossaryPromptSnippet(terms) {
    if (!terms || terms.length === 0) return '';
    const pairs = terms.map(t => `${t.ori}→${t.trans}`).join('、');
    return `\n\n【專屬名詞對照表 - 絕對遵守】以下術語請嚴格使用指定譯名，不可更改：${pairs}`;
}
