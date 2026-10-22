import { explain, getPrefs, isWeb, pair, saveLink, savePage, saveSelection, selectedText, setPrefs, status, t, targets } from "./cognify.js";

const $ = (id) => document.getElementById(id);

for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0];
$("tags").placeholder = t("tagsPlaceholder");

function show(state) {
  for (const id of ["unpaired", "paired", "offline"]) $(id).hidden = id !== state;
}

function message(text, ok) {
  const el = $("message");
  el.hidden = !text;
  el.textContent = text || "";
  el.className = ok ? "ok" : "error";
}

let prefs;

/** Pilihan tujuan: dropdown buatan sendiri (tanpa <select> bawaan browser). */
let destOptions = [];
let destValue = "new";
let destActive = -1;

function renderDest() {
  const list = $("dest-list");
  list.replaceChildren();
  let group = null;
  destOptions.forEach((o, i) => {
    if (o.group && o.group !== group) {
      const g = document.createElement("div");
      g.className = "dd-group";
      g.textContent = o.group;
      list.append(g);
    }
    group = o.group || null;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dd-opt";
    b.role = "option";
    b.dataset.i = String(i);
    b.setAttribute("aria-selected", String(o.value === destValue));
    b.classList.toggle("on", o.value === destValue);
    b.classList.toggle("act", i === destActive);
    b.textContent = o.label;
    b.addEventListener("click", () => pickDest(o.value));
    b.addEventListener("pointermove", () => setActive(i, false));
    list.append(b);
  });
  $("dest-text").textContent = destOptions.find((o) => o.value === destValue)?.label ?? "";
}

function setActive(i, scroll = true) {
  destActive = i;
  document.querySelectorAll(".dd-opt").forEach((el) => el.classList.toggle("act", Number(el.dataset.i) === i));
  if (scroll) document.querySelector(`.dd-opt[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
}

function openDest(open) {
  $("dest-list").hidden = !open;
  $("dest").setAttribute("aria-expanded", String(open));
  if (open) {
    destActive = Math.max(0, destOptions.findIndex((o) => o.value === destValue));
    renderDest();
    document.querySelector(`.dd-opt[data-i="${destActive}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

function pickDest(value) {
  destValue = value;
  openDest(false);
  renderDest();
  $("dest").focus();
  remember();
}

$("dest").addEventListener("click", () => openDest($("dest-list").hidden));
$("dest").addEventListener("keydown", (e) => {
  const open = !$("dest-list").hidden;
  if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
    e.preventDefault();
    return openDest(true);
  }
  if (!open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    openDest(false);
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    setActive((destActive + (e.key === "ArrowDown" ? 1 : -1) + destOptions.length) % destOptions.length);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    pickDest(destOptions[destActive].value);
  } else if (e.key === "Tab") {
    openDest(false);
  }
});
document.addEventListener("pointerdown", (e) => {
  if (!$("dest-list").hidden && !e.target.closest(".dd")) openDest(false);
});

/** Isi pilihan tujuan: kliping otomatis, catatan melayang, dan halaman terakhir diubah. */
async function fillTargets() {
  destOptions = [
    { value: "new", label: t("destNew") },
    { value: "sticky", label: t("destSticky") },
  ];
  try {
    const pages = await targets();
    for (const p of pages) destOptions.push({ value: `append:${p.id}`, label: p.title || t("untitled"), group: t("destAppendGroup") });
  } catch {
    // Daftar halaman hanya pelengkap; dua tujuan pertama tetap ada.
  }
  const want = prefs.kind === "append" ? `append:${prefs.pageId}` : prefs.kind;
  destValue = destOptions.some((o) => o.value === want) ? want : "new";
  renderDest();
}

async function remember() {
  const [kind, pageId = ""] = destValue.split(":");
  prefs = { kind, pageId, tags: $("tags").value };
  await setPrefs(prefs);
}

async function refresh() {
  const state = await status();
  show(state === "ok" ? "paired" : state);
  if (state === "ok") {
    prefs = await getPrefs();
    $("tags").value = prefs.tags;
    await fillTargets();
  }
  const { last } = await chrome.storage.local.get("last");
  if (last && Date.now() - last.at < 60_000) message(last.message, last.ok);
}

$("pair-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await pair($("code").value.trim());
    await refresh();
    message(t("paired"), true);
  } catch (err) {
    message(explain(err), false);
  }
});

$("tags").addEventListener("change", remember);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isWeb(tab)) throw new Error(t("onlyWeb"));
  return tab;
}

function action(button, work) {
  button.addEventListener("click", async () => {
    const all = document.querySelectorAll(".actions button");
    all.forEach((b) => (b.disabled = true));
    try {
      await remember();
      const done = await work(await activeTab());
      const base = t(done.sticky ? "savedSticky" : done.append ? "savedAppend" : button.dataset.saved);
      message(done.pdfError ? `${base} ${t("pdfFailed", [done.pdfError])}` : base, true);
    } catch (err) {
      message(explain(err), false);
    } finally {
      all.forEach((b) => (b.disabled = false));
    }
  });
}

$("save-page").dataset.saved = "savedPage";
$("save-selection").dataset.saved = "savedSelection";
$("save-link").dataset.saved = "savedLink";
action($("save-page"), (tab) => savePage(tab, { prefs }));
action($("save-selection"), async (tab) => saveSelection(tab, await selectedText(tab), { prefs }));
action($("save-link"), (tab) => saveLink(tab.url, tab.title, { prefs }));

// Tidak ada menu klik kanan bawaan browser: kolom teks memakai menu sendiri, selebihnya tidak ada menu.
let ctx = null;
function closeCtx() {
  ctx?.remove();
  ctx = null;
}
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  closeCtx();
  const field = e.target.closest("input, textarea");
  if (!field) return;
  const text = field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
  const run = (fn) => () => {
    closeCtx();
    field.focus();
    fn();
  };
  const items = [
    [t("ctxCut"), run(async () => {
      if (!text) return;
      await navigator.clipboard.writeText(text).catch(() => {});
      document.execCommand("delete");
    })],
    [t("ctxCopy"), run(() => text && navigator.clipboard.writeText(text).catch(() => {}))],
    [t("ctxPaste"), run(async () => {
      const clip = await navigator.clipboard.readText().catch(() => "");
      if (clip) document.execCommand("insertText", false, clip);
    })],
    [t("ctxSelectAll"), run(() => field.select())],
  ];
  ctx = document.createElement("div");
  ctx.className = "ctx";
  ctx.setAttribute("role", "menu");
  for (const [label, fn] of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "menuitem";
    b.textContent = label;
    b.addEventListener("click", fn);
    ctx.append(b);
  }
  document.body.append(ctx);
  ctx.style.left = `${Math.max(4, Math.min(e.clientX, window.innerWidth - ctx.offsetWidth - 4))}px`;
  ctx.style.top = `${Math.max(4, Math.min(e.clientY, window.innerHeight - ctx.offsetHeight - 4))}px`;
});
document.addEventListener("pointerdown", (e) => ctx && !ctx.contains(e.target) && closeCtx());
document.addEventListener("keydown", (e) => e.key === "Escape" && ctx && (e.stopPropagation(), closeCtx()));
window.addEventListener("blur", closeCtx);

$("retry").addEventListener("click", refresh);
refresh();
