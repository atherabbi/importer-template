#!/usr/bin/env node
// Builds the whole website into dist/ from the files in content/.
// Runs automatically on Cloudflare Pages / Netlify after every change saved in the admin screen.
// No packages to install: plain Node.js 18 or newer.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { UI } from "./src/strings.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "dist");
const warnings = [];
const warn = (m) => warnings.push(m);

/* ---------- reading content ---------- */
const slugify = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const readJson = (rel) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
  catch (e) { warn(`Could not read ${rel}: ${e.message}`); return {}; }
};
const loadDir = (rel) => {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f, i) => ({
    ...readJson(`${rel}/${f}`), slug: slugify(f.slice(0, -5)) || `item-${i + 1}`, _file: `${rel}/${f}`,
  }));
};
const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.name_en || a.name || "").localeCompare(String(b.name_en || b.name || ""));

const company = readJson("content/settings/company.json");
const site = readJson("content/settings/site.json");
const design = readJson("content/settings/design.json");
const sections = readJson("content/settings/sections.json");
const home = readJson("content/settings/home.json");
const inquiry = readJson("content/settings/inquiry.json");
const SETTINGS_FILES = ["company", "site", "design", "sections", "home", "inquiry"].map((n) => `content/settings/${n}.json`);

const on = (key) => sections[key] !== false; // every section is shown unless switched off

const brands = loadDir("content/brands").sort(byOrder);
const categories = loadDir("content/categories").sort(byOrder);
const products = loadDir("content/products").filter((p) => p.published !== false).sort(byOrder);
const HAS_PRICES = on("show_mrp") && products.some((p) => p.mrp);
const brandBy = Object.fromEntries(brands.map((b) => [b.slug, b]));
const catBy = Object.fromEntries(categories.map((c) => [c.slug, c]));
for (const p of products) {
  p.brand = slugify(p.brand); p.category = slugify(p.category);
  if (!brandBy[p.brand]) warn(`Product "${p.name_en}" has no matching brand ("${p.brand}").`);
  if (!catBy[p.category]) warn(`Product "${p.name_en}" has no matching category ("${p.category}").`);
}

/* ---------- languages and addresses ---------- */
const bnOn = site.enable_bangla !== false;
const defLang = bnOn && site.default_language === "bn" ? "bn" : "en";
const LANGS = bnOn ? [defLang, defLang === "en" ? "bn" : "en"] : ["en"];
const prefix = (lang) => (lang === defLang ? "" : "/" + lang);

// A preview deployment (PREVIEW_URL) is served from its own address and is kept out of search engines.
const PREVIEW = String(process.env.PREVIEW_URL || "").trim();
let SITE = String(PREVIEW || site.site_url || process.env.URL || process.env.CF_PAGES_URL || "").trim().replace(/\/+$/, "");
if (!SITE) { SITE = "https://example.com"; warn("No website address set yet (Settings → Search engines → Website address). Using https://example.com in the sitemap."); }
if (!/^https?:\/\//.test(SITE)) SITE = "https://" + SITE;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const L = (o, key, lang) => (o && (o[`${key}_${lang}`] || o[`${key}_en`] || o[`${key}_bn`])) || "";
const t = (lang, key, vars = {}) => String(UI[lang]?.[key] ?? UI.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const num = (n, lang) => Number(n).toLocaleString(lang === "bn" ? "bn-BD" : "en-US");
const money = (n, lang) => "৳ " + num(n, lang);
// BASE is empty on a normal domain. It is only set when the site lives in a sub-folder (for example a GitHub Pages preview).
const BASE = (() => { try { return new URL(SITE).pathname.replace(/\/+$/, ""); } catch { return ""; } })();
const asset = (p) => (/^https?:/.test(p) ? p : BASE + (String(p).startsWith("/") ? p : "/" + p));
const u = (lang, p) => BASE + prefix(lang) + p;
const abs = (lang, p) => SITE + prefix(lang) + p;
const absAsset = (p) => (/^https?:/.test(p) ? p : SITE + (p.startsWith("/") ? p : "/" + p));
const COMPANY = company.name || "Company name";
const brandName = (p) => brandBy[p.brand]?.name || "";
const originOf = (p, lang) => L(p, "origin", lang) || L(brandBy[p.brand], "country", lang);
const clip = (s, n = 158) => { s = String(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };

/* ---------- colours ---------- */
const rgb = (hex) => { let h = String(hex || "").replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join(""); const n = parseInt(h, 16); return Number.isNaN(n) || h.length !== 6 ? null : [n >> 16, (n >> 8) & 255, n & 255]; };
const hex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, w) => hex(rgb(a).map((v, i) => v * (1 - w) + rgb(b)[i] * w));
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const PRIMARY = rgb(design.primary) ? design.primary : "#0A6B62";
const ACCENT = rgb(design.accent) ? design.accent : "#F6B93B";
const CAT_DEFAULTS = [PRIMARY, "#A8405F", "#8A5A12", "#3F5FA8", "#6B4FA0", "#2F7A3D"];
const catColor = (c, i) => (rgb(c.color) ? c.color : CAT_DEFAULTS[i % CAT_DEFAULTS.length]);

function themeCss() {
  const ink = mix(PRIMARY, "#101A1C", 0.8), bg = mix(PRIMARY, "#ffffff", 0.94);
  const labelInk = lum(ACCENT) > 0.4 ? "#2A1E00" : "#ffffff";
  const dPrimary = lum(PRIMARY) > 0.35 ? PRIMARY : mix(PRIMARY, "#ffffff", 0.5);
  const dBg = mix(PRIMARY, "#0B1012", 0.88);
  const light = {
    bg, surface: "#ffffff", ink, muted: mix(ink, bg, 0.3), line: mix(PRIMARY, "#ffffff", 0.8),
    primary: PRIMARY, "primary-ink": lum(PRIMARY) > 0.4 ? ink : "#ffffff", tint: mix(PRIMARY, "#ffffff", 0.86),
    label: ACCENT, "label-ink": labelInk, "label-rule": mix(ACCENT, labelInk, 0.35), danger: "#A32A2A", "foot-bg": ink, "foot-ink": bg,
  };
  const dark = {
    bg: dBg, surface: mix(PRIMARY, "#131C1E", 0.84), ink: mix(PRIMARY, "#ffffff", 0.9), muted: mix(PRIMARY, "#ffffff", 0.62),
    line: mix(PRIMARY, "#263234", 0.78), primary: dPrimary, "primary-ink": dBg, tint: mix(PRIMARY, "#111A1C", 0.72),
    label: ACCENT, "label-ink": labelInk, "label-rule": mix(ACCENT, labelInk, 0.35), danger: "#F08A8A", "foot-bg": mix(PRIMARY, "#06090A", 0.92), "foot-ink": mix(PRIMARY, "#ffffff", 0.9),
  };
  categories.forEach((c, i) => { light[`cat-${c.slug}`] = catColor(c, i); dark[`cat-${c.slug}`] = mix(catColor(c, i), "#ffffff", 0.5); });
  const vars = (o) => Object.entries(o).map(([k, v]) => `--${k}:${v}`).join(";");
  return `:root{${vars(light)};--display:"Anek Latin","Anek Bangla",system-ui,-apple-system,"Segoe UI",sans-serif;--body:"Hind Siliguri","Noto Sans Bengali",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--r:14px}
@media (prefers-color-scheme:dark){:root{${vars(dark)};color-scheme:dark}}
${categories.map((c) => `.cat-${c.slug}{--cat:var(--cat-${c.slug})}`).join("")}
`;
}

/* ---------- last-changed dates for the sitemap (taken from the change history when available) ---------- */
const gitOk = (() => {
  try {
    const o = { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] };
    return execSync("git rev-parse --is-inside-work-tree", o).toString().trim() === "true" &&
           execSync("git rev-parse --is-shallow-repository", o).toString().trim() === "false";
  } catch { return false; }
})();
const dateCache = {};
const lastmod = (files) => {
  if (!gitOk) return "";
  let best = "";
  for (const f of files) {
    if (!(f in dateCache)) {
      try { dateCache[f] = execSync(`git log -1 --format=%cI -- "${f}"`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
      catch { dateCache[f] = ""; }
    }
    if (dateCache[f] > best) best = dateCache[f];
  }
  return best;
};

/* ---------- small building blocks ---------- */
const SHAPES = {
  bottle: '<rect class="pk-cap" x="28" y="8" width="24" height="12" rx="3"/><rect class="pk-body" x="20" y="20" width="40" height="66" rx="8"/><rect class="pk-label" x="20" y="42" width="40" height="24"/>',
  box: '<rect class="pk-body" x="16" y="20" width="48" height="66" rx="3"/><rect class="pk-cap" x="16" y="20" width="48" height="8" rx="3"/><rect class="pk-label" x="16" y="44" width="48" height="22"/>',
  tube: '<path class="pk-body" d="M27 10h26l5 62H22z"/><rect class="pk-label" x="24" y="36" width="32" height="18"/><rect class="pk-cap" x="28" y="72" width="24" height="14" rx="3"/>',
  dropper: '<rect class="pk-cap" x="34" y="4" width="12" height="16" rx="5"/><rect class="pk-cap" x="29" y="20" width="22" height="8" rx="2"/><rect class="pk-body" x="24" y="28" width="32" height="58" rx="6"/><rect class="pk-label" x="24" y="46" width="32" height="22"/>',
  pump: '<rect class="pk-cap" x="36" y="6" width="20" height="6" rx="2"/><rect class="pk-cap" x="37" y="12" width="6" height="12"/><rect class="pk-body" x="22" y="24" width="36" height="62" rx="6"/><rect class="pk-label" x="22" y="44" width="36" height="24"/>',
  jar: '<rect class="pk-cap" x="14" y="30" width="52" height="14" rx="3"/><rect class="pk-body" x="17" y="44" width="46" height="42" rx="8"/><rect class="pk-label" x="17" y="56" width="46" height="18"/>',
};
const visual = (p, lang, eager) => p.image
  ? `<img src="${esc(asset(p.image))}" alt="${esc(brandName(p) + " " + L(p, "name", lang))}" width="480" height="480"${eager ? "" : ' loading="lazy"'}>`
  : `<svg viewBox="0 0 80 92" aria-hidden="true">${SHAPES[p.pack_shape] || SHAPES.bottle}</svg>`;

const card = (p, lang) => {
  const hay = [p.name_en, p.name_bn, brandName(p), p.description_en, p.description_bn, originOf(p, "en"), originOf(p, "bn"),
    catBy[p.category]?.name_en, catBy[p.category]?.name_bn, ...(p.composition || [])].filter(Boolean).join(" ").toLowerCase();
  const strip = [on("show_reg_no") && p.reg_no ? `<span class="reg">${esc(p.reg_no)}</span>` : "",
    on("show_mrp") && p.mrp ? `<span class="mrp">${money(p.mrp, lang)}</span>` : ""].join("");
  return `<a class="card cat-${p.category}" href="${u(lang, `/products/${p.slug}/`)}" data-cat="${p.category}" data-brand="${p.brand}" data-search="${esc(hay)}">
<span class="card-vis">${catBy[p.category] ? `<span class="cat-tag">${esc(L(catBy[p.category], "name", lang))}</span>` : ""}${visual(p, lang)}</span>
<span class="card-body"><span class="card-brand">${esc([brandName(p), originOf(p, lang)].filter(Boolean).join(" · "))}</span><span class="card-name">${esc(L(p, "name", lang))}</span><span class="card-pack">${esc(L(p, "pack", lang))}</span></span>
${strip ? `<span class="card-strip">${strip}</span>` : ""}</a>`;
};
const gridOf = (list, lang, id = "") => `<div class="grid"${id ? ` id="${id}"` : ""}>${list.map((p) => card(p, lang)).join("\n")}</div>`;
const crumbs = (lang, items) => `<nav class="crumbs wrap" aria-label="Breadcrumb">${items.map((it, i) => (it.href ? `<a href="${it.href}">${esc(it.name)}</a>` : `<span>${esc(it.name)}</span>`) + (i < items.length - 1 ? '<span aria-hidden="true">/</span>' : "")).join("")}</nav>`;
const crumbLd = (lang, items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.abs })) });
const inquiryHref = (lang, query = "") => u(lang, "/") + query + (on("pharmacies") && on("inquiry_form") ? "#pharmacies" : "#contact");

/* ---------- page frame ---------- */
function layout(lang, page, r) {
  const canonical = abs(lang, page.path);
  const title = r.title;
  const desc = clip(r.desc || L(site, "meta_description", lang));
  const img = r.image || site.share_image || company.logo || "";
  const alternates = page.noindex || PREVIEW || LANGS.length < 2 ? "" :
    LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${abs(l, page.path)}">`).join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${abs(defLang, page.path)}">`;
  const nav = [
    [u(lang, "/products/"), "nav_products", true],
    [u(lang, "/") + "#check", "nav_check", on("check_pack")],
    [u(lang, "/") + "#doctors", "nav_doctors", on("doctors")],
    [u(lang, "/") + "#pharmacies", "nav_pharm", on("pharmacies")],
    ["#contact", "nav_contact", on("contact")],
  ].filter((n) => n[2]).map((n) => `<a href="${n[0]}">${t(lang, n[1])}</a>`).join("");
  const i18n = Object.fromEntries(["count_one", "count_many", "sending", "sent_ok", "sent_fail", "copy", "copied", "copy_fail"].map((k) => [k, UI[lang][k] ?? UI.en[k]]));
  const contact = [
    company.phone ? [t(lang, "hotline"), `<a href="tel:${esc(String(company.phone).replace(/[^\d+]/g, ""))}">${esc(company.phone)}</a>`] : null,
    company.whatsapp ? [t(lang, "whatsapp"), `<a href="https://wa.me/${String(company.whatsapp).replace(/\D/g, "")}" rel="noopener">${esc(company.whatsapp)}</a>`] : null,
    company.email ? [t(lang, "email"), `<a href="mailto:${esc(company.email)}">${esc(company.email)}</a>`] : null,
    L(company, "address", lang) ? [t(lang, "address"), esc(L(company, "address", lang))] : null,
  ].filter(Boolean);
  const ld = (r.jsonld || []).map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n");

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${page.noindex || PREVIEW ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${canonical}">`}
${alternates}
<meta property="og:type" content="${r.ogType || "website"}">
<meta property="og:site_name" content="${esc(COMPANY)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:locale" content="${lang === "bn" ? "bn_BD" : "en_US"}">
${img ? `<meta property="og:image" content="${esc(absAsset(img))}">\n<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
${site.google_verification ? `<meta name="google-site-verification" content="${esc(site.google_verification)}">` : ""}
${site.bing_verification ? `<meta name="msvalidate.01" content="${esc(site.bing_verification)}">` : ""}
${company.icon ? `<link rel="icon" href="${esc(asset(company.icon))}">` : `<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">`}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anek+Bangla:wght@500;600;700&family=Anek+Latin:wght@500;600;700&family=Hind+Siliguri:wght@400;500;600&display=swap">
<link rel="stylesheet" href="${BASE}/assets/style.css?v=${ASSET_V}">
${ld}
</head>
<body>
${on("notice_bar") && L(home, "notice", lang) ? `<div class="ribbon"><div class="wrap">${esc(L(home, "notice", lang))}</div></div>` : ""}
<header class="top"><div class="wrap top-in">
<a class="logo" href="${u(lang, "/")}">${company.logo ? `<img src="${esc(asset(company.logo))}" alt="${esc(COMPANY)}" height="48">${company.logo_with_name ? `<span>${esc(COMPANY)}</span>` : ""}` : `<span class="logo-mark" aria-hidden="true"></span>${esc(COMPANY)}`}</a>
<nav class="nav" aria-label="Main">${nav}</nav>
${LANGS.length > 1 ? `<div class="lang">${["en", "bn"].filter((l) => LANGS.includes(l)).map((l) => `<a href="${u(l, page.noindex ? "/" : page.path)}" lang="${l}"${l === lang ? ' aria-current="true"' : ""}>${UI[l].lang_name}</a>`).join("")}</div>` : ""}
</div></header>
<main>
${r.body}
</main>
<footer class="foot" id="contact"><div class="wrap">
${on("contact") ? `<div class="foot-in"><div><h2>${t(lang, "contact_h")}</h2>${L(company, "hours", lang) ? `<p style="opacity:.8;margin-top:6px">${esc(L(company, "hours", lang))}</p>` : ""}</div>
${contact.map(([k, v]) => `<dl><dt>${k}</dt><dd>${v}</dd></dl>`).join("")}</div>` : ""}
<div class="disc">${on("disclaimer") && L(home, "disclaimer", lang) ? `<p>${esc(L(home, "disclaimer", lang))}</p>` : ""}
<p>© ${new Date().getFullYear()} ${esc(String(company.legal_name || COMPANY).replace(/\.+$/, ""))}. ${t(lang, "rights")}</p></div>
</div></footer>
<script type="application/json" id="i18n">${JSON.stringify(i18n).replace(/</g, "\\u003c")}</script>
<script src="${BASE}/assets/app.js?v=${ASSET_V}" defer></script>
</body>
</html>
`;
}

/* ---------- pages ---------- */
function homePage(lang) {
  const featured = products.filter((p) => p.featured);
  const shown = (featured.length ? featured : products).slice(0, 8);
  const lab = home.label || {};
  const out = [];

  out.push(`<section class="hero"><div class="wrap hero-in${on("hero_label") ? "" : " solo"}">
<div class="hero-copy">
${L(home, "eyebrow", lang) ? `<span class="eyebrow">${esc(L(home, "eyebrow", lang))}</span>` : ""}
<h1>${esc(L(home, "headline", lang) || COMPANY)}</h1>
${L(home, "intro", lang) ? `<p>${esc(L(home, "intro", lang))}</p>` : ""}
${on("hero_search") ? `<form class="search" role="search" action="${u(lang, "/products/")}" method="get"><input type="search" name="q" placeholder="${t(lang, "search_ph")}" aria-label="${t(lang, "search_ph")}" autocomplete="off"><button class="btn" type="submit">${t(lang, "search_btn")}</button></form>` : ""}
${on("doctors") || on("pharmacies") ? `<div class="hero-links">${on("doctors") ? `<a class="btn btn-ghost" href="#doctors">${t(lang, "hero_doc")}</a>` : ""}${on("pharmacies") ? `<a class="btn btn-ghost" href="#pharmacies">${t(lang, "hero_ph")}</a>` : ""}</div>` : ""}
</div>
${on("hero_label") ? `<div class="label-wrap"><figure class="label" aria-label="Importer label">
<div class="label-by"><span>Imported &amp; marketed by</span><strong>${esc(company.legal_name || COMPANY)}</strong><span>${esc(company.city_en || "Bangladesh")}</span></div>
<dl>${[["Reg. no.", lab.reg_no], ["Batch", lab.batch], ["MFG", lab.mfg], ["EXP", lab.exp], ["Origin", lab.origin]].filter((x) => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
<div class="label-mrp"><div>${lab.mrp ? `<small>MRP (INCL. VAT)</small><b>${money(lab.mrp, "en")}</b>` : ""}</div><div class="holo" aria-hidden="true"></div></div>
</figure>${L(home, "label_caption", lang) ? `<p class="label-cap">${esc(L(home, "label_caption", lang))}</p>` : ""}</div>` : ""}
</div></section>`);

  if (on("check_pack") && (home.check_items || []).length) out.push(`<section class="sec" id="check"><div class="wrap">
<div class="sec-head"><h2>${esc(L(home, "check_heading", lang))}</h2><p>${esc(L(home, "check_intro", lang))}</p></div>
<div class="checks">${home.check_items.map((c) => `<div class="check"><h3>${esc(L(c, "title", lang))}</h3><p>${esc(L(c, "text", lang))}</p></div>`).join("")}</div>
</div></section>`);

  if (on("brands") && brands.length) out.push(`<section class="sec band" id="brands"><div class="wrap">
<div class="sec-head"><h2>${t(lang, "brands_h")}</h2></div>
<div class="brands">${brands.map((b) => `<a class="brand-chip" href="${u(lang, `/brands/${b.slug}/`)}">${b.logo ? `<img src="${esc(asset(b.logo))}" alt="" height="28" loading="lazy">` : ""}<b>${esc(b.name)}</b><span>${esc(L(b, "country", lang))}</span></a>`).join("")}</div>
</div></section>`);

  if (on("featured_products") && shown.length) out.push(`<section class="sec" id="products"><div class="wrap">
<div class="sec-head"><h2>${t(lang, "featured_h")}</h2>${HAS_PRICES ? `<p>${t(lang, "catalogue_mrp")}</p>` : ""}</div>
${gridOf(shown, lang)}
<p class="more"><a class="btn" href="${u(lang, "/products/")}">${t(lang, "view_all")}</a></p>
</div></section>`);

  if (on("doctors")) out.push(`<section class="sec band" id="doctors"><div class="wrap">
<div class="sec-head"><h2>${esc(L(home, "doctors_heading", lang) || t(lang, "nav_doctors"))}</h2><p>${esc(L(home, "doctors_intro", lang))}</p></div>
${(home.doctors_items || []).length ? `<div class="docs">${home.doctors_items.map((d) => `<div><h3>${esc(L(d, "title", lang))}</h3><p>${esc(L(d, "text", lang))}</p></div>`).join("")}</div>` : ""}
${on("composition_table") && products.length ? `<div class="tbl-scroll"><table><thead><tr><th>${t(lang, "th_prod")}</th><th>${t(lang, "th_comp")}</th><th>${t(lang, "th_pack")}</th><th>${t(lang, "th_origin")}</th></tr></thead><tbody>
${products.map((p) => `<tr><td><a href="${u(lang, `/products/${p.slug}/`)}">${esc(L(p, "name", lang))}</a><span class="sub">${esc(brandName(p))}</span></td><td>${(p.composition || []).map(esc).join("<br>")}</td><td>${esc(L(p, "pack", lang))}</td><td>${esc(originOf(p, lang))}</td></tr>`).join("\n")}
</tbody></table></div>` : ""}
<a class="btn" href="${inquiryHref(lang, "?role=doc")}">${t(lang, "doc_btn")}</a>
</div></section>`);

  if (on("pharmacies")) out.push(`<section class="sec" id="pharmacies"><div class="wrap${on("inquiry_form") ? " split" : ""}">
<div><div class="sec-head" style="margin-bottom:0"><h2>${esc(L(home, "pharm_heading", lang) || t(lang, "nav_pharm"))}</h2><p>${esc(L(home, "pharm_intro", lang))}</p></div>
${(home.pharm_points || []).length ? `<ul class="ticks">${home.pharm_points.map((x) => `<li>${esc(L(x, "text", lang))}</li>`).join("")}</ul>` : ""}</div>
${on("inquiry_form") ? form(lang) : ""}
</div></section>`);

  const org = {
    "@context": "https://schema.org", "@type": "Organization", name: COMPANY, legalName: company.legal_name || undefined, url: SITE + "/",
    logo: company.logo ? absAsset(company.logo) : undefined, telephone: company.phone || undefined, email: company.email || undefined,
    address: company.address_en ? { "@type": "PostalAddress", streetAddress: company.address_en, addressLocality: company.city_en || undefined, addressCountry: "BD" } : undefined,
  };
  const web = {
    "@context": "https://schema.org", "@type": "WebSite", name: COMPANY, url: abs(lang, "/"), inLanguage: lang,
    potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: abs(lang, "/products/") + "?q={search_term_string}" }, "query-input": "required name=search_term_string" },
  };
  return { title: `${COMPANY} | ${L(home, "eyebrow", lang) || L(home, "headline", lang)}`, desc: L(site, "meta_description", lang) || L(home, "intro", lang), body: out.join("\n"), jsonld: [org, web] };
}

function form(lang) {
  const f = (id, key, attrs = "") => `<label><span>${t(lang, key)}</span><input id="${id}" data-l="${t(lang, key).replace(/\s*\(.*\)$/, "")}" ${attrs}></label>`;
  const wa = String(company.whatsapp || "").replace(/\D/g, "");
  return `<form class="form" id="inqForm" novalidate data-key="${esc(inquiry.access_key || "")}" data-wa="${wa}" data-subject="${esc(inquiry.subject || `Website inquiry: ${COMPANY}`)}" data-site="${esc(COMPANY)}">
<label><span>${t(lang, "f_role")}</span><select id="inqRole" data-l="${t(lang, "f_role")}"><option value="pharm">${t(lang, "r_pharm")}</option><option value="doc">${t(lang, "r_doc")}</option><option value="other">${t(lang, "r_other")}</option></select></label>
${f("inqName", "f_name", 'type="text" autocomplete="name"')}
${f("inqOrg", "f_org", 'type="text" autocomplete="organization"')}
${f("inqLic", "f_lic", 'type="text"')}
${f("inqDist", "f_dist", 'type="text"')}
${f("inqPhone", "f_phone", 'type="tel" inputmode="tel" placeholder="01XXXXXXXXX" autocomplete="tel"')}
<label class="full"><span>${t(lang, "f_prods")}</span><input id="inqProds" data-l="${t(lang, "f_prods")}" type="text"></label>
<label class="full"><span>${t(lang, "f_msg")}</span><textarea id="inqMsg" data-l="${t(lang, "f_msg").replace(/\s*\(.*\)$/, "")}"></textarea></label>
<input class="hp" type="checkbox" id="inqBot" tabindex="-1" autocomplete="off" aria-hidden="true">
<p class="err full" id="inqErr" role="alert" hidden>${t(lang, "err")}</p>
<div class="full"><button class="btn" type="submit">${t(lang, "f_submit")}</button></div>
<p class="full" id="inqStatus" role="status" hidden></p>
<div class="out full" id="inqOut" hidden><h3>${t(lang, "out_h")}</h3><p>${t(lang, "out_p")}</p><pre id="inqText"></pre>
<div class="out-actions">${wa ? `<a class="btn" id="waBtn" href="https://wa.me/${wa}" target="_blank" rel="noopener">${t(lang, "wa_btn")}</a>` : ""}<button type="button" class="btn btn-ghost" id="copyBtn">${t(lang, "copy")}</button></div></div>
</form>`;
}

function filterBar(lang, list) {
  const cats = categories.filter((c) => list.some((p) => p.category === c.slug));
  const brs = brands.filter((b) => list.some((p) => p.brand === b.slug));
  return `<div class="filters">
<input class="field q" type="search" id="q" placeholder="${t(lang, "search_ph")}" aria-label="${t(lang, "search_ph")}" autocomplete="off">
${cats.length > 1 ? `<div class="chips" role="group"><button type="button" class="chip" data-cat="all" aria-pressed="true">${t(lang, "f_all")}</button>${cats.map((c) => `<button type="button" class="chip" data-cat="${c.slug}" aria-pressed="false">${esc(L(c, "name", lang))}</button>`).join("")}</div>` : ""}
${brs.length > 1 ? `<select class="field" id="brandSel" aria-label="${t(lang, "f_brand")}"><option value="">${t(lang, "f_brand")}</option>${brs.map((b) => `<option value="${b.slug}">${esc(b.name)}${L(b, "country", lang) ? " · " + esc(L(b, "country", lang)) : ""}</option>`).join("")}</select>` : ""}
<span class="count" id="count" aria-live="polite">${t(lang, list.length === 1 ? "count_one" : "count_many", { n: num(list.length, lang) })}</span>
</div>
${gridOf(list, lang, "grid")}
<div class="empty" id="empty" hidden><p>${t(lang, "empty")}</p><button type="button" class="btn btn-ghost" id="clearBtn">${t(lang, "clear")}</button></div>`;
}

function cataloguePage(lang) {
  const items = [{ name: t(lang, "home"), href: u(lang, "/"), abs: abs(lang, "/") }, { name: t(lang, "nav_products"), abs: abs(lang, "/products/") }];
  return {
    title: `${t(lang, "catalogue_h")} | ${COMPANY}`, desc: t(lang, "catalogue_desc", { company: COMPANY }),
    body: `${crumbs(lang, items)}<section class="sec" style="padding-top:20px"><div class="wrap">
<div class="sec-head"><h1>${t(lang, "catalogue_h")}</h1><p>${HAS_PRICES ? t(lang, "catalogue_mrp") : t(lang, "catalogue_p")}</p></div>
${products.length ? filterBar(lang, products) : `<div class="empty"><p>${t(lang, "no_products")}</p></div>`}</div></section>`,
    jsonld: [crumbLd(lang, items)],
  };
}

function listPage(lang, heading, intro, list, items, desc) {
  return {
    title: `${heading} | ${COMPANY}`, desc,
    body: `${crumbs(lang, items)}<section class="sec" style="padding-top:20px"><div class="wrap">
<div class="sec-head"><h1>${esc(heading)}</h1>${intro ? `<p>${esc(intro)}</p>` : ""}</div>
${filterBar(lang, list)}</div></section>`,
    jsonld: [crumbLd(lang, items)],
  };
}

function productPage(lang, p) {
  const b = brandBy[p.brand], c = catBy[p.category], name = L(p, "name", lang);
  const items = [{ name: t(lang, "home"), href: u(lang, "/"), abs: abs(lang, "/") }, { name: t(lang, "nav_products"), href: u(lang, "/products/"), abs: abs(lang, "/products/") }];
  if (c) items.push({ name: L(c, "name", lang), href: u(lang, `/category/${c.slug}/`), abs: abs(lang, `/category/${c.slug}/`) });
  items.push({ name, abs: abs(lang, `/products/${p.slug}/`) });
  const spec = [
    (p.composition || []).length ? [t(lang, "m_comp"), `<ul>${p.composition.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`] : null,
    L(p, "usage", lang) ? [t(lang, "m_use"), esc(L(p, "usage", lang))] : null,
    L(p, "pack", lang) ? [t(lang, "m_pack"), esc(L(p, "pack", lang))] : null,
    originOf(p, lang) ? [t(lang, "m_origin"), esc(originOf(p, lang))] : null,
    on("show_reg_no") && p.reg_no ? [t(lang, "m_reg"), `<span class="mono">${esc(p.reg_no)}</span>`] : null,
    on("show_mrp") && p.mrp ? [t(lang, "m_mrp"), `<span class="price">${money(p.mrp, lang)}</span>`] : null,
  ].filter(Boolean);
  const more = products.filter((x) => x.brand === p.brand && x.slug !== p.slug).slice(0, 4);
  const full = [brandName(p), name].filter(Boolean).join(" ");
  const ld = {
    "@context": "https://schema.org", "@type": "Product", name, description: L(p, "description", lang) || undefined, url: abs(lang, `/products/${p.slug}/`),
    image: p.image ? absAsset(p.image) : undefined, brand: b ? { "@type": "Brand", name: b.name } : undefined, category: c ? L(c, "name", lang) : undefined,
    sku: p.reg_no || undefined, countryOfOrigin: originOf(p, "en") ? { "@type": "Country", name: originOf(p, "en") } : undefined,
    offers: on("show_mrp") && p.mrp ? { "@type": "Offer", price: String(p.mrp), priceCurrency: "BDT", availability: "https://schema.org/InStoreOnly", url: abs(lang, `/products/${p.slug}/`), seller: { "@type": "Organization", name: COMPANY } } : undefined,
  };
  return {
    title: [`${name}${L(p, "pack", lang) ? ", " + L(p, "pack", lang) : ""}`, brandName(p), COMPANY].filter(Boolean).join(" | "),
    desc: [L(p, "description", lang), (p.composition || []).length ? p.composition.slice(0, 3).join(", ") + "." : "", t(lang, "product_desc_tail", { company: COMPANY })].filter(Boolean).join(" "),
    image: p.image, ogType: "product",
    body: `${crumbs(lang, items)}<div class="wrap"><article class="product cat-${p.category}">
<div class="product-vis">${c ? `<span class="cat-tag">${esc(L(c, "name", lang))}</span>` : ""}${visual(p, lang, true)}</div>
<div class="product-body">
<div>${b ? `<a class="card-brand" href="${u(lang, `/brands/${b.slug}/`)}">${esc([b.name, L(b, "country", lang)].filter(Boolean).join(" · "))}</a>` : ""}<h1>${esc(name)}</h1></div>
${L(p, "description", lang) ? `<p class="lead">${esc(L(p, "description", lang))}</p>` : ""}
<dl class="spec">${spec.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
<p class="note">${t(lang, "m_buy")} ${t(lang, "imported_by", { company: esc(COMPANY) })}</p>
<div><a class="btn" href="${inquiryHref(lang, "?product=" + encodeURIComponent(name))}">${t(lang, "m_ask")}</a></div>
</div></article></div>
${more.length ? `<section class="sec band"><div class="wrap"><div class="sec-head"><h2>${esc(t(lang, "more_from", { brand: brandName(p) }))}</h2></div>${gridOf(more, lang)}</div></section>` : ""}`,
    jsonld: [ld, crumbLd(lang, items)],
  };
}

/* ---------- list of every page ---------- */
const ALL_FILES = [...SETTINGS_FILES, ...products.map((p) => p._file), ...brands.map((b) => b._file), ...categories.map((c) => c._file)];
const pages = [
  { path: "/", files: ALL_FILES, render: homePage },
  { path: "/products/", files: ALL_FILES, render: cataloguePage },
  ...products.map((p) => ({ path: `/products/${p.slug}/`, files: [p._file, brandBy[p.brand]?._file, catBy[p.category]?._file].filter(Boolean), render: (lang) => productPage(lang, p) })),
  ...brands.filter((b) => products.some((p) => p.brand === b.slug)).map((b) => ({
    path: `/brands/${b.slug}/`, files: [b._file, ...products.filter((p) => p.brand === b.slug).map((p) => p._file)],
    render: (lang) => {
      const items = [{ name: t(lang, "home"), href: u(lang, "/"), abs: abs(lang, "/") }, { name: t(lang, "nav_products"), href: u(lang, "/products/"), abs: abs(lang, "/products/") }, { name: b.name, abs: abs(lang, `/brands/${b.slug}/`) }];
      const vars = { brand: b.name, country: L(b, "country", lang), company: COMPANY };
      return listPage(lang, t(lang, "brand_products", vars), L(b, "description", lang) || t(lang, "brand_desc", vars), products.filter((p) => p.brand === b.slug), items, L(b, "description", lang) || t(lang, "brand_desc", vars));
    },
  })),
  ...categories.filter((c) => products.some((p) => p.category === c.slug)).map((c) => ({
    path: `/category/${c.slug}/`, files: [c._file, ...products.filter((p) => p.category === c.slug).map((p) => p._file)],
    render: (lang) => {
      const items = [{ name: t(lang, "home"), href: u(lang, "/"), abs: abs(lang, "/") }, { name: t(lang, "nav_products"), href: u(lang, "/products/"), abs: abs(lang, "/products/") }, { name: L(c, "name", lang), abs: abs(lang, `/category/${c.slug}/`) }];
      const d = L(c, "description", lang) || t(lang, "cat_desc", { category: L(c, "name", lang), company: COMPANY });
      return listPage(lang, L(c, "name", lang), d, products.filter((p) => p.category === c.slug), items, d);
    },
  })),
];

/* ---------- write everything ---------- */
const write = (rel, text) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
if (fs.existsSync(path.join(ROOT, "public"))) fs.cpSync(path.join(ROOT, "public"), OUT, { recursive: true });

const css = themeCss() + fs.readFileSync(path.join(ROOT, "src/style.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "src/app.js"), "utf8");
const ASSET_V = crypto.createHash("sha1").update(css + js).digest("hex").slice(0, 8);
write("assets/style.css", css);
write("assets/app.js", js);
write("favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${PRIMARY}"/><path d="M14 7h4v18h-4zM7 14h18v4H7z" fill="${lum(PRIMARY) > 0.4 ? "#10201f" : "#fff"}"/></svg>`);

let count = 0;
for (const page of pages) for (const lang of LANGS) {
  write(path.join(prefix(lang), page.path, "index.html"), layout(lang, page, page.render(lang)));
  count++;
}
const nf = { path: "/404.html", noindex: true };
write("404.html", layout(defLang, nf, {
  title: `${t(defLang, "nf_h")} | ${COMPANY}`, desc: t(defLang, "nf_p"),
  body: `<section class="sec"><div class="wrap"><div class="sec-head"><h1>${t(defLang, "nf_h")}</h1><p>${t(defLang, "nf_p")}</p></div><a class="btn" href="${u(defLang, "/products/")}">${t(defLang, "nf_btn")}</a></div></section>`,
}));

// sitemap.xml: every page in every language, rebuilt on every change
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.flatMap((page) => LANGS.map((lang) => {
  const lm = lastmod(page.files);
  const alts = LANGS.length > 1 ? LANGS.map((l) => `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${abs(l, page.path)}"/>`).join("") + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(defLang, page.path)}"/>` : "";
  return `  <url>\n    <loc>${abs(lang, page.path)}</loc>${lm ? `\n    <lastmod>${lm}</lastmod>` : ""}${alts}\n  </url>`;
})).join("\n")}
</urlset>
`;
write("sitemap.xml", sitemap);
write("robots.txt", `User-agent: *\nAllow: /\nDisallow: ${BASE}/admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);

// admin screen: connect it to this site's GitHub repository
function detectRepo() {
  const cands = [process.env.CMS_REPO, process.env.REPOSITORY_URL];
  try { cands.push(execSync("git remote get-url origin", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()); } catch {}
  for (const c of cands) {
    const m = c && c.trim().match(/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return "";
}
const adminSrc = path.join(ROOT, "admin");
const COMMIT = (() => {
  const env = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.COMMIT_REF;
  if (env) return env;
  try { return execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
})();
// The admin screen compares this with the change it just saved, to know when the site is live.
write("build.json", JSON.stringify({ sha: COMMIT, built: new Date().toISOString() }) + "\n");
if (fs.existsSync(adminSrc)) {
  const repo = detectRepo();
  const branch = process.env.CMS_BRANCH || "main";
  if (!repo) warn("Admin screen is not connected: add the variable CMS_REPO (for example yourname/importer-site) in the hosting settings, then deploy again.");
  const appJs = fs.readFileSync(path.join(adminSrc, "app.js"), "utf8"), appCss = fs.readFileSync(path.join(adminSrc, "app.css"), "utf8");
  const v = crypto.createHash("sha1").update(appJs + appCss).digest("hex").slice(0, 8);
  write("admin/app.js", appJs);
  write("admin/app.css", appCss);
  write("admin/index.html", fs.readFileSync(path.join(adminSrc, "index.html"), "utf8").replace('href="app.css"', `href="app.css?v=${v}"`).replace('src="app.js"', `src="app.js?v=${v}"`));
  write("admin/site.json", JSON.stringify({ repo, branch, api: process.env.CMS_API || "https://api.github.com", site_url: SITE }) + "\n");
  // Backup editor (Sveltia CMS), kept at /admin/classic/
  if (fs.existsSync(path.join(adminSrc, "classic"))) {
    write("admin/classic/index.html", fs.readFileSync(path.join(adminSrc, "classic/index.html"), "utf8"));
    write("admin/classic/config.yml", fs.readFileSync(path.join(adminSrc, "classic/config.yml"), "utf8")
      .replaceAll("__REPO__", repo || "OWNER/REPOSITORY").replaceAll("__BRANCH__", branch).replaceAll("__SITE_URL__", SITE));
  }
}

console.log(`Built ${count} pages (${products.length} products, ${brands.length} brands, ${categories.length} categories, languages: ${LANGS.join(", ")}) → dist/`);
console.log(`Sitemap: ${SITE}/sitemap.xml with ${pages.length * LANGS.length} addresses`);
for (const w of warnings) console.warn("Note: " + w);
