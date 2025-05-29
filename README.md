# screenshot-extension
一个 浏览器扩展，提供强大的截图功能，包括全屏滚动截图和自定义区域截图。
# 高级截图工具 (Advanced Screenshot Tool)

版本: 1.2

一个浏览器扩展，提供强大的截图功能，包括全屏滚动截图和自定义区域截图。

## 🚀 安装与使用

### 手动加载 (开发者模式)

1.  **下载或克隆项目:**
    *   如果您从 GitHub 下载的是 ZIP 文件，请先解压。
    *   或者使用 Git 克隆: `git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git`
    *   将 `YOUR_USERNAME/YOUR_REPOSITORY_NAME` 替换为实际的仓库地址。

2.  **打开 Chrome 扩展管理页面:**
    *   在 Chrome 浏览器地址栏输入 `chrome://extensions` 并回车。
    *   如果为Edge浏览器,请替换为`edge://extensions`

3.  **开启开发者模式:**
    *   在扩展管理页面的右上角，找到并打开 **开发者模式 (Developer mode)** 的开关。

4.  **加载已解压的扩展程序:**
    *   点击左上角的 **加载已解压的扩展程序 (Load unpacked)** 按钮。
    *   在弹出的文件选择对话框中，选择你刚刚下载并解压（或克隆）的项目文件夹 (即包含 `manifest.json` 文件的那个文件夹，例如 `project_screenshot-extension`)。

5.  **完成安装:**
    *   如果一切顺利，“高级截图工具”将出现在您的扩展列表中，并且其图标会显示在 Chrome 浏览器的工具栏上。

### 使用方法

1.  导航到您想要截图的网页。
2.  点击浏览器工具栏上的“高级截图工具”图标 ![工具栏图标](images/icon16.png) (如果图标未显示，请检查Chrome扩展管理页面是否已启用本扩展，并固定到工具栏)。
3.  在弹出的菜单中选择：
    *   **截取整个页面 (Capture Full Page):** 扩展将自动滚动并捕获整个网页内容。
    *   **截取自定义区域 (Capture Custom Area):**
        *   页面上会显示一个提示或者鼠标指针会发生变化。
        *   按住鼠标左键并拖拽，选择您想要截取的区域。
        *   松开鼠标左键，选定区域将被捕获。
4.  截图完成后，图片通常会自动下载到您的浏览器的默认下载文件夹。部分实现可能会先提供预览。


## ✨ 功能特性

*   **全屏滚动截图 (Long Screenshot):** 轻松捕捉整个网页内容，即使它超出了当前可见区域。
*   **自定义区域截图 (Custom Area Screenshot):** 通过拖拽选择屏幕上的任意矩形区域进行截图。
*   **即时预览与下载:** 截图完成后可立即预览（或直接下载，取决于具体实现），并方便地下载到本地。
*   **简洁的用户界面:** 通过浏览器工具栏图标的弹出窗口进行操作，简单直观。

## 🛠️ 实现原理

本扩展基于 Manifest V3 标准构建。

1.  **`manifest.json`**:
    *   定义了扩展的基本信息、权限、背景脚本、弹出窗口等。
    *   关键权限：
        *   `activeTab`: 允许扩展在用户与扩展交互时访问当前活动标签页。
        *   `debugger`: **核心权限**，用于实现**全屏滚动截图**。通过 Chrome DevTools Protocol (CDP) 的 `Page.captureScreenshot` 命令，并设置 `captureBeyondViewport: true` 来捕获整个可滚动页面。
        *   `downloads`: 允许扩展将截图文件下载到用户的计算机。
        *   `scripting`: 用于在活动标签页中执行脚本，例如获取页面尺寸用于全屏截图，或注入内容脚本以实现自定义区域选择。

2.  **`popup.html` & `popup.js`**:
    *   当用户点击浏览器工具栏上的扩展图标时，会显示 `popup.html`。
    *   `popup.js` 处理弹出窗口中的用户交互（例如点击“截取全屏”或“截取区域”按钮）。
    *   它通过 `chrome.runtime.sendMessage` 向 `background.js` 发送消息，请求执行相应的截图操作。

3.  **`background.js` (Service Worker)**:
    *   作为扩展的后台服务工作线程，常驻运行。
    *   监听来自 `popup.js` 的消息。
    *   **全屏滚动截图流程**:
        1.  接收到请求后，获取当前活动标签页。
        2.  使用 `chrome.debugger.attach` 附加到该标签页。
        3.  通过 `chrome.debugger.sendCommand` 发送 `Page.getLayoutMetrics` 获取页面完整尺寸。
        4.  发送 `Emulation.setDeviceMetricsOverride` 模拟一个足够大的视口来包含整个页面。
        5.  发送 `Page.captureScreenshot` 命令，设置 `clip` 为整个页面尺寸，`format` 为 "png" (或 "jpeg")，以及 `captureBeyondViewport: true`。
        6.  获取返回的 base64 编码的图片数据。
        7.  （可选）将 base64 数据转换为 Blob 对象。
        8.  使用 `chrome.downloads.download` API 将图片下载到用户本地。
        9.  最后，`chrome.debugger.detach` 从标签页分离。
    *   **自定义区域截图流程**:
        1.  接收到请求后，通过 `chrome.scripting.executeScript` 向当前活动标签页注入一个内容脚本 (例如 `selector.js` 或在 `background.js` 中定义函数并执行)。
        2.  内容脚本会在页面上创建一个覆盖层，允许用户通过鼠标拖拽选择一个区域。
        3.  选择完成后，内容脚本将选区的位置和尺寸信息发送回 `background.js`。
        4.  `background.js` 使用 `chrome.tabs.captureVisibleTab` 截取当前可见区域。
        5.  （如果需要精确裁剪）使用 Canvas API 对捕获的图像根据接收到的坐标进行裁剪。
        6.  使用 `chrome.downloads.download` API 下载裁剪后的图片。
    *   **注意**: `chrome.debugger` API 是一个强大的 API，需要用户明确授权，并且在使用时会在页面顶部显示一个提示条。

4.  **`content_script.js` (可选, 用于自定义区域选择)**:
    *   被 `background.js` 动态注入到当前网页中。
    *   负责在页面上创建并管理一个用于选择截图区域的蒙版和选框。
    *   监听鼠标事件 (mousedown, mousemove, mouseup) 来绘制选框。
    *   选择完成后，将选框的坐标和尺寸通过 `chrome.runtime.sendMessage` 发送回 `background.js`。

5.  **图标 (`images/`)**:
    *   提供了不同尺寸的图标 (16x16, 48x48, 128x128) 用于浏览器工具栏、扩展管理页面等不同位置的显示。

## 🤝 贡献

欢迎通过提交 Pull Requests 或开 Issues 的方式参与改进本项目！
