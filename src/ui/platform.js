// Storage for saves and the player profile. Uses the desktop app's file system when running in
// Electron (window.native from preload.js), and falls back to localStorage in a plain browser.
const nat = window.native;
const LS = 'won-save:', PROFILE = 'won-profile';

export const platform = {
  isDesktop: !!nat,
  async listSaves() {
    if (nat) return nat.listSaves();
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k.startsWith(LS)) continue;
      try { const o = JSON.parse(localStorage.getItem(k)); out.push({ name: k.slice(LS.length), meta: o.meta, mtime: o.meta.savedAt }); } catch (e) {}
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  },
  async saveGame(name, obj) {
    const text = JSON.stringify(obj);
    if (nat) return nat.saveGame(name, text);
    localStorage.setItem(LS + name, text); return true;
  },
  async loadGame(name) {
    const text = nat ? await nat.loadGame(name) : localStorage.getItem(LS + name);
    return text ? JSON.parse(text) : null;
  },
  async deleteSave(name) { if (nat) return nat.deleteSave(name); localStorage.removeItem(LS + name); return true; },
  async readProfile() {
    try { const t = nat ? await nat.readProfile() : localStorage.getItem(PROFILE); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  },
  async writeProfile(obj) { const t = JSON.stringify(obj); try { if (nat) await nat.writeProfile(t); else localStorage.setItem(PROFILE, t); } catch (e) {} },
  toggleFullscreen() {
    if (nat) return nat.toggleFullscreen();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen().catch(() => {});
  },
  quit() { if (nat) nat.quit(); },
  openSavesFolder() { if (nat) nat.openSavesFolder(); },
};
