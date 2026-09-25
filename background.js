// 后台脚本：监听登录页导航，触发自动登录
// 注入函数必须完全自包含（executeScript 只序列化 func 本身）

const LOGIN_HOST = "id.tsinghua.edu.cn";

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && isLoginPage(tab.url)) {
    tryAutoLogin(tabId, tab.url);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "autoLoginNow") {
    tryAutoLogin(msg.tabId, msg.url).then((r) => sendResponse(r));
    return true;
  }
});

function isLoginPage(url) {
  try {
    const u = new URL(url);
    if (u.host !== LOGIN_HOST) return false;
    return /\/login$|\/login\//.test(u.pathname) || u.pathname === "/" || u.pathname === "/authserver/login";
  } catch (e) {
    return false;
  }
}

async function tryAutoLogin(tabId, url) {
  const cfg = await chrome.storage.local.get([
    "username",
    "password",
    "autoMode",
    "lastAttemptAt",
    "lastAttemptHash",
  ]);

  if (cfg.autoMode === false) return { ok: false, reason: "disabled" };
  if (!cfg.username || !cfg.password) return { ok: false, reason: "未配置账号密码" };

  const now = Date.now();
  const hash = simpleHash(cfg.username + "|" + url);

  if (cfg.lastAttemptAt && cfg.lastAttemptHash === hash && now - cfg.lastAttemptAt < 60000) {
    return { ok: false, reason: "cooldown" };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: AUTO_LOGIN_MAIN,
      args: [{ username: cfg.username, password: cfg.password }],
      world: "MAIN",
    });
    await chrome.storage.local.set({ lastAttemptAt: now, lastAttemptHash: hash });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "executeScript: " + e.message };
  }
}

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h + "";
}

// ============ 注入到页面主世界的主函数（完全自包含） ============
function AUTO_LOGIN_MAIN({ username, password }) {
  try {
    const u = document.getElementById("username");
    const p = document.getElementById("password");
    if (!u || !p) return { ok: false, reason: "表单未找到" };

    if (u.value !== username) {
      setNativeValue(u, username);
      dispatch(u);
    }
    setNativeValue(p, password);
    dispatch(p);
    u.focus();
    p.focus();

    const cCode = document.getElementById("c_code");
    const captchaVisible = cCode && !cCode.classList.contains("hidden");

    if (captchaVisible) {
      const ic = document.getElementById("i_code");
      if (ic) {
        // 尝试自动识别
        const guess = trySolveCaptcha();
        if (guess && guess.length === 4) {
          setNativeValue(ic, guess);
          dispatch(ic);
          // 等页面 checkCaptcha 校验通过后提交
          const t0 = Date.now();
          const timer = setInterval(() => {
            if (window.isCaptchaOk === true) {
              clearInterval(timer);
              doSubmit();
            } else if (Date.now() - t0 > 3000) {
              clearInterval(timer);
              if (typeof window.refreshCaptcha === "function") {
                window.refreshCaptcha();
                window.__tRequestCaptchaRetry = (window.__tRequestCaptchaRetry || 0) + 1;
                if (window.__tRequestCaptchaRetry < 3) trySolveCaptcha();
              }
            }
          }, 300);
        } else {
          ic.focus();
          highlightCaptcha();
        }
      }
      return { ok: false, reason: "captcha_visible", needCaptcha: true };
    }

    doSubmit();
    return { ok: true, submitted: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  // --------- 工具函数 ---------
  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function dispatch(el) {
    ["input", "change", "keyup"].forEach((type) => {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }

  function doSubmit() {
    if (window.$ && typeof window.$.submitForm === "function") {
      window.$.submitForm();
    } else {
      const btn = document.querySelector("form button[type='button']");
      if (btn) btn.click();
      else {
        const form = document.getElementById("zhmi") || document.querySelector("form");
        if (form) form.submit();
      }
    }
  }

  function highlightCaptcha() {
    const ic = document.getElementById("i_code");
    if (!ic) return;
    ic.style.border = "2px solid #f44336";
    ic.placeholder = "请输入上方验证码";
    const msg = document.getElementById("msg_note");
    if (msg) msg.innerHTML = "验证码识别失败，请手动输入";
  }
}

// ============ 验证码识别（尽力而为，配合页面 checkCaptcha 闭环） ============
function trySolveCaptcha() {
  try {
    const img = document.getElementById("captcha");
    if (!img) return "";
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || 64;
    c.height = img.naturalHeight || 30;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const mask = preprocess(data, c.width, c.height);
    const groups = segment(mask, c.width, c.height);
    if (groups.length !== 4) return "";
    const chars = groups.map(([x0, x1]) => extractFeat(mask, c.width, c.height, x0, x1));
    if (chars.some((f) => !f)) return "";
    const templates = getTemplates();
    let out = "";
    for (const feat of chars) {
      const ch = matchChar(feat, templates);
      if (!ch) return "";
      out += ch;
    }
    return out;
  } catch (e) {
    return "";
  }

  function preprocess(imageData, w, h) {
    const d = imageData.data;
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const diff = Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r);
        m[y * w + x] = diff > 90 ? 1 : 0;
      }
    }
    return m;
  }

  function segment(mask, w, h) {
    // 列投影分组
    const cols = new Array(w).fill(0);
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) cols[x] += mask[y * w + x];
    const groups = [];
    let start = -1;
    for (let x = 0; x < w; x++) {
      if (cols[x] > 0) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        groups.push([start, x - 1]);
        start = -1;
      }
    }
    if (start >= 0) groups.push([start, w - 1]);
    return groups.filter((g) => g[1] - g[0] + 1 >= 4).slice(0, 4);
  }

  function extractFeat(mask, w, h, x0, x1) {
    let minY = h, maxY = 0;
    for (let x = x0; x <= x1; x++)
      for (let y = 0; y < h; y++)
        if (mask[y * w + x]) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
    const cw = x1 - x0 + 1, ch = maxY - minY + 1;
    if (cw < 3 || ch < 3) return null;
    const feat = new Float32Array(64);
    for (let gy = 0; gy < 8; gy++) {
      const ys = minY + (gy * ch) / 8, ye = minY + ((gy + 1) * ch) / 8;
      for (let gx = 0; gx < 8; gx++) {
        const xs = x0 + (gx * cw) / 8, xe = x0 + ((gx + 1) * cw) / 8;
        let cnt = 0, tot = 0;
        for (let y = ys | 0; y < ye; y++)
          for (let x = xs | 0; x < xe; x++)
            if (x >= x0 && x <= x1 && y >= minY && y <= maxY && mask[y * w + x]) cnt++;
        feat[gy * 8 + gx] = cnt / ((ye - ys) * (xe - xs));
      }
    }
    return feat;
  }

  let _templates = null;
  function getTemplates() {
    if (_templates) {
      // 每次尝试重建（页面字体可能不同），成本低
    }
    _templates = buildTemplates();
    return _templates;
  }

  function buildTemplates() {
    const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const fonts = [
      'bold 18px Arial, "Helvetica Neue", sans-serif',
      'bold 18px "Courier New", monospace',
      'bold 18px "Verdana", sans-serif',
      'bold 18px "Times New Roman", serif',
    ];
    const list = [];
    const tcv = document.createElement("canvas");
    tcv.width = 24;
    tcv.height = 24;
    for (const ch of charset) {
      for (const f of fonts) {
        const tctx = tcv.getContext("2d");
        tctx.clearRect(0, 0, 24, 24);
        tctx.font = f;
        tctx.textAlign = "center";
        tctx.textBaseline = "middle";
        tctx.fillStyle = "#000";
        tctx.fillText(ch, 12, 13);
        const td = tctx.getImageData(0, 0, 24, 24);
        const tm = new Uint8Array(24 * 24);
        for (let i = 0; i < 24 * 24; i++) tm[i] = td.data[i * 4] < 128 ? 1 : 0;
        const feat = extractFeat(tm, 24, 24, 0, 23);
        if (feat) list.push({ ch, feat });
      }
    }
    return list;
  }

  function matchChar(feat, templates) {
    let best = null;
    let bestScore = Infinity;
    for (const t of templates) {
      let s = 0;
      for (let i = 0; i < 64; i++) {
        const d = feat[i] - t.feat[i];
        s += d * d;
      }
      if (s < bestScore) {
        bestScore = s;
        best = t.ch;
      }
    }
    // 距离过大则不可信
    if (bestScore > 8) return null;
    return best;
  }
}