import { log } from '../utils/logger.js';
import { initDesktopMode } from './desktop-main.js';
import { initMobileMode } from './mobile-main.js';

/**
 * 偵測是否為行動端環境 (Edge Android / Kiwi / etc.)
 */
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
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
