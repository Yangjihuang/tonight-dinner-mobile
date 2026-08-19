const NAMESPACE = "tonight-dinner-7fc44f0ce3c74618";
const API_ROOT = `https://mantledb.sh/v2/${NAMESPACE}`;
const LIST_URL = `https://mantledb.sh/v2/list/${NAMESPACE}`;
const LOCAL_KEY = "tonight-dinner-mobile-state-v1";
const MEMBER_KEY = "tonight-dinner-mobile-member";

let recipes = [];
let records = [];
let currentName = localStorage.getItem(MEMBER_KEY) || "";
let selected = new Set();
let selectionDirty = false;
let calendarCursor = startOfShanghaiMonth();
let lastDay = shanghaiDate();
let toastTimer;

const $ = (selector) => document.querySelector(selector);

function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short"
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return parts;
}

function shanghaiDate(date = new Date()) {
  const p = shanghaiParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function startOfShanghaiMonth() {
  const p = shanghaiParts();
  return new Date(Number(p.year), Number(p.month) - 1, 1);
}

function cleanName(value) {
  return value.trim().replace(/\s+/g, " ").slice(0, 20);
}

function normalizedName(value) {
  return cleanName(value).toLocaleLowerCase("zh-CN");
}

function memberSlug(name) {
  let hash = 2166136261;
  for (const char of normalizedName(name)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `m-${(hash >>> 0).toString(36)}`;
}

function defaultRecord(name, path = "") {
  return { name: cleanName(name), dietary: "", orderDate: "", recipeIds: [], activityDates: [], updatedAt: "", path };
}

function sanitizeRecord(raw, path = "") {
  const record = defaultRecord(raw?.name || "朋友", path);
  record.dietary = typeof raw?.dietary === "string" ? raw.dietary.slice(0, 80) : "";
  record.orderDate = /^\d{4}-\d{2}-\d{2}$/.test(raw?.orderDate || "") ? raw.orderDate : "";
  record.recipeIds = Array.isArray(raw?.recipeIds) ? [...new Set(raw.recipeIds.filter((id) => typeof id === "string"))] : [];
  record.activityDates = Array.isArray(raw?.activityDates) ? [...new Set(raw.activityDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort() : [];
  record.updatedAt = typeof raw?.updatedAt === "string" ? raw.updatedAt : "";
  return record;
}

function localRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map((record) => sanitizeRecord(record, record.path || "")) : [];
  } catch { return []; }
}

function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(records));
}

function setConnection(message = "") {
  const notice = $("#connectionNotice");
  notice.textContent = message;
  notice.classList.toggle("hidden", !message);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function saveRecord(record, silent = false) {
  const path = record.path || `members/${memberSlug(record.name)}`;
  const payload = {
    name: cleanName(record.name), dietary: record.dietary || "", orderDate: record.orderDate || "",
    recipeIds: [...new Set(record.recipeIds || [])], activityDates: [...new Set(record.activityDates || [])].sort(),
    updatedAt: new Date().toISOString()
  };
  record.path = path;
  Object.assign(record, payload);
  replaceLocalRecord(record);
  try {
    await fetchJson(`${API_ROOT}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    setConnection("");
    return true;
  } catch (error) {
    record.pending = true;
    replaceLocalRecord(record);
    setConnection("网络暂时不稳：当前操作已保存在这台手机，恢复后会继续同步。 ");
    if (!silent) showToast("已先保存在本机");
    return false;
  }
}

function replaceLocalRecord(record) {
  const index = records.findIndex((item) => normalizedName(item.name) === normalizedName(record.name));
  if (index >= 0) records[index] = record; else records.push(record);
  records.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  saveLocal();
}

async function syncPending() {
  for (const record of records.filter((item) => item.pending)) {
    const copy = { ...record };
    delete copy.pending;
    const ok = await saveRecord(copy, true);
    if (ok) record.pending = false;
  }
}

async function refreshRecords({ initial = false } = {}) {
  const cachedBeforeRefresh = localRecords();
  try {
    const listing = await fetchJson(LIST_URL);
    const entries = (listing.entries || []).filter((entry) => entry.path.startsWith("members/"));
    const loaded = await Promise.all(entries.map(async (entry) => {
      const value = await fetchJson(`${API_ROOT}/${entry.path}`);
      return sanitizeRecord(value, entry.path);
    }));
    records = loaded.length ? loaded : [defaultRecord("damon", "members/damon")];
    for (const pending of cachedBeforeRefresh.filter((item) => item.pending)) {
      const index = records.findIndex((item) => normalizedName(item.name) === normalizedName(pending.name));
      if (index >= 0) records[index] = pending; else records.push(pending);
    }
    const today = shanghaiDate();
    const stale = [];
    for (const record of records) {
      if (record.orderDate && record.orderDate !== today) {
        if (record.recipeIds.length) record.activityDates = [...new Set([...record.activityDates, record.orderDate])].sort();
        record.orderDate = "";
        record.recipeIds = [];
        stale.push(saveRecord(record, true));
      }
    }
    if (stale.length) await Promise.all(stale);
    await syncPending();
    saveLocal();
    setConnection("");
  } catch (error) {
    const cached = localRecords();
    records = cached.length ? cached : [defaultRecord("damon", "members/damon")];
    setConnection("当前使用本机缓存；网络恢复后会自动同步。 ");
  }

  if (currentName && !findRecord(currentName)) currentName = "";
  if (currentName && !selectionDirty) loadCurrentSelection();
  renderAll();
  if (initial && !currentName) openIdentity();
}

function findRecord(name) {
  const key = normalizedName(name);
  return records.find((record) => normalizedName(record.name) === key);
}

function currentRecord() { return findRecord(currentName); }

function loadCurrentSelection() {
  const record = currentRecord();
  selected = new Set(record?.orderDate === shanghaiDate() ? record.recipeIds : []);
}

function renderAll() {
  renderHeader();
  renderCalendar();
  renderRecipes();
  renderDietary();
  renderMembers();
  updateOrderBar();
}

function renderHeader() {
  const p = shanghaiParts();
  const weekdays = { Mon: "星期一", Tue: "星期二", Wed: "星期三", Thu: "星期四", Fri: "星期五", Sat: "星期六", Sun: "星期日" };
  $("#todayText").textContent = `${p.year}年${Number(p.month)}月${Number(p.day)}日 · ${weekdays[p.weekday] || ""}`;
  $("#currentMember").textContent = currentName || "请选择";
}

function activityDates() {
  const days = new Set();
  const today = shanghaiDate();
  for (const record of records) {
    record.activityDates.forEach((date) => days.add(date));
    if (record.orderDate === today && record.recipeIds.length) days.add(today);
  }
  return days;
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  $("#calendarTitle").textContent = `${year}年${month + 1}月`;
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const marked = activityDates();
  const today = shanghaiDate();
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push('<span class="calendar-day empty"></span>');
  for (let day = 1; day <= total; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const classes = ["calendar-day", marked.has(date) ? "ordered" : "", date === today ? "today" : ""].filter(Boolean).join(" ");
    cells.push(`<span class="${classes}" aria-label="${date}${marked.has(date) ? "，下过单" : ""}">${day}</span>`);
  }
  $("#calendarGrid").innerHTML = cells.join("");
}

function orderCounts() {
  const counts = new Map();
  const today = shanghaiDate();
  for (const record of records) {
    if (record.orderDate !== today) continue;
    for (const id of record.recipeIds) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function renderRecipes() {
  const counts = orderCounts();
  const max = Math.max(0, ...counts.values());
  $("#menuSummary").textContent = `${recipes.length} 道菜 · ${records.filter((r) => r.orderDate === shanghaiDate() && r.recipeIds.length).length} 人已下单`;
  $("#recipeGrid").innerHTML = recipes.map((recipe) => {
    const isSelected = selected.has(recipe.id);
    const count = counts.get(recipe.id) || 0;
    const isStar = max > 0 && count === max;
    const tags = [recipe.category, ...(recipe.flavor_tags || []).slice(0, 2), `${recipe.prep_minutes + recipe.cook_minutes}分钟`].filter(Boolean);
    return `<article class="recipe-card${isSelected ? " selected" : ""}">
      <button class="recipe-button" type="button" data-recipe-id="${recipe.id}" aria-pressed="${isSelected}">
        <img class="recipe-image" src="${recipe.image}" alt="${escapeHtml(recipe.name)}" decoding="async">
        <span class="recipe-content">
          <span class="recipe-topline"><strong class="recipe-name">${escapeHtml(recipe.name)}</strong><span class="checkmark">✓</span></span>
          <span class="stars">${isStar ? `★ 当前人气最高 · ${count}单` : count ? `${count} 人已点` : "&nbsp;"}</span>
          <span class="recipe-description">${escapeHtml(recipe.description)}</span>
          <span class="chips">${tags.map((tag) => `<span class="chip">${escapeHtml(String(tag))}</span>`).join("")}</span>
        </span>
      </button>
    </article>`;
  }).join("");

  document.querySelectorAll("[data-recipe-id]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.recipeId;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    selectionDirty = true;
    renderRecipes();
    updateOrderBar();
  }));
}

function renderDietary() {
  const profiles = records.filter((record) => record.dietary.trim());
  $("#dietaryList").innerHTML = profiles.length
    ? profiles.map((record) => `<div class="dietary-item"><strong>${escapeHtml(record.name)}</strong><span>${escapeHtml(record.dietary)}</span></div>`).join("")
    : '<p class="empty-copy">还没有登记忌口。</p>';
}

function renderMembers() {
  $("#memberChoices").innerHTML = records.map((record) => `<button class="member-choice" type="button" data-member="${escapeAttr(record.name)}">${escapeHtml(record.name)}</button>`).join("");
  document.querySelectorAll("[data-member]").forEach((button) => button.addEventListener("click", () => chooseMember(button.dataset.member)));
}

function updateOrderBar() {
  $("#selectedCount").textContent = String(selected.size);
  const button = $("#orderButton");
  button.disabled = !currentName || selected.size === 0;
  button.textContent = currentRecord()?.orderDate === shanghaiDate() && currentRecord()?.recipeIds.length ? "更新下单" : "下单";
}

function chooseMember(name) {
  currentName = cleanName(name);
  localStorage.setItem(MEMBER_KEY, currentName);
  selectionDirty = false;
  loadCurrentSelection();
  closeIdentity();
  renderAll();
}

function openIdentity() { $("#identityOverlay").classList.remove("hidden"); }
function closeIdentity() { if (currentName) $("#identityOverlay").classList.add("hidden"); }

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
function escapeAttr(value) { return escapeHtml(value); }

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2400);
}

async function submitOrder() {
  const record = currentRecord();
  if (!record || !selected.size) return;
  const button = $("#orderButton");
  button.disabled = true;
  button.textContent = "正在下单…";
  record.orderDate = shanghaiDate();
  record.recipeIds = [...selected];
  const synced = await saveRecord(record);
  selectionDirty = false;
  showToast(synced ? "下单成功，大家都能看见" : "已保存，网络恢复后同步");
  renderAll();
  if (synced) setTimeout(() => refreshRecords(), 500);
}

async function join(name) {
  const cleaned = cleanName(name);
  if (!cleaned) return;
  const existing = findRecord(cleaned);
  if (existing) { chooseMember(existing.name); return; }
  const record = defaultRecord(cleaned, `members/${memberSlug(cleaned)}`);
  replaceLocalRecord(record);
  await saveRecord(record);
  chooseMember(cleaned);
  showToast(`欢迎 ${cleaned}`);
}

async function saveDietary(name, dietary) {
  const cleaned = cleanName(name);
  if (!cleaned || !dietary.trim()) return;
  const record = findRecord(cleaned) || defaultRecord(cleaned, `members/${memberSlug(cleaned)}`);
  record.dietary = dietary.trim().slice(0, 80);
  await saveRecord(record);
  $("#dietaryForm").reset();
  renderAll();
  showToast("忌口已长期记录");
}

async function sharePage() {
  const data = { title: "今晚吃什么", text: "来选今晚想吃的菜", url: location.href.split("#")[0] };
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(data.url);
    showToast("链接已复制，可以发到微信");
  } catch {
    window.prompt("长按复制这个点单链接", data.url);
  }
}

function bindEvents() {
  $("#switchMember").addEventListener("click", openIdentity);
  $("#shareButton").addEventListener("click", sharePage);
  $("#orderButton").addEventListener("click", submitOrder);
  $("#previousMonth").addEventListener("click", () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); renderCalendar(); });
  $("#nextMonth").addEventListener("click", () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); renderCalendar(); });
  $("#joinForm").addEventListener("submit", async (event) => { event.preventDefault(); await join($("#joinName").value); $("#joinForm").reset(); });
  $("#dietaryForm").addEventListener("submit", async (event) => { event.preventDefault(); await saveDietary($("#dietaryName").value, $("#dietaryText").value); });
  $("#identityOverlay").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeIdentity(); });
}

async function init() {
  bindEvents();
  try {
    recipes = Array.isArray(window.__RECIPES__) ? window.__RECIPES__ : await fetchJson("recipes.json");
  } catch {
    $("#recipeGrid").innerHTML = '<p class="empty-copy">菜单加载失败，请刷新重试。</p>';
    return;
  }
  await refreshRecords({ initial: true });
  setInterval(async () => {
    const today = shanghaiDate();
    if (today !== lastDay) {
      lastDay = today;
      calendarCursor = startOfShanghaiMonth();
      selectionDirty = false;
    }
    await refreshRecords();
  }, 12000);
}

init();
