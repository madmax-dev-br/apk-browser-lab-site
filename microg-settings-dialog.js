// "microG settings…" in the Device section (src/index.html #dev-microg-settings): microG's controls (services and account, its data, the APIs it answers, the entry points) live
// in a hidden store in the section (#dev-microg-settings-store, one block per tab: [data-microg-tab]) and are MOVED into a tabbed dialog while it is open, then back, as the
// "?" help moves its texts (src/help-tips.js). Every id, listener and status line keeps working while the dialog is closed: the panels (src/microg-services-panel.js,
// src/microg-entries-panel.js, src/app.js) write into the same elements wherever they are. The store is left out of the section's "?" help (data-help-skip): each tab shows its
// own notes. Uses the page's modal host (src/lab-modal.js: Esc and the close button close it, focus stays inside) and the help dialog's tab styles. No timer of its own.

let counter = 0;

/** The tab blocks of the store, in order: [{ id, title, element }]. */
export function microgSettingsTabs(store) {
  return [...(store?.children ?? [])].filter(element => element.dataset?.microgTab).map(element => ({ id: element.dataset.microgTab, title: element.dataset.title || element.dataset.microgTab, element }));
}

/**
 * $: getElementById; modalHost: createModalHost(); overview(): the line at the top of the dialog (whether "With microG" is on, and when the settings apply).
 * Returns { open(tabId?), close(), refresh(), get isOpen }.
 */
export function createMicrogSettingsDialog({ $, modalHost, overview = () => '', doc = globalThis.document }) {
  const store = $('dev-microg-settings-store'), button = $('dev-microg-settings');
  let modal = null, line = null, current = 'services';
  const refresh = () => { if (line) { const text = overview(); line.textContent = text; line.hidden = !text; } };

  function open(tabId = current) {
    if (modal || !store) return null;
    const tabs = microgSettingsTabs(store); if (!tabs.length) return null;
    const serial = ++counter, root = doc.createElement('div'), body = doc.createElement('div'), tablist = doc.createElement('div'), panels = doc.createElement('div'), buttons = [];
    root.className = 'microg-dialog';
    line = doc.createElement('p'); line.className = 'cp-note microg-dialog-overview'; line.setAttribute('role', 'status');
    body.className = 'help-dialog-tabs microg-dialog-tabs';
    tablist.className = 'help-tablist'; tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', 'microG settings'); tablist.setAttribute('aria-orientation', 'vertical');
    panels.className = 'help-panels microg-dialog-panels';
    const select = (index, focus = false) => {
      tabs.forEach((tab, i) => { const on = i === index; buttons[i].setAttribute('aria-selected', String(on)); buttons[i].tabIndex = on ? 0 : -1; tab.element.hidden = !on; });
      current = tabs[index].id; if (focus) buttons[index].focus();
    };
    tabs.forEach((tab, i) => {
      const item = doc.createElement('button');
      item.type = 'button'; item.className = 'help-tab'; item.setAttribute('role', 'tab'); item.id = `microg-tab-${serial}-${tab.id}`; item.dataset.microgTab = tab.id; item.textContent = tab.title;
      item.setAttribute('aria-controls', tab.element.id ||= `microg-panel-${tab.id}`);
      tab.element.setAttribute('role', 'tabpanel'); tab.element.setAttribute('aria-labelledby', item.id);
      item.addEventListener('click', () => select(i));
      item.addEventListener('keydown', event => {
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
        if (step) { event.preventDefault(); select((i + step + tabs.length) % tabs.length, true); }
        else if (event.key === 'Home') { event.preventDefault(); select(0, true); }
        else if (event.key === 'End') { event.preventDefault(); select(tabs.length - 1, true); }
      });
      buttons.push(item); tablist.append(item); panels.append(tab.element);
    });
    body.append(tablist, panels); root.append(line, body); refresh();
    const start = Math.max(0, tabs.findIndex(tab => tab.id === tabId));
    select(start);
    button?.setAttribute('aria-expanded', 'true');
    modal = modalHost.open({
      title: 'microG settings', size: 'medium', content: root,
      onClose: () => {   // the blocks go back to the section's store, as they were
        for (const tab of tabs) { tab.element.hidden = false; tab.element.removeAttribute('role'); tab.element.removeAttribute('aria-labelledby'); store.append(tab.element); }
        modal = null; line = null; button?.setAttribute('aria-expanded', 'false');
      },
    });
    buttons[start].focus();
    return modal;
  }

  button?.addEventListener('click', () => open());
  return { open, close: () => modal?.close('code'), refresh, get isOpen() { return !!modal; } };
}
