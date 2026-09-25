const $ = (id) => document.getElementById(id);

const casUserEl = $("casUser");
const casPassEl = $("casPass");
const mailUserEl = $("mailUser");
const mailPassEl = $("mailPass");
const autoModeEl = $("autoMode");
const statusEl = $("status");
const saveBtn = $("save");
const clearBtn = $("clear");
const clearCasBtn = $("clearCas");
const clearMailBtn = $("clearMail");

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (cls ? " " + cls : "");
}

async function loadSettings() {
  const cfg = await chrome.storage.local.get(null);
  if (cfg.cas && cfg.cas.username) casUserEl.value = cfg.cas.username;
  if (cfg.cas && cfg.cas.password) casPassEl.value = cfg.cas.password;
  if (cfg.mail && cfg.mail.username) mailUserEl.value = cfg.mail.username;
  if (cfg.mail && cfg.mail.password) mailPassEl.value = cfg.mail.password;
  autoModeEl.checked = cfg.autoMode !== false;
}

saveBtn.addEventListener("click", async () => {
  const cas = {};
  const mail = {};

  if (casUserEl.value.trim() || casPassEl.value) {
    if (!casUserEl.value.trim() || !casPassEl.value) {
      setStatus("统一认证：用户名和密码需同时填写", "err");
      return;
    }
    cas.username = casUserEl.value.trim();
    cas.password = casPassEl.value;
  }
  if (mailUserEl.value.trim() || mailPassEl.value) {
    if (!mailUserEl.value.trim() || !mailPassEl.value) {
      setStatus("邮件：用户名和密码需同时填写", "err");
      return;
    }
    mail.username = mailUserEl.value.trim().split("@")[0];
    mail.password = mailPassEl.value;
  }

  const data = { autoMode: autoModeEl.checked };
  // 未填的区块保持原值不动，填了才覆盖
  const cur = await chrome.storage.local.get(["cas", "mail"]);
  const oldCas = cur.cas || {};
  const oldMail = cur.mail || {};

  if (cas.username !== undefined) oldCas.username = cas.username;
  if (cas.password !== undefined) oldCas.password = cas.password;
  if (mail.username !== undefined) oldMail.username = mail.username;
  if (mail.password !== undefined) oldMail.password = mail.password;

  if (Object.keys(oldCas).length) data.cas = oldCas;
  if (Object.keys(oldMail).length) data.mail = oldMail;

  await chrome.storage.local.set(data);
  // 重置冷却，让修改后立即生效
  await chrome.storage.local.remove(["lastAttemptAt", "lastAttemptHash"]);
  setStatus("已保存", "ok");
  setTimeout(() => window.close(), 800);
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.clear();
  casUserEl.value = "";
  casPassEl.value = "";
  mailUserEl.value = "";
  mailPassEl.value = "";
  autoModeEl.checked = true;
  setStatus("已清除全部记录");
});

clearCasBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove(["cas", "lastAttemptAt", "lastAttemptHash"]);
  casUserEl.value = "";
  casPassEl.value = "";
  setStatus("已清除统一认证账号");
});

clearMailBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove(["mail", "lastAttemptAt", "lastAttemptHash"]);
  mailUserEl.value = "";
  mailPassEl.value = "";
  setStatus("已清除邮箱账号");
});

autoModeEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoMode: autoModeEl.checked });
  setStatus(autoModeEl.checked ? "自动登录已开启" : "自动登录已关闭", autoModeEl.checked ? "ok" : "");
});

loadSettings();