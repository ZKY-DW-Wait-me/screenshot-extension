// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const captureTypeRadios = document.querySelectorAll('input[name="captureType"]');
  const customHeightInputDiv = document.getElementById('customHeightInputDiv');
  const customHeightValueInput = document.getElementById('customHeightValue');
  const screensInputDiv = document.getElementById('screensInputDiv');
  const screensValueInput = document.getElementById('screensValue');
  const startCaptureBtn = document.getElementById('startCaptureBtn');
  const statusDiv = document.getElementById('status');

  function toggleInputs() {
    const selectedType = document.querySelector('input[name="captureType"]:checked').value;
    customHeightInputDiv.classList.toggle('hidden', selectedType !== 'customHeight');
    screensInputDiv.classList.toggle('hidden', selectedType !== 'screens');
  }

  captureTypeRadios.forEach(radio => {
    radio.addEventListener('change', toggleInputs);
  });

  startCaptureBtn.addEventListener('click', async () => {
    statusDiv.textContent = '正在准备...';
    startCaptureBtn.disabled = true;

    const captureType = document.querySelector('input[name="captureType"]:checked').value;
    let options = { type: captureType };

    if (captureType === 'customHeight') {
      options.height = parseInt(customHeightValueInput.value, 10);
      if (isNaN(options.height) || options.height <= 50) { // 增加最小高度检查
        statusDiv.textContent = '错误：自定义高度需 > 50px。';
        startCaptureBtn.disabled = false;
        return;
      }
    } else if (captureType === 'screens') {
      options.screens = parseInt(screensValueInput.value, 10);
      if (isNaN(options.screens) || options.screens < 1) {
        statusDiv.textContent = '错误：屏数至少为 1。';
        startCaptureBtn.disabled = false;
        return;
      }
    }

    try {
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        statusDiv.textContent = '错误：无法获取当前标签页。';
        startCaptureBtn.disabled = false;
        return;
      }

      if (tab.url && (tab.url.startsWith('edge://') || tab.url.startsWith('chrome://') || tab.url.startsWith('file://') || tab.url.startsWith('chrome-extension://'))) {
          statusDiv.textContent = '错误：无法在此类特殊页面截图。';
          startCaptureBtn.disabled = false;
          return;
      }

      console.log('Popup sending to background:', { action: 'startCapture', tabId: tab.id, options: options });
      const response = await chrome.runtime.sendMessage({ action: 'startCapture', tabId: tab.id, options: options });

      if (response && response.success) {
        statusDiv.textContent = '截图指令已发送！';
        // 关闭popup或显示更持久的成功消息
        setTimeout(() => window.close(), 1500);
      } else {
        statusDiv.textContent = `失败: ${response ? response.error : '未知错误'}`;
        startCaptureBtn.disabled = false; // 允许用户重试
      }
    } catch (error) {
      console.error("Popup error:", error);
      statusDiv.textContent = `发生前端错误: ${error.message.slice(0, 100)}`; // 截断长错误
      startCaptureBtn.disabled = false;
    }
  });

  // 初始化输入框显示
  toggleInputs();
});
