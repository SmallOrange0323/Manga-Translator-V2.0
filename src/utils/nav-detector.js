/**
 * 偵測網頁中的「下一話」與「上一話」導航連結
 */
export function detectNavigationLinks() {
    const links = Array.from(document.querySelectorAll('a[href]'));
    let navLinks = { prev: null, next: null };

    // 關鍵字定義
    const NEXT_KEYWORDS = ['next', '下一話', '下一章', '下一页', '次へ', '次', '>', '»', 'forward'];
    const PREV_KEYWORDS = ['prev', 'previous', '上一話', '上一章', '上一页', '前へ', '前', '<', '«', 'back'];

    for (const link of links) {
        const text = (link.innerText || link.title || '').toLowerCase().trim();
        const href = link.href;
        const rel = (link.getAttribute('rel') || '').toLowerCase();
        const className = (link.className || '');

        // 過濾掉明顯不是導航的連結
        if (!href || href.startsWith('javascript:') || href === window.location.href || href.includes('#')) continue;

        // 偵測下一話 (增加 rel="next" 與常見 class 判斷)
        if (!navLinks.next) {
            if (rel === 'next' || NEXT_KEYWORDS.some(k => text.includes(k)) || /next-?chapter|next-?page/i.test(className)) {
                if (text.length > 0 || link.querySelector('img, svg') || link.closest('.nav, .navigation, .pagination, .chapter-nav')) {
                    navLinks.next = href;
                }
            }
        }

        // 偵測上一話 (增加 rel="prev" 與常見 class 判斷)
        if (!navLinks.prev) {
            if (rel === 'prev' || rel === 'previous' || PREV_KEYWORDS.some(k => text.includes(k)) || /prev-?chapter|prev-?page/i.test(className)) {
                if (text.length > 0 || link.querySelector('img, svg') || link.closest('.nav, .navigation, .pagination, .chapter-nav')) {
                    navLinks.prev = href;
                }
            }
        }

        // 如果兩邊都找到了，就提前結束
        if (navLinks.next && navLinks.prev) break;
    }

    // 嘗試從常見網站的特定結構中精準抓取 (如果有需要的話可以在此擴充)
    
    return navLinks;
}
