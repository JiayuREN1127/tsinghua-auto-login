// 清华自动登录 - 后台脚本
// 支持三类站点，凭据按站点分开放置:
//  1. id.tsinghua.edu.cn  统一认证登录页 (cas 凭据)
//  2. mail*.tsinghua.edu.cn  Coremail 邮件系统 (mail 凭据)
//  3. 其他 *.tsinghua.edu.cn  检测到跳转统一认证的登录入口时自动点击 (cas 凭据)
//
// 存储结构:
//   { cas: {username, password}, mail: {username, password}, autoMode: true }
//
// 注意: chrome.scripting.executeScript 只序列化 func 本身，
// 所以每个注入函数必须完全自包含，不得引用文件顶层变量/函数。

const LOGIN_HOST = "id.tsinghua.edu.cn";
const COOLDOWN_MS = 60000;

// Coremail 分片域名：mail/mails/mails2/mails3... 统一按邮件系统处理
function isMailHost(hostname) {
  return /^mails?\d*\.tsinghua\.edu\.cn$/.test(hostname);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && isTsinghua(tab.url)) {
    autoHandle(tabId, tab.url);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "autoLoginNow") {
    autoHandle(msg.tabId, msg.url).then((r) => sendResponse(r));
    return true;
  }
});

function isTsinghua(url) {
  try {
    return new URL(url).hostname.endsWith(".tsinghua.edu.cn");
  } catch (e) {
    return false;
  }
}

function isLoginPage(url) {
  try {
    const u = new URL(url);
    if (u.host !== LOGIN_HOST) return false;
    return /\/login$|\/login\//.test(u.pathname) || u.pathname === "/" || u.pathname === "/authserver/login";
  } catch (e) {
    return false;
  }
}

async function autoHandle(tabId, url) {
  if (url.startsWith("chrome://")) return;
  const cfg = await chrome.storage.local.get(null);

  const site =
    isLoginPage(url) || (!isMailHost(new URL(url).hostname) && isTsinghua(url))
      ? "cas"
      : "mail";
  const cred = (cfg[site] && cfg[site].username && cfg[site].password) ? cfg[site] : null;
  if (cfg.autoMode === false) return { ok: false, reason: "disabled" };
  if (!cred) {
    return { ok: false, reason: "未配置" + site + " 账号密码" };
  }

  const now = Date.now();
  const hash = simpleHash((cred.username || "") + "|" + url + "|" + site);
  const attempts = await chrome.storage.local.get(["lastAttemptAt", "lastAttemptHash"]);
  if (attempts.lastAttemptAt && attempts.lastAttemptHash === hash && now - attempts.lastAttemptAt < COOLDOWN_MS) {
    return { ok: false, reason: "cooldown" };
  }
  await chrome.storage.local.set({ lastAttemptAt: now, lastAttemptHash: hash });

  try {
    if (isLoginPage(url)) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: AUTO_LOGIN_MAIN,
        args: [{ username: cred.username, password: cred.password }],
        world: "MAIN",
      });
    } else if (isMailHost(new URL(url).hostname)) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: AUTO_LOGIN_MAIL,
        args: [{ username: cred.username, password: cred.password }],
        world: "MAIN",
      });
    } else if (isTsinghua(url)) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: AUTO_CLICK_CAS_ENTRY,
        args: [],
        world: "MAIN",
      });
    }
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

// ================= 统一认证登录页 (cas) =================
function AUTO_LOGIN_MAIN({ username, password }) {
  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }
  function dispatchEvents(el) {
    ["input", "change", "keyup"].forEach((type) => {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }
  // 兼容两种登录表单:
  //  普通: #username/#password + $.submitForm()
  //  网络学堂跳转: #i_user/#i_pass + 全局 doLogin() (内部做 SM2 + 提交)
  function doSubmitCas() {
    const jumpForm = document.getElementById("theform");
    if (typeof window.doLogin === "function" && jumpForm) {
      window.doLogin();
      return;
    }
    if (window.$ && typeof window.$.submitForm === "function") {
      window.$.submitForm();
      return;
    }
    const btn = document.querySelector("form button[type='button']");
    if (btn) {
      btn.click();
      return;
    }
    const form = document.getElementById("zhmi") || document.querySelector("form");
    if (form) form.submit();
  }
  function highlight(el, text) {
    el.style.border = "2px solid #f44336";
    if (el.placeholder !== undefined) el.placeholder = text;
  }

  function solveTsCaptcha() {
    function preprocess(d, w, h) {
      const m = new Uint8Array(w * h);
      for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        m[p] = Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r) > 90 ? 1 : 0;
      }
      return m;
    }
    function segment(mask, w, h) {
      const cols = new Array(w).fill(0);
      for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) cols[x] += mask[y * w + x];
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
          let cnt = 0;
          for (let y = ys | 0; y < Math.ceil(ye); y++)
            for (let x = xs | 0; x < Math.ceil(xe); x++)
              if (x >= x0 && x <= x1 && y >= minY && y <= maxY && x < w && y < h && mask[y * w + x]) cnt++;
          const tot = (Math.ceil(ye) - (ys | 0)) * (Math.ceil(xe) - (xs | 0));
          feat[gy * 8 + gx] = tot ? cnt / tot : 0;
        }
      }
      return feat;
    }
    function buildTemplates() {
      const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const fonts = [
        'bold 18px Arial, "Helvetica Neue", sans-serif',
        'bold 18px "Courier New", monospace',
        'bold 18px Verdana, sans-serif',
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
          const td = tctx.getImageData(0, 0, 24, 24).data;
          const tm = new Uint8Array(24 * 24);
          for (let p = 0; p < 24 * 24; p++) tm[p] = td[p * 4] < 128 ? 1 : 0;
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
      if (bestScore > 6) return null;
      return best;
    }

    try {
      const img = document.getElementById("captcha");
      if (!img || !img.naturalWidth) return "";
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const mask = preprocess(data.data, c.width, c.height);
      const groups = segment(mask, c.width, c.height);
      if (groups.length !== 4) return "";
      const chars = groups.map(([x0, x1]) => extractFeat(mask, c.width, c.height, x0, x1));
      if (chars.some((f) => !f)) return "";
      const templates = buildTemplates();
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
  }

  try {
    // 兼容普通表单(#username/#password) 与网络学堂跳转表单(#i_user/#i_pass)
    const u =
      document.getElementById("username") ||
      document.getElementById("i_user");
    const p =
      document.getElementById("password") ||
      document.getElementById("i_pass");
    if (!u || !p) return { ok: false, reason: "表单未找到" };

    setNativeValue(u, username);
    dispatchEvents(u);
    setNativeValue(p, password);
    dispatchEvents(p);
    u.focus();
    p.focus();

    const cCode = document.getElementById("c_code");
    const captchaVisible = cCode && !cCode.classList.contains("hidden");

    if (captchaVisible) {
      const ic = document.getElementById("i_code");
      if (ic) {
        const guess = solveTsCaptcha();
        if (guess && guess.length === 4) {
          setNativeValue(ic, guess);
          dispatchEvents(ic);
          const t0 = Date.now();
          const timer = setInterval(() => {
            if (window.isCaptchaOk === true) {
              clearInterval(timer);
              doSubmitCas();
            } else if (Date.now() - t0 > 3000) {
              clearInterval(timer);
              if (typeof window.refreshCaptcha === "function") {
                window.refreshCaptcha();
                window.__tCaptchaRetries = (window.__tCaptchaRetries || 0) + 1;
                if (window.__tCaptchaRetries < 3) {
                  const guess2 = solveTsCaptcha();
                  if (guess2 && guess2.length === 4) {
                    setNativeValue(ic, guess2);
                    dispatchEvents(ic);
                  } else {
                    ic.focus();
                    highlight(ic, "验证码识别失败，请手动输入");
                  }
                } else {
                  ic.focus();
                  highlight(ic, "验证码识别失败，请手动输入");
                }
              } else {
                ic.focus();
                highlight(ic, "请输入验证码");
              }
            }
          }, 300);
        } else {
          ic.focus();
          highlight(ic, "验证码识别失败，请手动输入");
        }
      }
      return { ok: false, reason: "captcha_visible", needCaptcha: true };
    }

    doSubmitCas();
    return { ok: true, submitted: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ================= 邮件系统 (Coremail, mail 凭据) =================
function AUTO_LOGIN_MAIL({ username, password }) {
  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }
  function dispatchEvents(el) {
    ["input", "change", "keyup"].forEach((type) => {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function genericSolve(d, w, h) {
    function preprocess(dd, ww, hh) {
      const m = new Uint8Array(ww * hh);
      for (let p = 0; p < ww * hh; p++) {
        const i = p * 4;
        const r = dd[i], g = dd[i + 1], b = dd[i + 2];
        m[p] = Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r) > 80 ? 1 : 0;
      }
      return m;
    }
    function extractFeatTpl(mask, ww, hh, x0, x1) {
      let minY = hh, maxY = 0;
      for (let x = x0; x <= x1; x++)
        for (let y = 0; y < hh; y++)
          if (mask[y * ww + x]) {
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
          let cnt = 0;
          for (let y = ys | 0; y < Math.ceil(ye); y++)
            for (let x = xs | 0; x < Math.ceil(xe); x++)
              if (x >= x0 && x <= x1 && y >= minY && y <= maxY && x < ww && y < hh && mask[y * ww + x]) cnt++;
          const tot = (Math.ceil(ye) - (ys | 0)) * (Math.ceil(xe) - (xs | 0));
          feat[gy * 8 + gx] = tot ? cnt / tot : 0;
        }
      }
      return feat;
    }
    function buildTemplatesTpl() {
      const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const fonts = ["bold 18px Arial, sans-serif", "bold 18px Verdana, sans-serif", "bold 18px Monospace, monospace"];
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
          const td = tctx.getImageData(0, 0, 24, 24).data;
          const tm = new Uint8Array(24 * 24);
          for (let p = 0; p < 24 * 24; p++) tm[p] = td[p * 4] < 128 ? 1 : 0;
          const feat = extractFeatTpl(tm, 24, 24, 0, 23);
          if (feat) list.push({ ch, feat });
        }
      }
      return list;
    }
    function matchCharTpl(feat, templates) {
      let best = null;
      let bestScore = Infinity;
      for (const t of templates) {
        let s = 0;
        for (let i = 0; i < 64; i++) {
          const dd = feat[i] - t.feat[i];
          s += dd * dd;
        }
        if (s < bestScore) {
          bestScore = s;
          best = t.ch;
        }
      }
      if (bestScore > 6) return null;
      return best;
    }
    try {
      const m = preprocess(d, w, h);
      const cols = new Array(w).fill(0);
      for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) cols[x] += m[y * w + x];
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
      const g2 = groups.filter((g) => g[1] - g[0] + 1 >= 3).slice(0, 4);
      if (g2.length !== 4) return "";
      const chars = g2.map(([x0, x1]) => extractFeatTpl(m, w, h, x0, x1));
      if (chars.some((c) => !c)) return "";
      const tpl = buildTemplatesTpl();
      let out = "";
      for (const f of chars) {
        const ch = matchCharTpl(f, tpl);
        if (!ch) return "";
        out += ch;
      }
      return out;
    } catch (e) {
      return "";
    }
  }

  try {
    const uid = document.getElementById("uid");
    const pwd = document.getElementById("password");
    if (!uid || !pwd) return { ok: false, reason: "邮件表单未找到" };

    const normalized = username.indexOf("@") >= 0 ? username.split("@")[0] : username;
    setNativeValue(uid, normalized);
    dispatchEvents(uid);
    setNativeValue(pwd, password);
    dispatchEvents(pwd);
    uid.focus();
    pwd.focus();

    const vc = document.querySelector("input[name='verifyCode']");
    if (vc && isVisible(vc)) {
      const img = document.querySelector("img[src*='displayVerifyCode']") || document.querySelector("img[src*='verifyCode']");
      if (img && img.naturalWidth) {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        const guess = genericSolve(data, c.width, c.height);
        if (guess && guess.length === 4) {
          setNativeValue(vc, guess);
          dispatchEvents(vc);
          doSubmitMail();
        } else {
          vc.focus();
          vc.style.border = "2px solid #f44336";
          vc.placeholder = "请输入图形验证码";
        }
      } else {
        vc.focus();
        vc.style.border = "2px solid #f44336";
        vc.placeholder = "请输入图形验证码";
      }
      return { ok: false, reason: "mail_captcha", needCaptcha: true };
    }

    doSubmitMail();
    return { ok: true, submitted: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  function doSubmitMail() {
    const btn = document.querySelector(".j-submit");
    if (btn) {
      btn.click();
      return;
    }
    const form = document.querySelector(".j-login-form");
    if (form) {
      const ev = new SubmitEvent("submit", { bubbles: true, cancelable: true });
      form.dispatchEvent(ev);
      if (!ev.defaultPrevented && typeof form.submit === "function") form.submit();
    }
  }
}

// ================= 通用: 点击跳转统一认证的登录入口 (cas 凭据) =================
function AUTO_CLICK_CAS_ENTRY() {
  try {
    if (window.location.hostname === "id.tsinghua.edu.cn") return { ok: false, reason: "skip-self" };

    const anchors = Array.from(document.querySelectorAll("a"));
    const casLink = anchors.find(
      (a) =>
        a.href &&
        (a.href.indexOf("id.tsinghua.edu.cn") >= 0 || a.href.indexOf("authserver/login") >= 0) &&
        /login|authserver/.test(a.href)
    );

    const elems = Array.from(document.querySelectorAll("button, input[type=button], input[type=submit], a"));
    const casBtn = elems.find((el) => {
      const oc = el.getAttribute && el.getAttribute("onclick");
      return oc && oc.indexOf("id.tsinghua.edu.cn") >= 0 && /login|authserver/.test(oc);
    });

    const form = document.querySelector("form[action*='id.tsinghua.edu.cn'], form[action*='authserver/login']");

    if (casBtn) {
      casBtn.click();
      return { ok: true, action: "clicked-login-button" };
    }
    if (casLink) {
      window.location.href = casLink.href;
      return { ok: true, action: "navigated-cas" };
    }
    if (form) {
      form.submit();
      return { ok: true, action: "submitted-cas-form" };
    }

    const hasLoginForm = !!document.querySelector(
      "input[name='username'], input[name='i_user'], input[type='password'], #uid"
    );
    if (hasLoginForm) {
      const textBtn = elems.find(
        (el) =>
          el.textContent &&
          el.textContent.replace(/\s+/g, "").indexOf("登录") >= 0 &&
          !el.disabled
      );
      if (textBtn) {
        textBtn.click();
        return { ok: true, action: "clicked-login-text" };
      }
    }
    return { ok: false, reason: "no-cas-entry" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}