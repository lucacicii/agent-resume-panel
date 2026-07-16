/* global t, applyDomI18n, setI18nBundle, agentResume */

/**
 * Refresh static DOM strings and delegate dynamic re-renders to app.js.
 * @param {{ locale?: string, messages?: Record<string, string> } | undefined} bundle
 */
async function refreshLocalizedUi(bundle) {
  if (bundle) {
    setI18nBundle(bundle);
  }
  applyDomI18n();
  if (typeof window.renderUpdateAvailableButton === "function") {
    window.renderUpdateAvailableButton();
  }
  populateCalMonthOptions();
  if (typeof window.refreshLocalizedUiImpl === "function") {
    await window.refreshLocalizedUiImpl();
  }
}

function populateCalMonthOptions() {
  const monthSel = document.getElementById("calMonthSelect");
  if (!monthSel) return;
  const current = monthSel.value;
  for (let i = 0; i < 12; i++) {
    const opt = monthSel.options[i];
    if (opt) {
      opt.textContent = t(`desktop.calendar.month${i + 1}`);
    }
  }
  if (current !== "") {
    monthSel.value = current;
  }
}

window.refreshLocalizedUi = refreshLocalizedUi;
window.populateCalMonthOptions = populateCalMonthOptions;