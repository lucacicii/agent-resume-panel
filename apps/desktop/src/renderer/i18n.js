/* global agentResume */

let messages = {};
let locale = "en";

function interpolate(template, args) {
  return template.replace(/\{(\d+)\}/g, (_match, indexText) => {
    const index = Number(indexText);
    const value = args[index];
    return value === undefined ? `{${indexText}}` : String(value);
  });
}

function t(key, ...args) {
  const template = messages[key] ?? key;
  return args.length > 0 ? interpolate(template, args) : template;
}

function setI18nBundle(bundle) {
  messages = bundle?.messages ?? {};
  locale = bundle?.locale ?? "en";
  document.documentElement.lang = locale;
  document.documentElement.classList.add("i18n-ready");
}

function applyDomI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      el.textContent = t(key);
    }
  });
  const titleKey = document.querySelector("title[data-i18n]")?.getAttribute("data-i18n");
  if (titleKey) {
    document.title = t(titleKey);
  }
  for (const attr of ["placeholder", "title", "aria-label"]) {
    root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
      const key = el.getAttribute(`data-i18n-${attr}`);
      if (key) {
        el.setAttribute(attr, t(key));
      }
    });
  }
}

async function initI18n() {
  const bundle = await agentResume.getI18nBundle();
  setI18nBundle(bundle);
  applyDomI18n();
  return bundle;
}

function getUiLocale() {
  return locale;
}

window.t = t;
window.setI18nBundle = setI18nBundle;
window.applyDomI18n = applyDomI18n;
window.initI18n = initI18n;
window.getUiLocale = getUiLocale;