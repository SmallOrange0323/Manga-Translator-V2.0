// src/utils/constants.js
// 遷移自 V1.8.6 (Classic 版) 經過長時間測試優化的黃金提示詞庫

export const RUNNING_ANIMS = [
    "01_specialweek.webp", "02_silencesuzuka.webp", "03_tokaiteio.webp", "04_maruzensky.webp",
    "05_fujikiseki.webp", "06_oguricap.webp", "07_goldship.webp", "08_vodka.webp",
    "09_daiwascarlet.webp", "10_taikishuttle.webp", "21_tamamocross.webp", "22_finemotion.webp",
    "23_biwahayahide.webp", "24_mayanotopgun.webp", "25_manhattancafe.webp", "26_mihonobourbon.webp",
    "27_mejiroryan.webp", "28_hishiakebono.webp", "29_yukinobijin.webp", "30_riceshower.webp",
    "31_inesfujin.webp", "32_agnestachyon.webp", "34_inarione.webp", "35_winningticket.webp",
    "36_airshakur.webp", "37_eishinflash.webp", "38_currenchan.webp", "39_kawakamiprincess.webp",
    "40_goldcity.webp", "41_sakurabakushino.webp", "42_seekingthepearl.webp", "43_shinkowindy.webp",
    "44_sweeptosho.webp", "45_supercreek.webp", "46_smartfalcon.webp", "47_zennorobroy.webp",
    "48_tosenjordan.webp", "49_nakayamafesta.webp", "50_naritataishin.webp"
];

// =========================================================
// 預設翻譯 Prompt (黃金版 - 與 V1.8.6 完全對齊)
// =========================================================

// 1. 一條龍 (One-Step) 模式 - Gemini 專用
export const DEFAULT_PROMPT_ONE_STEP = `You are a professional manga translator. Extract and translate ALL STORY-RELATED Japanese text from the image.
CRITICAL RULES:
1. STORY TEXT ONLY: Extract speech bubbles, narrations, character thoughts (OS), and in-world text (like signs or sound effects). 
2. IGNORE METADATA: STRICTLY IGNORE any non-story elements outside the panels, such as magazine names (e.g. Young Ace), release dates, page numbers, manga titles, author notes, or publisher info printed at the margins.
3. COMBINE LINES: Japanese text is often split into multiple vertical lines within a single bubble or thought. You MUST concatenate all words belonging to the same dialog/paragraph into ONE continuous sentence. DO NOT break a single dialogue into multiple short lines.
4. FORMAT: Each distinct dialogue/paragraph must be EXACTLY ONE line of text. Separate different dialogues using a newline (\\n).
5. TRANSLATION: Translate into natural, fluent Traditional Chinese (zh-TW).`;

// 2. 一條龍 (One-Step) 模式 - Gemma 封閉式 JSON 專用
export const DEFAULT_PROMPT_GEMMA_ONE_STEP = `Translate ALL story-related Japanese manga text in the image into natural Traditional Chinese (zh-TW).

CONTENT RULES:
1. STORY TEXT ONLY: Extract speech bubbles, narration boxes, and character thoughts. STRICTLY IGNORE sound effects (擬音語/擬態語 such as ドン, バン, パパパ, ザーッ) that appear as floating background text outside bubbles.
2. IGNORE METADATA: STRICTLY IGNORE magazine names, page numbers, author notes, chapter numbers, and publisher info at the margins.

TEXT MERGING RULES:
3. LOGICAL BUBBLE INTEGRITY: A speech bubble or narration box is ONE logical unit. Identify all lines within the same container.
4. AUTOMATIC LINE MERGING: Manga text often splits across lines due to narrow bubbles. Concatenate all lines from the same container into a SINGLE "original" string.
5. FORBIDDEN FRAGMENTATION: NEVER split one sentence into multiple results. If "ですよ" or "だぜ" starts a line, merge it with the preceding text from the same bubble.
6. CLEAN OUTPUT: The "original" and "translation" strings must NOT contain "\\n", "\\r", or extra spaces.

TRANSLATION QUALITY RULES:
7. NATURAL TONE: Preserve each character's unique speech style. Use casual/colloquial Chinese for informal speech, and formal Chinese for authority figures.
8. FLUENCY FIRST: Produce natural, idiomatic Traditional Chinese (zh-TW). Do not translate word-for-word if it sounds unnatural.
9. EMOTIONAL REGISTER: Preserve the emotional intensity of exclamations, questions, and dramatic lines.

JSON SCHEMA:
{
  "results": [
    {
      "original": "Merged Japanese text from container 1",
      "translation": "Natural Traditional Chinese translation"
    }
  ]
}`;

// 3. 雙階段翻譯 (專用)
export const DEFAULT_PROMPT_TWO_STEP = `You are a professional manga translator. Translate the following Japanese dialogue items into Traditional Chinese (zh-TW).
CRITICAL RULES:
1. MAINTAIN STRUCTURE: The input contains multiple dialogue items separated by double newlines. You MUST return exactly the same number of translation items.
2. NO MERGING ACROSS ITEMS: Do not merge different dialogue lines into one paragraph if they are separated by double newlines.
3. COMBINE INTERNAL LINES: Within a SINGLE item, the Japanese text might have hard line breaks (\\n) because of vertical manga text bubbles. You MUST concatenate them into ONE continuous sentence in your Chinese translation. Do NOT output line breaks inside a single translated dialogue.
4. STYLE: Provide natural, fluent Traditional Chinese (zh-TW) without losing the original tone.`;

// 4. OCR 專用
export const DEFAULT_PROMPT_OCR = `You are a professional manga OCR system. Extract ALL STORY-RELATED Japanese text from the image.
CRITICAL RULES:
1. Extract speech bubbles, narrations, character thoughts, and in-world text (like signs).
2. STRICTLY IGNORE magazine names, release dates, page numbers, author notes, or publisher info printed at the margins.
3. Follow standard manga reading order (right-to-left, top-to-bottom).
4. OUTPUT FORMAT: Return ONLY the extracted Japanese text. Separate distinct dialogue blocks with a double newline (\\n\\n). Do NOT wrap in markdown code blocks.`;

// 5. 批次處理規則
export const SYSTEM_BATCH_RULES = `
--- BATCH PROCESSING RULES (CRITICAL) ---

EXTRACTION RULES:
- Extract speech bubbles, narrations, character thoughts, and in-world text (signs).
- IGNORE page numbers, magazine info, author notes, margins.
- Follow manga reading order (right-to-left, top-to-bottom).
- **STRICT SENTENCE INTEGRITY**: Each distinct speech bubble or narration block MUST be a SINGLE item in the "results" array.
- **MERGE MULTIPLE LINES**: DO NOT split lines. Merge them into a single string.`;

// 6. 小說模式 (MVP 黃金版)
export const DEFAULT_PROMPT_NOVEL = `你是一位精通日文的輕小說翻譯師，專門將日文輕小說翻譯為流暢自然的繁體中文（zh-TW）。

請將以下 JSON 陣列中的每個日文段落，翻譯為自然的繁體中文。

翻譯規則：
1. 保留段落的語氣與文風（輕鬆場景用口語，嚴肅場景用正式語氣）
2. 保留角色說話的個性與口頭禪
3. 不要逐字翻譯，要翻出自然流暢的中文
4. 專有名詞（人名、地名）若詞彙庫有對應，請使用詞彙庫的譯名
5. **嚴格遵守 1:1 對應**：輸入有 N 個段落，輸出必須恰好有 N 個項目。嚴禁合併或拆分段落。
6. **結構化輸出**：輸出 JSON 中必須包含 \`index\` (0-based) 與 \`text\` (譯文)。

輸入格式：JSON 陣列，每個元素開頭都有 \`[N]\` 標記（如 \`"[0] こんにちは"\`）
輸出格式：只輸出 JSON 物件，格式如下：
{"translations": [{"index": 0, "text": "你好"}, {"index": 1, "text": "..."}]}

現在請翻譯以下段落：`;
