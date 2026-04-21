// scratch/test_title_parser.js
import { extractMangaTitle } from '../src/utils/manga-utils.js';

const testCases = [
    {
        title: "葬送のフリーレン Frieren at the Funeral 第100話 | RawKuma",
        expected: { displayName: "葬送のフリーレン", romanKey: "Frieren at the Funeral" }
    },
    {
        title: "咒術迴戰 第250話 - 漫金山",
        expected: { displayName: "咒術迴戰", romanKey: "咒術迴戰" }
    },
    {
        title: "Frieren at the Funeral Chapter 100 - Read Manga Online",
        expected: { displayName: "Frieren at the Funeral", romanKey: "Frieren at the Funeral" }
    },
    {
        title: "無職転生　- 異世界行ったら本気だす - 第1話 - 小說站",
        expected: { displayName: "無職転生", romanKey: "無職転生" }
    },
    {
        title: "Overlord Chapter 1 - NovelUpdates",
        expected: { displayName: "Overlord", romanKey: "Overlord" }
    }
];

console.log("=== Manga Title Parser Unit Test ===");
testCases.forEach((tc, i) => {
    const result = extractMangaTitle(tc.title);
    const success = result && 
                    result.displayName === tc.expected.displayName && 
                    result.romanKey === tc.expected.romanKey;
    
    console.log(`Test ${i + 1}: ${success ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Input: ${tc.title}`);
    console.log(`  Output:`, result);
    if (!success) {
        console.log(`  Expected:`, tc.expected);
    }
    console.log("-----------------------------------");
});
