import { state } from '../utils/state.js';
import { log } from '../utils/logger.js';

/**
 * TranslateAPI: 封裝實戰級的 Gemini API 呼叫
 * 特色：
 * 1. 指數退避重試 (Exponential Backoff)
 * 2. 自動清理不完整的 JSON 回傳
 * 3. 備份模型切換邏輯
 */

export async function translateTexts(texts, options = {}) {
    const {
        model = 'gemini-1.5-flash',
        fallbackModel = 'gemini-1.5-pro',
        prompt = 'Translate the following texts to Traditional Chinese. Return only JSON.',
        schema = null,
        glossarySnippet = '' // 加入術語對照表片段
    } = options;

    let { apiKey } = options;

    if (!apiKey) {
        apiKey = state.getNextApiKey();
    }

    if (!apiKey) throw new Error('API Key is missing and pool is empty');

    // 將術語片段植入 Prompt
    const finalPrompt = glossarySnippet ? `${prompt}\n\n${glossarySnippet}` : prompt;

    // 建立 Parts
    const parts = [];
    if (options.imageBase64) {
        parts.push({
            inlineData: {
                mimeType: "image/jpeg",
                data: options.imageBase64
            }
        });
    }
    
    // 如果有 texts, 加上 texts
    let textToProcess = finalPrompt;
    if (texts && texts.length > 0) {
        textToProcess += `\n\n${JSON.stringify(texts)}`;
    }
    parts.push({ text: textToProcess });

    const body = {
        contents: [{ role: 'user', parts: parts }],
        generationConfig: {
            response_mime_type: 'application/json',
            ...(schema ? { response_schema: schema } : {})
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
    };
    
    // ... (原本的抓取邏輯保持不變)
    let lastError = null;
    let currentModel = model;

    for (let attempt = 1; attempt <= 3; attempt++) {
        const startTime = performance.now();
        const currentKey = (attempt > 1) ? (state.getNextApiKey() || apiKey) : apiKey;
        const keyAlias = state.getApiKeyAlias(currentKey);

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${currentKey}`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const latencyMs = Math.round(performance.now() - startTime);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const apiError = errorData.error?.message || 'Unknown error';
                log.api('TranslateAPI', 'API 請求失敗', { model: currentModel, latencyMs, keyAlias, status: 'Error' });
                throw new Error(`API 錯誤 ${response.status}: ${apiError}`);
            }

            const json = await response.json();
            const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const cleanJsonStr = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleanJsonStr);
            
            log.api('TranslateAPI', '翻譯成功', { model: currentModel, latencyMs, keyAlias, status: 'OK' });
            return parsed;

        } catch (err) {
            const latencyMs = Math.round(performance.now() - startTime);
            log.warn('TranslateAPI', `第 ${attempt} 次嘗試失敗: ${err.message}`, { model: currentModel, latencyMs, keyAlias });
            
            lastError = err;
            if (attempt === 2) {
                log.info('TranslateAPI', `切換至備援模型: ${fallbackModel}`);
                currentModel = fallbackModel;
            }
            
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    throw lastError;
}

/**
 * 從翻譯結果中非同步萃取術語
 */
export async function extractTermsFromTranslation(pairs, options = {}) {
    const { model = 'gemini-1.5-flash' } = options;
    const apiKey = state.getNextApiKey();
    if (!apiKey || pairs.length === 0) return [];

    const inputText = pairs.map(p => `${p.original} → ${p.translation}`).join('\n');
    const extractPrompt = `You are a strict linguistic filter for Japanese manga terminology.
Your task: Extract ONLY proper nouns that are foreign-origin names written in Katakana (片假名).

Rules (strictly enforce ALL of them):
1. INCLUDE: Katakana-only words of 2 or more characters (e.g. フリーレン, レムラエル, ゼルダ)
2. EXCLUDE: Any word containing Kanji (漢字), even partially (e.g. 村長, 山田, 剣士 are all EXCLUDED)
3. EXCLUDE: Hiragana-only words
4. EXCLUDE: Onomatopoeia / sound effects (e.g. ドカン, バン, ザワザワ)
5. EXCLUDE: Common Japanese nouns or titles (e.g. センセイ, ボス, マスター)

Return ONLY a JSON array. If no valid terms found, return an empty array [].
Input:
${inputText}`;

    const body = {
        contents: [{ role: 'user', parts: [{ text: extractPrompt }] }],
        generationConfig: {
            response_mime_type: 'application/json',
            response_schema: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: {
                        ori: { type: 'STRING' },
                        trans: { type: 'STRING' }
                    },
                    required: ['ori', 'trans']
                }
            }
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
    };

    try {
        const startTime = performance.now();
        const keyAlias = state.getApiKeyAlias(apiKey);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const latencyMs = Math.round(performance.now() - startTime);

        if (!response.ok) {
             log.api('TranslateAPI', '術語萃取失敗', { model, latencyMs, keyAlias, status: 'Error' });
             return [];
        }
        const json = await response.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        const parsed = JSON.parse(text);
        
        log.api('TranslateAPI', '術語萃取成功', { model, latencyMs, keyAlias, status: 'OK' });
        return parsed;
    } catch (e) {
        log.warn('TranslateAPI', `術語萃取發生錯誤: ${e.message}`);
        return [];
    }
}
