// background.js

let attachedTabs = {}; // { tabId: true }
let screenshotInProgress = {}; // { tabId: true }防止重复点击

// --- 配置项 ---
const PRE_CAPTURE_DELAY_MS = 1500; // 实况照片/动态内容等待
const VERY_LARGE_PAGE_HEIGHT_LIMIT = 100000; // "完整页面" 时，过高则截断

// 辅助函数：清理文件名
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/ /g, '_');
}

// 主要监听器，接收来自 popup.js 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startCapture') {
    const { tabId, options } = request;
    console.log(`[BG] Received capture request for tab ${tabId}`, options);

    if (!tabId) {
      console.error("[BG] Tab ID missing in request.");
      sendResponse({ success: false, error: "Tab ID 丢失" });
      return true;
    }

    if (screenshotInProgress[tabId]) {
      console.warn(`[BG] Screenshot already in progress for tab ${tabId}.`);
      sendResponse({ success: false, error: "截图已在进行中，请稍候" });
      return true;
    }
    screenshotInProgress[tabId] = true;

    performScreenshot(tabId, options)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error(`[BG] Screenshot failed for tab ${tabId}:`, err);
        sendResponse({ success: false, error: err.message || "未知截图错误" });
      })
      .finally(() => {
        delete screenshotInProgress[tabId];
        console.log(`[BG] Screenshot process finished for tab ${tabId}.`);
      });
    return true; // 表示我们将异步响应
  }
});

async function performScreenshot(tabId, options) {
  let debuggerAttachedThisSession = false;
  const debuggee = { tabId: tabId };

  try {
    const tab = await chrome.tabs.get(tabId); // 获取最新tab信息

    // 对于 “当前可见区域”，使用简单API
    if (options.type === 'visible') {
      console.log(`[BG] Capturing visible area for tab ${tabId}`);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const pageTitle = tab.title ? sanitizeFilename(tab.title) : "screenshot_visible";
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${pageTitle}_Visible_${timestamp}.png`;
      chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: true });
      return; // 完成，直接返回
    }

    // --- 以下为需要 Debugger API 的截图类型 ---

    // 1. 附加调试器 (如果尚未附加)
    if (!attachedTabs[tabId]) {
      console.log(`[BG] Attaching debugger to tab ${tabId}`);
      await chrome.debugger.attach(debuggee, "1.3");
      attachedTabs[tabId] = true;
      debuggerAttachedThisSession = true; // 标记本次会话中附加了它
      console.log(`[BG] Debugger attached to tab ${tabId}`);
    } else {
      console.log(`[BG] Debugger already attached to tab ${tabId}`);
    }

    // 2. 预捕获延迟 (解决动态内容问题)
    if (PRE_CAPTURE_DELAY_MS > 0) {
      console.log(`[BG] Waiting ${PRE_CAPTURE_DELAY_MS}ms for page to stabilize...`);
      await new Promise(resolve => setTimeout(resolve, PRE_CAPTURE_DELAY_MS));
    }

    // 3. 获取页面和视口尺寸
    // 使用 scripting API 获取页面内的尺寸信息
    const [injectionResults] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        return {
          pageFullWidth: document.documentElement.scrollWidth,
          pageFullHeight: document.documentElement.scrollHeight,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      }
    });
    if (!injectionResults || !injectionResults.result) {
        throw new Error("无法获取页面尺寸信息。");
    }
    const pageMetrics = injectionResults.result;
    console.log("[BG] Page metrics from content script:", pageMetrics);


    // 4. 计算截图最终的宽度和高度
    let captureWidth = pageMetrics.pageFullWidth; // 通常是完整宽度
    let captureHeight;
    let filenameSuffix = "Screenshot";

    const layoutMetricsCDP = await chrome.debugger.sendCommand(debuggee, "Page.getLayoutMetrics");
    const contentWidthCDP = Math.ceil(layoutMetricsCDP.contentSize.width);
    const contentHeightCDP = Math.ceil(layoutMetricsCDP.contentSize.height);
    console.log(`[BG] CDP LayoutMetrics: content ${contentWidthCDP}x${contentHeightCDP}`);

    //优先使用CDP获取的宽度，因为它通常更准确（考虑了滚动条等）
    captureWidth = contentWidthCDP > 0 ? contentWidthCDP : pageMetrics.pageFullWidth;

    switch (options.type) {
      case 'full':
        captureHeight = contentHeightCDP;
        if (captureHeight > VERY_LARGE_PAGE_HEIGHT_LIMIT) {
          console.warn(`[BG] Full page height ${captureHeight}px (CDP) exceeds limit ${VERY_LARGE_PAGE_HEIGHT_LIMIT}px. Truncating.`);
          captureHeight = VERY_LARGE_PAGE_HEIGHT_LIMIT;
          filenameSuffix = `FullPage_UpTo${captureHeight}px`;
        } else {
          filenameSuffix = `FullPage_${captureHeight}px`;
        }
        break;
      case 'customHeight':
        captureHeight = options.height;
        // 确保不超过页面实际高度 (如果页面较短) 或超大上限
        if (captureHeight > contentHeightCDP && contentHeightCDP > 0) captureHeight = contentHeightCDP;
        if (captureHeight > VERY_LARGE_PAGE_HEIGHT_LIMIT) captureHeight = VERY_LARGE_PAGE_HEIGHT_LIMIT;
        filenameSuffix = `CustomHeight_${captureHeight}px`;
        break;
      case 'screens':
        const vpHeight = pageMetrics.viewportHeight || 800; // Fallback
        captureHeight = vpHeight * options.screens;
        if (captureHeight > contentHeightCDP && contentHeightCDP > 0) captureHeight = contentHeightCDP;
        if (captureHeight > VERY_LARGE_PAGE_HEIGHT_LIMIT) captureHeight = VERY_LARGE_PAGE_HEIGHT_LIMIT;
        filenameSuffix = `${options.screens}Screens_${captureHeight}px`;
        break;
      default:
        throw new Error(`[BG] Unknown capture type: ${options.type}`);
    }

    if (!captureWidth || !captureHeight || captureWidth <=0 || captureHeight <=0) {
        throw new Error(`[BG] Invalid capture dimensions: ${captureWidth}x${captureHeight}. Check page content.`);
    }

    console.log(`[BG] Final capture dimensions: ${captureWidth} x ${captureHeight}`);

    // 5. 设置模拟设备尺寸
    await chrome.debugger.sendCommand(debuggee, "Emulation.setDeviceMetricsOverride", {
      width: captureWidth,
      height: captureHeight,
      deviceScaleFactor: 1,
      mobile: false,
      scale: 1
    });
    console.log("[BG] Emulation.setDeviceMetricsOverride sent.");
    await new Promise(resolve => setTimeout(resolve, 250)); // 给 override 一点时间生效

    // 6. 执行截图
    const screenshotResult = await chrome.debugger.sendCommand(debuggee, "Page.captureScreenshot", {
      format: "png",
      quality: 90, // PNG质量参数通常被忽略，但保留无妨
      captureBeyondViewport: true,
      fromSurface: true, // 推荐使用 true
      clip: {
        x: 0,
        y: 0,
        width: captureWidth,
        height: captureHeight,
        scale: 1
      }
    });
    console.log("[BG] Page.captureScreenshot received.");

    // 7. 清除模拟
    await chrome.debugger.sendCommand(debuggee, "Emulation.clearDeviceMetricsOverride");
    console.log("[BG] Emulation.clearDeviceMetricsOverride sent.");

    // 8. 下载图片
    const dataUrl = "data:image/png;base64," + screenshotResult.data;
    const pageTitle = tab.title ? sanitizeFilename(tab.title) : "screenshot";
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${pageTitle}_${filenameSuffix}_${timestamp}.png`;

    console.log("[BG] Triggering download:", filename);
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    }, downloadId => {
      if (chrome.runtime.lastError) {
        console.error("[BG] Download initiation failed:", chrome.runtime.lastError.message);
        // 可以考虑向popup发送一个后续消息通知下载失败，但当前popup可能已关闭
      } else if (downloadId) {
        console.log("[BG] Download started with ID:", downloadId);
      } else {
        console.warn("[BG] Download did not start, no downloadId returned.");
      }
    });

  } catch (e) {
    console.error("[BG] Error in performScreenshot:", e);
    let detailedMessage = e.message || "未知错误";
    if (e.message && e.message.includes("Target closed")) {
        detailedMessage = "目标页面已关闭或导航，无法截图。";
        // 如果是因为页面关闭导致debugger出错，尝试清理状态
        if (attachedTabs[tabId]) {
            delete attachedTabs[tabId];
        }
    } else if (e.message && (e.message.includes("Cannot access a chrome:// URL") || e.message.includes("Cannot access a file:// URL"))) {
        detailedMessage = "无法在此类受保护的页面截图。";
    } else if (e.message && e.message.includes("No tab with id")) {
        detailedMessage = "找不到指定标签页，可能已关闭。";
    }
    throw new Error(detailedMessage); // 抛出给 onMessage 的 catch 处理
  } finally {
    // 9. 分离调试器 (只有当本次会话附加了它，并且它仍然在 attachedTabs 中时)
    // 注意：如果用户在截图过程中关闭了tab，detach可能会失败或不必要
    if (debuggerAttachedThisSession && attachedTabs[tabId]) {
      try {
        console.log(`[BG] Detaching debugger from tab ${tabId}`);
        await chrome.debugger.detach(debuggee);
      } catch (detachError) {
        console.warn(`[BG] Failed to detach debugger from tab ${tabId} (might be ok if tab closed):`, detachError.message);
      } finally {
        delete attachedTabs[tabId]; // 确保状态被清理
        console.log(`[BG] Debugger detached and state cleaned for tab ${tabId}`);
      }
    } else if (!attachedTabs[tabId] && debuggerAttachedThisSession) {
        // 这说明在 finally 之前 target closed 错误已经清理了 attachedTabs[tabId]
        console.log(`[BG] Debugger state for tab ${tabId} was already cleaned (likely due to target closed).`);
    }
  }
}

// 当标签页更新或移除时，清理可能残留的调试器状态
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 如果页面正在加载新内容 (可能导致旧的 debugger 会话失效)
  // 或者状态变为 complete 但之前有 debugger 附加 (如SPA导航)
  if (changeInfo.status === 'loading' && attachedTabs[tabId]) {
    console.log(`[BG] Tab ${tabId} updated (status: ${changeInfo.status}), detaching debugger if attached.`);
    chrome.debugger.detach({ tabId: tabId }).catch(e => {
      console.warn(`[BG] Failed to detach debugger on tab update for ${tabId}: ${e.message}`);
    }).finally(() => {
      delete attachedTabs[tabId];
      delete screenshotInProgress[tabId];
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabs[tabId]) {
    console.log(`[BG] Tab ${tabId} removed, cleaning up debugger state.`);
    // Debugger 会自动因 tab 关闭而分离，这里主要是清理我们的记录
    delete attachedTabs[tabId];
    delete screenshotInProgress[tabId];
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("[BG] Extension installed.");
  } else if (details.reason === "update") {
    console.log(`[BG] Extension updated from ${details.previousVersion} to ${chrome.runtime.getManifest().version}.`);
  }
});

console.log("[BG] Background script loaded and ready.");

