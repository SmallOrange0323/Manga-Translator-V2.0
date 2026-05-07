import { log } from '../utils/logger.js';
import { state } from '../utils/state.js';
import { crawlImages } from './manga-engine.js';
import { getNovelParagraphs, insertPlaceholders, injectTranslation } from './novel-engine.js';

/**
 * 啟動行動端專用 UI 系統 (Overlay Drawer 模式)
 */
export function initMobileMode() {
  log.info('Content-Mobile', 'Initializing Mobile Overlay Drawer...');

  // 1. 小說模式連動：自動更新段落翻譯結果
  state.onChanged((changes) => {
    if (changes.novelResults) {
        const results = changes.novelResults.newValue;
        log.info('Content-Mobile', `收到小說翻譯更新，結果筆數: ${results?.length || 0}`);
        if (results && results.length > 0) {
            const lastResult = results[results.length - 1];
            log.info('Content-Mobile', `嘗試注入第 ${lastResult.idx} 段翻譯`);
            if (!lastResult.isManga) {
                injectTranslation(lastResult.idx, lastResult.translation);
            }
        }
    }
  });

  // 1. 建立 Shadow DOM 容器
  const container = document.createElement('div');
  container.id = 'mt-mobile-root';
  document.body.appendChild(container);
  const shadow = container.attachShadow({ mode: 'open' });

  // 2. 注入所有樣式 (按鈕 + 抽屜面板)
  const style = document.createElement('style');
  style.textContent = `
    :host {
      --edge-blue: #0078d4;
      --bg-acrylic: rgba(255, 255, 255, 0.85);
      --text-main: #242424;
      --radius: 12px;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg-acrylic: rgba(35, 35, 35, 0.9);
        --text-main: #ffffff;
      }
    }

    /* 懸浮按鈕 */
    .trigger-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 28px;
      background: var(--edge-blue);
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2147483646;
      border: none;
      transition: transform 0.2s;
    }
    .trigger-btn:active { transform: scale(0.9); }
    .trigger-btn svg { width: 28px; height: 28px; fill: white; }

    /* 抽屜面板背景遮罩 */
    .drawer-overlay {
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.4);
      z-index: 2147483647;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s;
    }
    .drawer-overlay.active {
      opacity: 1;
      visibility: visible;
    }

    /* 抽屜面板本體 */
    .drawer {
      position: fixed;
      bottom: 0; left: 0; width: 100%;
      height: 70vh;
      background: var(--bg-acrylic);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 20px 20px 0 0;
      z-index: 2147483648;
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      color: var(--text-main);
      box-shadow: 0 -8px 24px rgba(0,0,0,0.2);
    }
    .drawer.active { transform: translateY(0); }

    /* 面板頭部 */
    .drawer-header {
      padding: 16px;
      border-bottom: 1px solid rgba(128,128,128,0.2);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .drawer-header h2 { margin: 0; font-size: 18px; }
    .close-btn { background: none; border: none; color: var(--text-main); font-size: 24px; cursor: pointer; }

    /* 內容區 */
    .drawer-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    .image-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 12px;
    }
    .img-item {
      aspect-ratio: 3/4;
      background: rgba(128,128,128,0.1);
      border-radius: 8px;
      overflow: hidden;
      border: 3px solid transparent;
      position: relative;
    }
    .img-item img { width: 100%; height: 100%; object-fit: cover; }
    .img-item.selected { border-color: var(--edge-blue); }
    .img-item.selected::after {
      content: "✓";
      position: absolute; top: 4px; right: 4px;
      background: var(--edge-blue); color: white;
      width: 20px; height: 20px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: bold;
    }

    /* 底部操作 */
    .drawer-footer {
      padding: 16px;
      border-top: 1px solid rgba(128,128,128,0.2);
    }
    .primary-btn {
      width: 100%;
      background: var(--edge-blue);
      color: white;
      border: none;
      padding: 14px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
    }
    .primary-btn:disabled { opacity: 0.5; }
  `;
  shadow.appendChild(style);

  // 3. 建立 UI 結構
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';

  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  drawer.innerHTML = `
    <div class="drawer-header">
      <h2>🎌 漫譯 V2 控制台</h2>
      <button class="close-btn">&times;</button>
    </div>
    <div class="drawer-content">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div id="status-text" style="font-size:14px; opacity:0.7;">正在掃描圖片...</div>
        <div class="bulk-actions" style="display:flex; gap:8px;">
          <button id="select-all-btn" style="background:none; border:1px solid var(--edge-blue); color:var(--edge-blue); font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">全選</button>
          <button id="deselect-all-btn" style="background:none; border:1px solid rgba(128,128,128,0.5); color:var(--text-main); font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">取消</button>
        </div>
      </div>
      <div class="image-grid" id="drawer-grid"></div>
    </div>
    <div class="drawer-footer">
      <button class="primary-btn" id="drawer-submit" disabled>開始翻譯 (0)</button>
    </div>
  `;

  const triggerBtn = document.createElement('button');
  triggerBtn.className = 'trigger-btn';
  triggerBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;

  shadow.appendChild(overlay);
  shadow.appendChild(drawer);
  shadow.appendChild(triggerBtn);

  // 4. 邏輯控制
  let foundImages = [];
  const selectedIndices = new Set();

  const toggleDrawer = (active) => {
    overlay.classList.toggle('active', active);
    drawer.classList.toggle('active', active);
    if (active) scanImages();
  };

  const scanImages = () => {
    const statusText = drawer.querySelector('#status-text');
    const grid = drawer.querySelector('#drawer-grid');
    statusText.textContent = '正在掃描圖片...';
    grid.innerHTML = '';
    
    const images = crawlImages();
    foundImages = images;
    
    if (images.length === 0) {
      const paragraphs = getNovelParagraphs();
      if (paragraphs.length > 0) {
        statusText.textContent = `偵測到 ${paragraphs.length} 段小說內容`;
        grid.innerHTML = `
          <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 16px;">📖</div>
            <div style="color: var(--text-main); margin-bottom: 24px;">這看起來是一篇小說，是否要開始翻譯？</div>
            <button id="start-novel-btn" style="background: var(--edge-blue); color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%;">
              開始全頁翻譯
            </button>
          </div>
        `;
        grid.querySelector('#start-novel-btn').onclick = () => {
          toggleDrawer(false);
          startNovelTranslation();
        };
      } else {
        statusText.textContent = '未找到可翻譯內容';
      }
      updateFooter();
      return;
    }
    
    statusText.textContent = `找到 ${images.length} 張圖片`;
    
    // 預設全選
    selectedIndices.clear();
    images.forEach((_, i) => selectedIndices.add(i));

    images.forEach((img, i) => {
      const item = document.createElement('div');
      item.className = 'img-item selected'; // 預設加上 selected class
      item.innerHTML = `<img src="${img.src}" loading="lazy" referrerpolicy="no-referrer" style="width:100%; height:100%; object-fit:cover;">`;
      item.onclick = () => {
        if (selectedIndices.has(i)) {
          selectedIndices.delete(i);
          item.classList.remove('selected');
        } else {
          selectedIndices.add(i);
          item.classList.add('selected');
        }
        updateFooter();
      };
      grid.appendChild(item);
    });
    updateFooter();
  };

  const selectAll = () => {
    foundImages.forEach((_, i) => selectedIndices.add(i));
    drawer.querySelectorAll('.img-item').forEach(el => el.classList.add('selected'));
    updateFooter();
  };

  const deselectAll = () => {
    selectedIndices.clear();
    drawer.querySelectorAll('.img-item').forEach(el => el.classList.remove('selected'));
    updateFooter();
  };

  const updateFooter = () => {
    const btn = drawer.querySelector('#drawer-submit');
    btn.disabled = selectedIndices.size === 0;
    btn.textContent = `開始翻譯 (${selectedIndices.size})`;
  };

  // 事件綁定
  triggerBtn.onclick = () => toggleDrawer(true);
  overlay.onclick = () => toggleDrawer(false);
  drawer.querySelector('.close-btn').onclick = () => toggleDrawer(false);
  drawer.querySelector('#select-all-btn').onclick = selectAll;
  drawer.querySelector('#deselect-all-btn').onclick = deselectAll;
  
  drawer.querySelector('#drawer-submit').onclick = () => {
    const selected = Array.from(selectedIndices).map(i => foundImages[i]);
    if (selected.length === 0) return;
    
    toggleDrawer(false);
    chrome.runtime.sendMessage({ 
      action: 'START_MANGA_BATCH_PC_MODE', 
      payload: { 
        images: selected,
        mobile: true // 強制標記為行動端
      } 
    });
  };

  // 監聽背景訊息 (支援小說模式)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translateNovelPage' || request.action === 'AUTO_TRANSLATE_PAGE') {
        startNovelTranslation();
        sendResponse({ started: true });
    }
  });

  function startNovelTranslation() {
    const paragraphs = getNovelParagraphs();
    if (paragraphs.length === 0) return;
    
    // 清除舊狀態，準備新翻譯
    chrome.storage.local.set({ 
        novelResults: [],
        novelQueue: [],
        isProcessingNovel: false 
    }, () => {
        insertPlaceholders(paragraphs);
        const texts = paragraphs.map(p => p.textContent.trim());
        chrome.runtime.sendMessage({
            action: 'ADD_TO_QUEUE',
            payload: {
                // 不傳 tabId，讓背景腳本自動抓 sender.tab.id
                startIndex: 0,
                texts: texts
            }
        });
    });
  }

  log.info('Content-Mobile', 'Mobile Overlay Drawer ready.');
}
