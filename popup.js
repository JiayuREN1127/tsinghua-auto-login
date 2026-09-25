const $ = (id) => document.getElementById(id);

const usernameEl = $("username");
const passwordEl = $("password");
const autoModeEl = $("autoMode");
const statusEl = $("status");
const saveBtn = $("save");
const clearBtn = $("clear");

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (cls ? " " + cls : "");
}

async function loadSettings() {
  const cfg = await chrome.storage.local.get(["username", "password", "autoMode"]);
  if (cfg.username) usernameEl.value = cfg.username;
  if (cfg.password) passwordEl.value = cfg.password;
  autoModeEl.checked = cfg.autoMode !== false;
}

saveBtn.addEventListener("click", async () => {
  const username = usernameEl.value.trim();
  const password = passwordEl.value;
  if (!username || !password) {
    setStatus("用户名和密码不能为空", "err");
    return;
  }
  await chrome.storage.local.set({
    username,
    password,
    autoMode: autoModeEl.checked,
    lastAttemptAt: undefined,
    lastAttemptHash: undefined,
  });
  setStatus("已保存并启用自动登录", "ok");
  setTimeout(() => window.close(), 800);
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove([
    "username",
    "password",
    "autoMode",
    "lastAttemptAt",
    "lastAttemptHash",
  ]);
  usernameEl.value = "";
  passwordEl.value = "";
  autoModeEl.checked = true;
  setStatus("已清除全部记录");
});

autoModeEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoMode: autoModeEl.checked });
  setStatus(autoModeEl.checked ? "自动登录已开启" : "自动登录已关闭", autoModeEl.checked ? "ok" : "");
});

loadSettings();