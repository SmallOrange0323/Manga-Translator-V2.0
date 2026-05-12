import { log } from '../utils/logger.js';
import { initDesktopMode } from './desktop-main.js';
import { initMobileMode } from './mobile-main.js';
import { detectNavigationLinks } from '../utils/nav-detector.js';

/**
 * 偵測是否為行動端環境 (Edge Android / Kiwi / etc.)
 */
function isMobileDevice() {
    // 1. 標準 UA 偵測 (涵蓋 Android, iPhone, 舊版 iPad 等)
    const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // 2. iPadOS 13+ 偽裝偵測 (桌面模式下會隱藏 iPad 字樣，特徵為 MacIntel 且支援多點觸控)
    const isIPadOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    // 修復矛盾 #3：移除「寬度 <= 1280 且有觸控」的寬鬆判斷
    // 此條件會使 Surface 等 Windows 觸控筆電誤判為行動端，改為只信任 UA 與 iPadOS 特徵
    
    return uaMobile || isIPadOS;
}

function bootstrap() {
    const isMobile = isMobileDevice();
    log.info('Content', `系統啟動 - 偵測到環境: ${isMobile ? '行動端' : '電腦端'}`);

    if (isMobile) {
        initMobileMode();
    } else {
        initDesktopMode();
    }
}

// 在網頁載入後啟動
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bootstrap();
} else {
    window.addEventListener('load', bootstrap);
}
