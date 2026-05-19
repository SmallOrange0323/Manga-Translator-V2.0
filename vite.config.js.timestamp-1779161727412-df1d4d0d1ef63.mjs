// vite.config.js
import { defineConfig } from "file:///E:/OneDrive%20-%20%E5%AF%B0%E5%AE%87%E7%9F%A5%E8%AD%98%E7%A7%91%E6%8A%80%E8%82%A1%E4%BB%BD%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8/Manga%20Translator%20V2.0/node_modules/vite/dist/node/index.js";
import { crx } from "file:///E:/OneDrive%20-%20%E5%AF%B0%E5%AE%87%E7%9F%A5%E8%AD%98%E7%A7%91%E6%8A%80%E8%82%A1%E4%BB%BD%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8/Manga%20Translator%20V2.0/node_modules/@crxjs/vite-plugin/dist/index.mjs";

// manifest.json
var manifest_default = {
  manifest_version: 3,
  name: "Manga Translator V2.0",
  version: "2.2.12",
  description: "Modernized Manga Translator with Storage-First Architecture",
  permissions: [
    "storage",
    "sidePanel",
    "tabs",
    "activeTab",
    "scripting",
    "contextMenus"
  ],
  host_permissions: [
    "<all_urls>"
  ],
  background: {
    service_worker: "src/background/index.js",
    type: "module"
  },
  content_scripts: [
    {
      js: ["src/content/main.js"],
      matches: ["<all_urls>"]
    }
  ],
  side_panel: {
    default_path: "src/sidepanel/index.html"
  },
  options_ui: {
    page: "src/options/index.html",
    open_in_tab: true
  },
  web_accessible_resources: [
    {
      resources: [
        "icon128.png",
        "src/mobile/index.html",
        "src/popup/index.html",
        "src/popup/main.js"
      ],
      matches: [
        "<all_urls>"
      ]
    }
  ],
  action: {
    default_title: "\u6F2B\u8B6F V2.0",
    default_popup: "src/popup/index.html"
  },
  icons: {
    "128": "icon128.png"
  }
};

// vite.config.js
import { resolve } from "path";
import { cp } from "fs/promises";
var __vite_injected_original_dirname = "E:\\OneDrive - \u5BF0\u5B87\u77E5\u8B58\u79D1\u6280\u80A1\u4EFD\u6709\u9650\u516C\u53F8\\Manga Translator V2.0";
function copyAssetsPlugin() {
  return {
    name: "copy-assets",
    async closeBundle() {
      const src = resolve(__vite_injected_original_dirname, "public/assets");
      const dest = resolve(__vite_injected_original_dirname, "dist/assets");
      try {
        await cp(src, dest, { recursive: true, force: true });
        console.log("[copy-assets] \u2705 public/assets \u2192 dist/assets \u8907\u88FD\u5B8C\u6210");
      } catch (e) {
        console.warn("[copy-assets] \u26A0\uFE0F \u8907\u88FD\u5931\u6557:", e.message);
      }
    }
  };
}
var vite_config_default = defineConfig({
  plugins: [crx({ manifest: manifest_default }), copyAssetsPlugin()],
  build: {
    // 確保輸出的 JS 檔案不會太分散，利於 Chrome 載入
    rollupOptions: {
      input: {
        reader: "src/reader/result.html",
        mobile: "src/mobile/index.html"
      },
      output: {
        manualChunks: void 0
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiLCAibWFuaWZlc3QuanNvbiJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkU6XFxcXE9uZURyaXZlIC0gXHU1QkYwXHU1Qjg3XHU3N0U1XHU4QjU4XHU3OUQxXHU2MjgwXHU4MEExXHU0RUZEXHU2NzA5XHU5NjUwXHU1MTZDXHU1M0Y4XFxcXE1hbmdhIFRyYW5zbGF0b3IgVjIuMFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRTpcXFxcT25lRHJpdmUgLSBcdTVCRjBcdTVCODdcdTc3RTVcdThCNThcdTc5RDFcdTYyODBcdTgwQTFcdTRFRkRcdTY3MDlcdTk2NTBcdTUxNkNcdTUzRjhcXFxcTWFuZ2EgVHJhbnNsYXRvciBWMi4wXFxcXHZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9FOi9PbmVEcml2ZSUyMC0lMjAlRTUlQUYlQjAlRTUlQUUlODclRTclOUYlQTUlRTglQUQlOTglRTclQTclOTElRTYlOEElODAlRTglODIlQTElRTQlQkIlQkQlRTYlOUMlODklRTklOTklOTAlRTUlODUlQUMlRTUlOEYlQjgvTWFuZ2ElMjBUcmFuc2xhdG9yJTIwVjIuMC92aXRlLmNvbmZpZy5qc1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xuaW1wb3J0IHsgY3J4IH0gZnJvbSAnQGNyeGpzL3ZpdGUtcGx1Z2luJztcbmltcG9ydCBtYW5pZmVzdCBmcm9tICcuL21hbmlmZXN0Lmpzb24nO1xuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgY3AgfSBmcm9tICdmcy9wcm9taXNlcyc7XG5cbi8qKlxuICogY29weUFzc2V0c1BsdWdpbiBcdTIwMTQgYnVpbGQgXHU1QjhDXHU2MjEwXHU1RjhDXHU2MjhBIHB1YmxpYy9hc3NldHMvIFx1ODkwN1x1ODhGRFx1NTIzMCBkaXN0L2Fzc2V0cy9cbiAqIFx1OEI5MyBjaHJvbWUucnVudGltZS5nZXRVUkwoJ2Fzc2V0cy8uLi4nKSBcdTU3MjggZGlzdCBcdTcyNDhcdTY3MkNcdTRFMkRcdTUzRUZcdTRFRTVcdTZCNjNcdTc4QkFcdThCODBcdTUyMzBcdTdEMjBcdTY3NTBcbiAqL1xuZnVuY3Rpb24gY29weUFzc2V0c1BsdWdpbigpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBuYW1lOiAnY29weS1hc3NldHMnLFxuICAgICAgICBhc3luYyBjbG9zZUJ1bmRsZSgpIHtcbiAgICAgICAgICAgIGNvbnN0IHNyYyA9IHJlc29sdmUoX19kaXJuYW1lLCAncHVibGljL2Fzc2V0cycpO1xuICAgICAgICAgICAgY29uc3QgZGVzdCA9IHJlc29sdmUoX19kaXJuYW1lLCAnZGlzdC9hc3NldHMnKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgY3Aoc3JjLCBkZXN0LCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tjb3B5LWFzc2V0c10gXHUyNzA1IHB1YmxpYy9hc3NldHMgXHUyMTkyIGRpc3QvYXNzZXRzIFx1ODkwN1x1ODhGRFx1NUI4Q1x1NjIxMCcpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignW2NvcHktYXNzZXRzXSBcdTI2QTBcdUZFMEYgXHU4OTA3XHU4OEZEXHU1OTMxXHU2NTU3OicsIGUubWVzc2FnZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbY3J4KHsgbWFuaWZlc3QgfSksIGNvcHlBc3NldHNQbHVnaW4oKV0sXG4gIGJ1aWxkOiB7XG4gICAgLy8gXHU3OEJBXHU0RkREXHU4RjM4XHU1MUZBXHU3Njg0IEpTIFx1NkE5NFx1Njg0OFx1NEUwRFx1NjcwM1x1NTkyQVx1NTIwNlx1NjU2M1x1RkYwQ1x1NTIyOVx1NjVCQyBDaHJvbWUgXHU4RjA5XHU1MTY1XG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgaW5wdXQ6IHtcbiAgICAgICAgcmVhZGVyOiAnc3JjL3JlYWRlci9yZXN1bHQuaHRtbCcsXG4gICAgICAgIG1vYmlsZTogJ3NyYy9tb2JpbGUvaW5kZXguaHRtbCdcbiAgICAgIH0sXG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgbWFudWFsQ2h1bmtzOiB1bmRlZmluZWQsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG59KTtcbiIsICJ7XHJcbiAgXCJtYW5pZmVzdF92ZXJzaW9uXCI6IDMsXHJcbiAgXCJuYW1lXCI6IFwiTWFuZ2EgVHJhbnNsYXRvciBWMi4wXCIsXHJcbiAgXCJ2ZXJzaW9uXCI6IFwiMi4yLjEyXCIsXHJcbiAgXCJkZXNjcmlwdGlvblwiOiBcIk1vZGVybml6ZWQgTWFuZ2EgVHJhbnNsYXRvciB3aXRoIFN0b3JhZ2UtRmlyc3QgQXJjaGl0ZWN0dXJlXCIsXHJcbiAgXCJwZXJtaXNzaW9uc1wiOiBbXHJcbiAgICBcInN0b3JhZ2VcIixcclxuICAgIFwic2lkZVBhbmVsXCIsXHJcbiAgICBcInRhYnNcIixcclxuICAgIFwiYWN0aXZlVGFiXCIsXHJcbiAgICBcInNjcmlwdGluZ1wiLFxyXG4gICAgXCJjb250ZXh0TWVudXNcIlxyXG4gIF0sXHJcbiAgXCJob3N0X3Blcm1pc3Npb25zXCI6IFtcclxuICAgIFwiPGFsbF91cmxzPlwiXHJcbiAgXSxcclxuICBcImJhY2tncm91bmRcIjoge1xyXG4gICAgXCJzZXJ2aWNlX3dvcmtlclwiOiBcInNyYy9iYWNrZ3JvdW5kL2luZGV4LmpzXCIsXHJcbiAgICBcInR5cGVcIjogXCJtb2R1bGVcIlxyXG4gIH0sXHJcbiAgXCJjb250ZW50X3NjcmlwdHNcIjogW1xyXG4gICAge1xyXG4gICAgICBcImpzXCI6IFtcInNyYy9jb250ZW50L21haW4uanNcIl0sXHJcbiAgICAgIFwibWF0Y2hlc1wiOiBbXCI8YWxsX3VybHM+XCJdXHJcbiAgICB9XHJcbiAgXSxcclxuICBcInNpZGVfcGFuZWxcIjoge1xyXG4gICAgXCJkZWZhdWx0X3BhdGhcIjogXCJzcmMvc2lkZXBhbmVsL2luZGV4Lmh0bWxcIlxyXG4gIH0sXHJcbiAgXCJvcHRpb25zX3VpXCI6IHtcclxuICAgIFwicGFnZVwiOiBcInNyYy9vcHRpb25zL2luZGV4Lmh0bWxcIixcclxuICAgIFwib3Blbl9pbl90YWJcIjogdHJ1ZVxyXG4gIH0sXHJcbiAgXCJ3ZWJfYWNjZXNzaWJsZV9yZXNvdXJjZXNcIjogW1xyXG4gICAge1xyXG4gICAgICBcInJlc291cmNlc1wiOiBbXHJcbiAgICAgICAgXCJpY29uMTI4LnBuZ1wiLFxyXG4gICAgICAgIFwic3JjL21vYmlsZS9pbmRleC5odG1sXCIsXHJcbiAgICAgICAgXCJzcmMvcG9wdXAvaW5kZXguaHRtbFwiLFxyXG4gICAgICAgIFwic3JjL3BvcHVwL21haW4uanNcIlxyXG4gICAgICBdLFxyXG4gICAgICBcIm1hdGNoZXNcIjogW1xyXG4gICAgICAgIFwiPGFsbF91cmxzPlwiXHJcbiAgICAgIF1cclxuICAgIH1cclxuICBdLFxyXG4gIFwiYWN0aW9uXCI6IHtcclxuICAgIFwiZGVmYXVsdF90aXRsZVwiOiBcIlx1NkYyQlx1OEI2RiBWMi4wXCIsXHJcbiAgICBcImRlZmF1bHRfcG9wdXBcIjogXCJzcmMvcG9wdXAvaW5kZXguaHRtbFwiXHJcbiAgfSxcclxuICBcImljb25zXCI6IHtcclxuICAgIFwiMTI4XCI6IFwiaWNvbjEyOC5wbmdcIlxyXG4gIH1cclxufVxyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQWdiLFNBQVMsb0JBQW9CO0FBQzdjLFNBQVMsV0FBVzs7O0FDRHBCO0FBQUEsRUFDRSxrQkFBb0I7QUFBQSxFQUNwQixNQUFRO0FBQUEsRUFDUixTQUFXO0FBQUEsRUFDWCxhQUFlO0FBQUEsRUFDZixhQUFlO0FBQUEsSUFDYjtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUFBLEVBQ0Esa0JBQW9CO0FBQUEsSUFDbEI7QUFBQSxFQUNGO0FBQUEsRUFDQSxZQUFjO0FBQUEsSUFDWixnQkFBa0I7QUFBQSxJQUNsQixNQUFRO0FBQUEsRUFDVjtBQUFBLEVBQ0EsaUJBQW1CO0FBQUEsSUFDakI7QUFBQSxNQUNFLElBQU0sQ0FBQyxxQkFBcUI7QUFBQSxNQUM1QixTQUFXLENBQUMsWUFBWTtBQUFBLElBQzFCO0FBQUEsRUFDRjtBQUFBLEVBQ0EsWUFBYztBQUFBLElBQ1osY0FBZ0I7QUFBQSxFQUNsQjtBQUFBLEVBQ0EsWUFBYztBQUFBLElBQ1osTUFBUTtBQUFBLElBQ1IsYUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSwwQkFBNEI7QUFBQSxJQUMxQjtBQUFBLE1BQ0UsV0FBYTtBQUFBLFFBQ1g7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBQUEsTUFDQSxTQUFXO0FBQUEsUUFDVDtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBVTtBQUFBLElBQ1IsZUFBaUI7QUFBQSxJQUNqQixlQUFpQjtBQUFBLEVBQ25CO0FBQUEsRUFDQSxPQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsRUFDVDtBQUNGOzs7QURsREEsU0FBUyxlQUFlO0FBQ3hCLFNBQVMsVUFBVTtBQUpuQixJQUFNLG1DQUFtQztBQVV6QyxTQUFTLG1CQUFtQjtBQUN4QixTQUFPO0FBQUEsSUFDSCxNQUFNO0FBQUEsSUFDTixNQUFNLGNBQWM7QUFDaEIsWUFBTSxNQUFNLFFBQVEsa0NBQVcsZUFBZTtBQUM5QyxZQUFNLE9BQU8sUUFBUSxrQ0FBVyxhQUFhO0FBQzdDLFVBQUk7QUFDQSxjQUFNLEdBQUcsS0FBSyxNQUFNLEVBQUUsV0FBVyxNQUFNLE9BQU8sS0FBSyxDQUFDO0FBQ3BELGdCQUFRLElBQUksZ0ZBQWtEO0FBQUEsTUFDbEUsU0FBUyxHQUFHO0FBQ1IsZ0JBQVEsS0FBSyx3REFBMEIsRUFBRSxPQUFPO0FBQUEsTUFDcEQ7QUFBQSxJQUNKO0FBQUEsRUFDSjtBQUNKO0FBRUEsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLElBQUksRUFBRSwyQkFBUyxDQUFDLEdBQUcsaUJBQWlCLENBQUM7QUFBQSxFQUMvQyxPQUFPO0FBQUE7QUFBQSxJQUVMLGVBQWU7QUFBQSxNQUNiLE9BQU87QUFBQSxRQUNMLFFBQVE7QUFBQSxRQUNSLFFBQVE7QUFBQSxNQUNWO0FBQUEsTUFDQSxRQUFRO0FBQUEsUUFDTixjQUFjO0FBQUEsTUFDaEI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
