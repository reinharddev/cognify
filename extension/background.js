// Menu klik kanan dan pintasan keyboard: simpan teks terpilih, halaman, atau tautan ke Cognify.
// Hasil ditandai di ikon ekstensi: ✓ tersimpan, ! gagal (detailnya di popup). Tujuan simpan mengikuti pilihan terakhir di popup.
import { explain, getPrefs, isWeb, saveLink, savePage, saveSelection, selectedText, t } from "./cognify.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    // Satu item saja untuk teks terpilih: Chrome melipat beberapa item dari satu ekstensi jadi submenu. Judulnya
    // mengikuti tujuan yang dipilih di popup (catatan melayang atau yang lain), lihat `syncTitle`.
    chrome.contextMenus.create({ id: "selection", title: t("menuSelection"), contexts: ["selection"] });
    chrome.contextMenus.create({ id: "link", title: t("menuLink"), contexts: ["link"] });
    chrome.contextMenus.create({ id: "page", title: t("menuPage"), contexts: ["page"] });
  });
});

async function syncTitle() {
  const { kind } = await getPrefs();
  chrome.contextMenus.update("selection", { title: t(kind === "sticky" ? "cmdSaveSticky" : "menuSelection") }, () => void chrome.runtime.lastError);
}
chrome.storage.onChanged.addListener((changes) => changes.prefs && syncTitle());
chrome.runtime.onStartup.addListener(syncTitle);
chrome.runtime.onInstalled.addListener(() => setTimeout(syncTitle, 300));

async function flash(tabId, ok, message) {
  await chrome.storage.local.set({ last: { ok, message, at: Date.now() } });
  if (tabId == null) return;
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#287554" : "#b0305a", tabId });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!", tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }), ok ? 2500 : 8000);
}

async function run(tab, what, info = {}) {
  if (!tab?.id || !isWeb(tab)) return flash(tab?.id, false, t("onlyWeb"));
  try {
    if (what === "selection" || what === "sticky") {
      const done = await saveSelection(tab, info.selectionText || (await selectedText(tab)), { sticky: what === "sticky" });
      const base = t(done.sticky ? "savedSticky" : done.append ? "savedAppend" : "savedSelection");
      await flash(tab.id, true, done.pdfError ? `${base} ${t("pdfFailed", [done.pdfError])}` : base);
    } else if (what === "link") {
      const done = await saveLink(info.linkUrl, info.linkText || info.linkUrl);
      await flash(tab.id, true, t(done.append ? "savedAppend" : "savedLink"));
    } else {
      const done = await savePage(tab);
      await flash(tab.id, true, t(done.sticky ? "savedSticky" : done.append ? "savedAppend" : "savedPage"));
    }
  } catch (e) {
    await flash(tab.id, false, explain(e));
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => run(tab, info.menuItemId, info));

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await run(tab, command === "save-selection" ? "selection" : command === "save-sticky" ? "sticky" : "page");
});
