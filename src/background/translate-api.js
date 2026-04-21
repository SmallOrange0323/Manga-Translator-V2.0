import { state } from '../utils/state.js';
import { log, maskKey } from '../utils/logger.js';

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
        const keyMasked = maskKey(currentKey);

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
                log.api('TranslateAPI', 'API Request Failed', { model: currentModel, latencyMs, keyMasked, status: 'Error' });
                throw new Error(`API Error ${response.status}: ${apiError}`);
            }

            const json = await response.json();
            const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const cleanJsonStr = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleanJsonStr);
            
            log.api('TranslateAPI', 'Translation Successful', { model: currentModel, latencyMs, keyMasked, status: 'OK' });
            return parsed;

        } catch (err) {
            const latencyMs = Math.round(performance.now() - startTime);
            log.warn('TranslateAPI', `Attempt ${attempt} failed: ${err.message}`, { model: currentModel, latencyMs, keyMasked });
            
            lastError = err;
            if (attempt === 2) {
                log.info('TranslateAPI', `Switching to fallback model: ${fallbackModel}`);
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
    const extractPrompt = `You are a strict linguistic filter. Extract ONLY Katakana names or verified Character names (Surname+Given name). NO common nouns. 
Return only a JSON array of objects with "ori" and "trans".
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
        const keyMasked = maskKey(apiKey);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const latencyMs = Math.round(performance.now() - startTime);

        if (!response.ok) {
             log.api('TranslateAPI', 'Term Extraction Failed', { model, latencyMs, keyMasked, status: 'Error' });
             return [];
        }
        const json = await response.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        const parsed = JSON.parse(text);
        
        log.api('TranslateAPI', 'Term Extraction Successful', { model, latencyMs, keyMasked, status: 'OK' });
        return parsed;
    } catch (e) {
        log.warn('TranslateAPI', `Term extraction failed: ${e.message}`);
        return [];
    }
}
