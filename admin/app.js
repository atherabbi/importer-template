/* Admin desk for the importer website template.
   Reads and saves the site's content straight to its GitHub repository; nothing is stored anywhere else.
   Edits are kept as "unpublished changes" until Publish, which saves them in one step and waits for the site to rebuild. */
(function () {
  "use strict";
  const app = document.getElementById("app");
  const SITE_ROOT = new URL("..", location.href).pathname.replace(/\/$/, "");
  let CFG = { repo: "", branch: "main", api: "https://api.github.com", site_url: "" };
  const S = { token: "", ready: false, files: {}, staged: {}, head: "", pub: { state: "idle" }, showChanges: false };
  const DIR = { products: "content/products/", brands: "content/brands/", categories: "content/categories/" };
  const SET = (n) => `content/settings/${n}.json`;

  /* ---------- small helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    const a = attrs || {};
    for (const [k, v] of Object.entries(a)) {
      if (v === false || v == null || k === "value") continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (typeof v !== "string" && k in el) el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    if (a.value != null) el.value = a.value;
    return el;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const getK = (o, key) => key.split(".").reduce((x, p) => (x == null ? undefined : x[p]), o);
  function setK(o, key, value) {
    const parts = key.split(".");
    let x = o;
    for (let i = 0; i < parts.length - 1; i++) {
      if (x[parts[i]] == null || typeof x[parts[i]] !== "object") x[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      x = x[parts[i]];
    }
    x[parts[parts.length - 1]] = value;
  }
  const money = (n) => (n ? "৳ " + Number(n).toLocaleString("en-US") : "");
  let toastTimer;
  function toast(text) {
    document.querySelector(".toast")?.remove();
    document.body.append(h("div", { class: "toast", role: "alert" }, text));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => document.querySelector(".toast")?.remove(), 7000);
  }

  /* ---------- GitHub ---------- */
  const R = () => `/repos/${CFG.repo}`;
  async function api(path, opt = {}) {
    const r = await fetch(CFG.api + path, {
      method: opt.method || "GET",
      headers: Object.assign({ Accept: "application/vnd.github+json", Authorization: "Bearer " + S.token, "X-GitHub-Api-Version": "2022-11-28" }, opt.body ? { "Content-Type": "application/json" } : {}),
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      cache: "no-store",
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json()).message || ""; } catch (e) {}
      const err = new Error(explain(r.status, detail));
      err.status = r.status;
      throw err;
    }
    return r.status === 204 ? null : r.json();
  }
  function explain(status, detail) {
    if (status === 401) return "The token is not valid or has expired. Sign in again with a new token.";
    if (status === 403 || status === 404) return "This token cannot change this site's repository. Create it with Contents set to Read and write, and include this repository.";
    if (status === 409 || status === 422) return "The site changed somewhere else while you were editing. Reload this page and try again.";
    return `GitHub did not accept the request (${status}). ${detail}`;
  }
  const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  async function blobJson(sha) {
    try { const hit = localStorage.getItem("blob:" + sha); if (hit) return JSON.parse(hit); } catch (e) {}
    const text = decode((await api(`${R()}/git/blobs/${sha}`)).content);
    const json = JSON.parse(text);
    try { localStorage.setItem("blob:" + sha, text); } catch (e) {}
    return json;
  }
  async function pool(items, size, fn) {
    const queue = items.slice();
    await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
  }
  async function loadRepo() {
    const ref = await api(`${R()}/git/ref/heads/${CFG.branch}`);
    const commit = await api(`${R()}/git/commits/${ref.object.sha}`);
    const tree = await api(`${R()}/git/trees/${commit.tree.sha}?recursive=1`);
    const files = {};
    await pool(tree.tree.filter((e) => e.type === "blob" && /^content\/.+\.json$/.test(e.path)), 8, async (e) => {
      try { files[e.path] = { json: await blobJson(e.sha) }; } catch (err) { if (err.status) throw err; }
    });
    S.files = files;
    S.head = ref.object.sha;
  }

  /* ---------- content and unpublished changes ---------- */
  const cur = (path) => { const s = S.staged[path]; return s ? (s.deleted ? null : s.json) : S.files[path] ? S.files[path].json : null; };
  const isNew = (path) => !S.files[path];
  const isEdited = (path) => !!S.staged[path];
  function list(kind) {
    const dir = DIR[kind];
    const paths = new Set([...Object.keys(S.files), ...Object.keys(S.staged)].filter((p) => p.startsWith(dir)));
    return [...paths].map((path) => ({ path, slug: path.slice(dir.length, -5), data: cur(path) })).filter((x) => x.data)
      .sort((a, b) => (a.data.order ?? 999) - (b.data.order ?? 999) || String(a.data.name_en || a.data.name || "").localeCompare(String(b.data.name_en || b.data.name || "")));
  }
  function prune() {
    const all = JSON.stringify([...new Set([...Object.keys(S.files), ...Object.keys(S.staged)])].map(cur));
    for (const [path, s] of Object.entries(S.staged)) if (s.bin && !all.includes(path.replace(/^public/, ""))) delete S.staged[path];
  }
  function stage(path, json) {
    if (S.files[path] && same(S.files[path].json, json)) delete S.staged[path]; else S.staged[path] = { json };
    prune(); drawSlip();
  }
  function edit(path, key, value) { const o = clone(cur(path) || {}); setK(o, key, value); stage(path, o); }
  function removeFile(path) {
    if (S.files[path]) S.staged[path] = { deleted: true }; else delete S.staged[path];
    prune(); drawSlip();
  }
  const pending = () => Object.keys(S.staged).length;
  const settings = (n) => cur(SET(n)) || {};
  const bnOn = () => settings("site").enable_bangla !== false;
  const uniquePath = (kind, base) => { let s = slugify(base) || "item", n = 1; while (cur(DIR[kind] + s + ".json") || S.files[DIR[kind] + s + ".json"]) s = `${slugify(base) || "item"}-${++n}`; return DIR[kind] + s + ".json"; };

  function describe(path) {
    const s = S.staged[path];
    const state = s.deleted ? "Deleted" : isNew(path) ? "New" : "Edited";
    if (path.startsWith("public/uploads/")) return ["Photo upload", path.split("/").pop()];
    for (const [kind, dir] of Object.entries(DIR)) if (path.startsWith(dir)) {
      const d = s.deleted ? S.files[path].json : s.json;
      return [`${state} ${kind === "products" ? "product" : kind === "brands" ? "brand" : "category"}`, d.name_en || d.name || path];
    }
    const key = path.split("/").pop().replace(".json", "");
    return ["Edited settings", (PAGES[key === "design" ? "colours" : key === "site" ? "search" : key] || {}).title || key];
  }

  /* ---------- publishing ---------- */
  async function liveSha() {
    try { const r = await fetch(SITE_ROOT + "/build.json?t=" + Date.now(), { cache: "no-store" }); return r.ok ? (await r.json()).sha || "" : ""; }
    catch (e) { return ""; }
  }
  let watchTimer;
  function watchBuild(sha) {
    clearTimeout(watchTimer);
    S.pub = { state: "building", sha, since: Date.now() };
    const tick = async () => {
      if (S.pub.sha !== sha || (S.pub.state !== "building" && S.pub.state !== "slow")) return;
      if ((await liveSha()) === sha) { S.pub = { state: "live" }; drawSlip(); refreshStatus(); setTimeout(() => { if (S.pub.state === "live") { S.pub = { state: "idle" }; drawSlip(); } }, 12000); return; }
      if (Date.now() - S.pub.since > 6 * 60 * 1000 && S.pub.state !== "slow") { S.pub.state = "slow"; drawSlip(); }
      watchTimer = setTimeout(tick, 5000);
    };
    drawSlip(); refreshStatus();
    watchTimer = setTimeout(tick, 2500);
  }
  async function publish() {
    if (!pending() || S.pub.state === "saving") return;
    const staged = Object.assign({}, S.staged);
    S.pub = { state: "saving" }; S.showChanges = false; drawSlip();
    try {
      const entries = [];
      for (const [path, s] of Object.entries(staged)) {
        if (s.deleted) entries.push({ path, mode: "100644", type: "blob", sha: null });
        else if (s.bin) entries.push({ path, mode: "100644", type: "blob", sha: (await api(`${R()}/git/blobs`, { method: "POST", body: { content: s.bin, encoding: "base64" } })).sha });
        else entries.push({ path, mode: "100644", type: "blob", content: JSON.stringify(s.json, null, 2) + "\n" });
      }
      const names = Object.keys(staged).filter((p) => !staged[p].bin).map((p) => describe(p).join(": "));
      const message = `Admin: ${names.length === 1 ? names[0] : names.length + " changes"}\n\n${names.join("\n")}`;
      const ref = await api(`${R()}/git/ref/heads/${CFG.branch}`);
      const base = await api(`${R()}/git/commits/${ref.object.sha}`);
      const tree = await api(`${R()}/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree: entries } });
      const commit = await api(`${R()}/git/commits`, { method: "POST", body: { message, tree: tree.sha, parents: [ref.object.sha] } });
      await api(`${R()}/git/refs/heads/${CFG.branch}`, { method: "PATCH", body: { sha: commit.sha } });
      for (const [path, s] of Object.entries(staged)) {
        if (s.deleted) delete S.files[path]; else if (s.json) S.files[path] = { json: s.json };
        if (S.staged[path] === s) delete S.staged[path];
      }
      S.head = commit.sha;
      watchBuild(commit.sha);
      render();
    } catch (err) {
      S.pub = { state: "error", msg: err.message }; drawSlip();
    }
  }
  function drawSlip() {
    document.getElementById("slip")?.remove();
    const n = pending(), st = S.pub.state;
    let el = null;
    const dismiss = () => { S.pub = { state: "idle" }; drawSlip(); };
    if (st === "saving") el = h("div", { class: "slip" }, h("div", { class: "grow" }, h("b", null, "Publishing…"), h("span", null, "Saving your changes.")), h("div", { class: "bar" }, h("i")));
    else if (st === "error") el = h("div", { class: "slip error", role: "alert" }, h("div", { class: "grow" }, h("b", null, "Not published"), h("span", null, S.pub.msg)), h("button", { class: "btn", onclick: publish }, "Try again"), h("button", { class: "btn", onclick: dismiss }, "Close"));
    else if (n) {
      el = h("div", { class: "slip" },
        h("div", { class: "grow" }, h("b", null, `${n} unpublished change${n === 1 ? "" : "s"}`), h("span", null, st === "building" ? "Your last publish is still building. These will go next." : "Visitors see nothing new until you publish.")),
        h("button", { class: "btn", onclick: () => { S.showChanges = !S.showChanges; drawSlip(); } }, S.showChanges ? "Hide list" : "Review"),
        h("button", { class: "btn", onclick: () => confirmBox("Discard all unpublished changes?", "Everything goes back to what is on the website now.", "Discard changes", () => { S.staged = {}; S.showChanges = false; drawSlip(); render(); }) }, "Discard"),
        h("button", { class: "btn primary", onclick: publish }, "Publish"),
        S.showChanges ? h("div", { class: "changes" }, Object.keys(S.staged).map((path) => { const [kind, name] = describe(path); return h("div", { class: "change" }, h("div", null, h("b", null, name), " ", h("small", null, kind)), h("button", { class: "linkbtn", onclick: () => { delete S.staged[path]; prune(); if (!pending()) S.showChanges = false; drawSlip(); render(); } }, "Undo")); })) : null);
    }
    else if (st === "building") el = h("div", { class: "slip" }, h("div", { class: "grow" }, h("b", null, "Building the website…"), h("span", null, "Usually takes about a minute. You can keep working.")), h("div", { class: "bar" }, h("i")));
    else if (st === "slow") el = h("div", { class: "slip" }, h("div", { class: "grow" }, h("b", null, "Still building"), h("span", null, "This is taking longer than usual. Your changes are saved. Check the latest deployment in your hosting dashboard.")), h("button", { class: "btn", onclick: dismiss }, "Close"));
    else if (st === "live") el = h("div", { class: "slip live", role: "status" }, h("div", { class: "grow" }, h("b", null, "Published"), h("span", null, "Your changes are live on the website.")), h("a", { class: "btn", href: SITE_ROOT + "/", target: "_blank", rel: "noopener" }, "View site"), h("button", { class: "btn", onclick: dismiss }, "Close"));
    if (el) { el.id = "slip"; document.body.append(el); }
  }
  window.addEventListener("beforeunload", (e) => { if (pending()) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------- dialogs ---------- */
  function dialog(title, body, okLabel, onOk, danger) {
    const dlg = h("dialog", null);
    const form = h("form", { method: "dialog", onsubmit: (e) => { e.preventDefault(); const r = onOk(dlg); if (r !== false) { dlg.close(); dlg.remove(); } } },
      h("h2", null, title), body,
      h("div", { class: "acts" }, h("button", { class: "btn", type: "button", onclick: () => { dlg.close(); dlg.remove(); } }, "Cancel"), h("button", { class: "btn " + (danger ? "danger" : "primary"), type: "submit" }, okLabel)));
    dlg.append(form); document.body.append(dlg); dlg.showModal();
    return dlg;
  }
  const confirmBox = (title, text, okLabel, onOk) => dialog(title, h("p", { class: "hint" }, text), okLabel, onOk, true);

  /* ---------- photos ---------- */
  const readDataUrl = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("The file could not be read.")); fr.readAsDataURL(file); });
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("This file is not a picture the browser can open.")); i.src = src; });
  async function prepareImage(file, base) {
    let ext = (file.name.split(".").pop() || "").toLowerCase().replace("jpeg", "jpg");
    const name = (slugify(base) || "image") + "-" + Date.now().toString(36);
    let dataUrl = await readDataUrl(file);
    const small = /^(png|svg|webp|jpg|gif)$/.test(ext) && file.size <= 350 * 1024;
    if (!small && ext !== "svg") {
      const img = await loadImg(dataUrl);
      const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      dataUrl = c.toDataURL("image/webp", 0.86); const was = ext; ext = "webp";
      if (!dataUrl.startsWith("data:image/webp")) { ext = was === "png" ? "png" : "jpg"; dataUrl = c.toDataURL(ext === "png" ? "image/png" : "image/jpeg", 0.88); }
    }
    const b64 = dataUrl.split(",")[1];
    if (b64.length > 2.7 * 1024 * 1024) throw new Error("This picture is larger than 2 MB even after shrinking. Choose a smaller one.");
    return { path: `public/uploads/${name}.${ext}`, b64, dataUrl };
  }
  const photoSrc = (v) => (!v ? "" : (S.staged["public" + v] && S.staged["public" + v].dataUrl) || (/^https?:/.test(v) ? v : SITE_ROOT + v));

  /* ---------- form fields ---------- */
  const row = (label, hint, control) => h("div", { class: "row" }, label ? h("div", { class: "lbl" }, label) : null, control, hint ? h("p", { class: "hint" }, hint) : null);
  function fieldNode(basePath, f) {
    const path = f.path || basePath;
    const val = (k) => getK(cur(path) || {}, k);
    const input = (k, kind, attrs) => {
      const el = kind === "area" ? h("textarea", attrs) : h("input", Object.assign({ type: kind === "num" ? "number" : "text" }, attrs));
      el.value = val(k) == null ? "" : val(k);
      el.addEventListener("input", () => edit(path, k, kind === "num" ? (el.value === "" ? null : Number(el.value)) : el.value));
      return el;
    };
    switch (f.t) {
      case "text": case "num": case "area":
        return row(f.label, f.hint, input(f.k, f.t, { "aria-label": f.label, placeholder: f.ph || null, min: f.t === "num" ? 0 : null }));
      case "pair": case "pairarea": {
        const kind = f.t === "pairarea" ? "area" : "text", bn = bnOn();
        return row(f.label, f.hint, h("div", { class: "pair" + (bn ? "" : " single") },
          h("label", null, bn ? "English" : "", input(f.k + "_en", kind, { "aria-label": f.label + " (English)" })),
          bn ? h("label", null, "বাংলা", input(f.k + "_bn", kind, { lang: "bn", "aria-label": f.label + " (Bangla)" })) : null));
      }
      case "bool": {
        const on = () => (val(f.k) == null ? f.def !== false : !!val(f.k));
        const sw = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on()), "aria-label": f.label, onclick: () => { edit(path, f.k, !on()); sw.setAttribute("aria-checked", String(on())); } });
        return h("div", { class: "switch-row" }, h("div", null, h("b", null, f.label), f.hint ? h("span", null, f.hint) : null), sw);
      }
      case "select": case "rel": {
        const opts = f.t === "rel" ? [["", "Choose…"], ...list(f.dir).map((x) => [x.slug, x.data[f.nameKey] || x.slug])] : f.opts;
        const el = h("select", { "aria-label": f.label, onchange: () => edit(path, f.k, el.value) }, opts.map(([v, l]) => h("option", { value: v }, l)));
        el.value = val(f.k) == null ? (f.def || "") : val(f.k);
        return row(f.label, f.hint, el);
      }
      case "color": {
        const start = /^#[0-9a-f]{6}$/i.test(val(f.k) || "") ? val(f.k) : f.def || "#0A6B62";
        const pick = h("input", { type: "color", "aria-label": f.label }), text = h("input", { type: "text", "aria-label": f.label + " code", maxlength: "7" });
        pick.value = start; text.value = val(f.k) || "";
        pick.addEventListener("input", () => { text.value = pick.value.toUpperCase(); edit(path, f.k, text.value); f.after && f.after(); });
        text.addEventListener("input", () => { if (/^#[0-9a-f]{6}$/i.test(text.value)) { pick.value = text.value; edit(path, f.k, text.value.toUpperCase()); f.after && f.after(); } else if (text.value === "") edit(path, f.k, ""); });
        return row(f.label, f.hint, h("div", { class: "color" }, pick, text));
      }
      case "image": {
        const box = h("div", { class: "image" });
        const draw = () => {
          const v = val(f.k);
          const file = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async () => {
            if (!file.files[0]) return;
            try { const up = await prepareImage(file.files[0], (cur(path) || {}).name_en || (cur(path) || {}).name || f.k); S.staged[up.path] = { bin: up.b64, dataUrl: up.dataUrl }; edit(path, f.k, up.path.replace(/^public/, "")); draw(); }
            catch (err) { toast(err.message); }
          } });
          box.replaceChildren(
            h("div", { class: "thumb" }, v ? h("img", { src: photoSrc(v), alt: "" }) : f.none || "No photo"),
            h("div", { class: "acts" }, h("label", { class: "btn small" }, v ? "Replace" : "Choose a file", file), v ? h("button", { class: "linkbtn", type: "button", onclick: () => { edit(path, f.k, ""); draw(); } }, "Remove") : null));
        };
        draw();
        return row(f.label, f.hint, box);
      }
      case "list": {
        const box = h("div", { class: "list" });
        const draw = (focusLast) => {
          const items = val(f.k) || [];
          box.replaceChildren(...items.map((v, i) => {
            const el = h("input", { type: "text", "aria-label": `${f.label} ${i + 1}`, placeholder: f.ph || null });
            el.value = v;
            el.addEventListener("input", () => { const a = clone(val(f.k) || []); a[i] = el.value; edit(path, f.k, a); });
            return h("div", { class: "list-item" }, h("div", { class: "grow" }, el), h("button", { type: "button", class: "icon-btn", "aria-label": "Remove", title: "Remove", onclick: () => { const a = clone(val(f.k) || []); a.splice(i, 1); edit(path, f.k, a); draw(); } }, "×"));
          }), h("div", null, h("button", { type: "button", class: "btn small", onclick: () => { edit(path, f.k, [...(val(f.k) || []), ""]); draw(true); } }, f.add || "Add")));
          if (focusLast) { const all = box.querySelectorAll("input"); all[all.length - 1] && all[all.length - 1].focus(); }
        };
        draw();
        return row(f.label, f.hint, box);
      }
      case "objlist": {
        const box = h("div", { class: "list" });
        const draw = () => {
          const items = val(f.k) || [];
          const move = (i, d) => { const a = clone(val(f.k) || []); const [x] = a.splice(i, 1); a.splice(i + d, 0, x); edit(path, f.k, a); draw(); };
          box.replaceChildren(...items.map((_, i) => h("div", { class: "obj-item" },
            f.fields.map((sub) => fieldNode(path, Object.assign({}, sub, { k: `${f.k}.${i}.${sub.k}`, path }))),
            h("div", { class: "tools" },
              i > 0 ? h("button", { type: "button", class: "btn small", onclick: () => move(i, -1) }, "Move up") : null,
              i < items.length - 1 ? h("button", { type: "button", class: "btn small", onclick: () => move(i, 1) }, "Move down") : null,
              h("button", { type: "button", class: "btn small danger", onclick: () => { const a = clone(val(f.k) || []); a.splice(i, 1); edit(path, f.k, a); draw(); } }, "Remove")))),
          h("div", null, h("button", { type: "button", class: "btn small", onclick: () => { edit(path, f.k, [...(val(f.k) || []), {}]); draw(); } }, f.add || "Add")));
        };
        draw();
        return row(f.label, f.hint, box);
      }
    }
    return h("div");
  }
  const formSections = (path, groups) => groups.map((g) => h("section", { class: "fs" }, h("header", null, h("h2", null, g.title), g.desc ? h("p", null, g.desc) : null), h("div", { class: "fs-body" }, g.fields.map((f) => fieldNode(path, f)))));

  /* ---------- what each screen edits ---------- */
  const SHAPES = [["bottle", "Bottle"], ["box", "Box"], ["tube", "Tube"], ["dropper", "Dropper bottle"], ["pump", "Pump bottle"], ["jar", "Jar"]];
  const sec = (k, label, hint) => ({ k, t: "bool", def: true, label, hint, path: SET("sections") });
  const point = [{ k: "title", t: "pair", label: "Title" }, { k: "text", t: "pairarea", label: "Text" }];
  const FORMS = {
    products: [
      { title: "Name and group", fields: [{ k: "name", t: "pair", label: "Product name" }, { k: "brand", t: "rel", dir: "brands", nameKey: "name", label: "Brand" }, { k: "category", t: "rel", dir: "categories", nameKey: "name_en", label: "Category" }] },
      { title: "Photo", desc: "A square photo on a plain background works best. Large photos are made smaller automatically.", fields: [{ k: "image", t: "image", label: "Product photo" }, { k: "pack_shape", t: "select", opts: SHAPES, def: "bottle", label: "Pack drawing", hint: "Shown when there is no photo." }] },
      { title: "Details", desc: "Shown on the product page. Search engines read these too.", fields: [
        { k: "description", t: "pairarea", label: "Short description", hint: "One or two sentences. Search engines show this under the product name." },
        { k: "composition", t: "list", label: "Composition", add: "Add ingredient", ph: "Ingredient and amount" },
        { k: "usage", t: "pairarea", label: "How to use" },
        { k: "pack", t: "pair", label: "Pack size", hint: "For example: 60 softgels, 50 ml" },
        { k: "origin", t: "pair", label: "Made in", hint: "Leave empty to use the brand's country." }] },
      { title: "Price and registration", fields: [{ k: "mrp", t: "num", label: "MRP in taka" }, { k: "reg_no", t: "text", label: "Registration number" }] },
      { title: "Where it appears", fields: [{ k: "published", t: "bool", def: true, label: "Show on website", hint: "Switch off to hide this product without deleting it." }, { k: "featured", t: "bool", def: false, label: "Show on home page" }, { k: "order", t: "num", label: "Position in lists", hint: "Smaller numbers come first." }] },
    ],
    brands: [
      { title: "Brand", fields: [{ k: "name", t: "text", label: "Brand name" }, { k: "country", t: "pair", label: "Country" }, { k: "logo", t: "image", label: "Logo", none: "No logo" }] },
      { title: "Brand page", desc: "Each brand has its own page listing its products.", fields: [{ k: "description", t: "pairarea", label: "About the brand" }, { k: "order", t: "num", label: "Position in lists", hint: "Smaller numbers come first." }] },
    ],
    categories: [
      { title: "Category", fields: [{ k: "name", t: "pair", label: "Category name" }, { k: "color", t: "color", label: "Tag colour", hint: "The small category tag on product cards." }] },
      { title: "Category page", desc: "Each category has its own page listing its products.", fields: [{ k: "description", t: "pairarea", label: "Description" }, { k: "order", t: "num", label: "Position in lists", hint: "Smaller numbers come first." }] },
    ],
  };
  const PAGES = {
    sections: { file: "sections", title: "Show or hide", desc: "Switch off anything this importer does not need. Hidden parts also disappear from the menu and from search engines.", groups: [
      { title: "Home page", fields: [sec("notice_bar", "Notice bar", "The thin bar at the very top of every page."), sec("hero_search", "Search box", "Product search under the headline."), sec("hero_label", "Importer label picture", "The label graphic beside the headline."), sec("check_pack", "Check a pack", "What customers should look for on a genuine pack."), sec("brands", "Brands", "The list of brands the importer carries."), sec("featured_products", "Products on the home page", "Up to eight products marked “Show on home page”.")] },
      { title: "Doctors and pharmacies", fields: [sec("doctors", "For doctors", "Documents on request and product literature."), sec("composition_table", "Composition table", "The table of every product's composition, inside For doctors."), sec("pharmacies", "For pharmacies", "Ordering information for pharmacies."), sec("inquiry_form", "Inquiry form", "The form inside For pharmacies.")] },
      { title: "Product details", fields: [sec("show_mrp", "Prices (MRP)", "On product cards and product pages."), sec("show_reg_no", "Registration numbers", "On product cards and product pages.")] },
      { title: "Footer and languages", fields: [sec("contact", "Contact details", "Hotline, WhatsApp, email and office address."), sec("disclaimer", "Disclaimer", "The supplements disclaimer at the bottom."), { k: "enable_bangla", t: "bool", def: true, label: "Bangla version", hint: "A full Bangla copy of every page, with a language switch.", path: SET("site") }] },
    ] },
    home: { file: "home", title: "Home page", desc: "The words on the home page. Each part can be switched off here too.", groups: [
      { title: "Notice bar", fields: [sec("notice_bar", "Show the notice bar"), { k: "notice", t: "pair", label: "Notice text" }] },
      { title: "Headline", fields: [{ k: "eyebrow", t: "pair", label: "Small line above the headline" }, { k: "headline", t: "pair", label: "Headline" }, { k: "intro", t: "pairarea", label: "Introduction" }] },
      { title: "Importer label picture", desc: "A sample of the label on the importer's packs.", fields: [sec("hero_label", "Show the label picture"), { k: "label.reg_no", t: "text", label: "Registration number" }, { k: "label.batch", t: "text", label: "Batch" }, { k: "label.mfg", t: "text", label: "Manufacture date" }, { k: "label.exp", t: "text", label: "Expiry date" }, { k: "label.origin", t: "text", label: "Country of origin" }, { k: "label.mrp", t: "num", label: "MRP in taka" }, { k: "label_caption", t: "pair", label: "Text under the label" }] },
      { title: "Check a pack", fields: [sec("check_pack", "Show this section"), { k: "check_heading", t: "pair", label: "Heading" }, { k: "check_intro", t: "pairarea", label: "Introduction" }, { k: "check_items", t: "objlist", label: "Points", add: "Add a point", fields: point }] },
      { title: "For doctors", fields: [sec("doctors", "Show this section"), { k: "doctors_heading", t: "pair", label: "Heading" }, { k: "doctors_intro", t: "pairarea", label: "Introduction" }, { k: "doctors_items", t: "objlist", label: "Points", add: "Add a point", fields: point }] },
      { title: "For pharmacies", fields: [sec("pharmacies", "Show this section"), { k: "pharm_heading", t: "pair", label: "Heading" }, { k: "pharm_intro", t: "pairarea", label: "Introduction" }, { k: "pharm_points", t: "objlist", label: "Points", add: "Add a point", fields: [{ k: "text", t: "pair", label: "Text" }] }] },
      { title: "Footer disclaimer", fields: [sec("disclaimer", "Show the disclaimer"), { k: "disclaimer", t: "pairarea", label: "Disclaimer text" }] },
    ] },
    company: { file: "company", title: "Company", desc: "The importer's name, logo and contact details.", groups: [
      { title: "Name and logo", fields: [{ k: "name", t: "text", label: "Company name", hint: "The short name shown in the header." }, { k: "legal_name", t: "text", label: "Full legal name" }, { k: "logo", t: "image", label: "Logo", none: "No logo", hint: "Without a logo, the company name is shown as text." }] },
      { title: "Contact", fields: [{ k: "phone", t: "text", label: "Hotline number" }, { k: "whatsapp", t: "text", label: "WhatsApp number", hint: "With country code, for example 8801712345678." }, { k: "email", t: "text", label: "Email" }, { k: "hours", t: "pair", label: "Office hours" }] },
      { title: "Address", fields: [{ k: "city", t: "pair", label: "City" }, { k: "address", t: "pair", label: "Office address" }] },
    ] },
    colours: { file: "design", title: "Colours", desc: "Two colours set the look of the whole site. Dark-mode colours are worked out automatically.", groups: [
      { title: "Brand colours", fields: [{ k: "primary", t: "color", def: "#0A6B62", label: "Main colour", hint: "Buttons, links and highlights.", after: () => drawPreview() }, { k: "accent", t: "color", def: "#F6B93B", label: "Label colour", hint: "The importer label picture and small accents.", after: () => drawPreview() }] },
    ] },
    search: { file: "site", title: "Search engines", desc: "What Google and other search engines need. The sitemap and page descriptions are rebuilt on every publish.", groups: [
      { title: "Website address", desc: "Set this once the importer's domain is connected.", fields: [{ k: "site_url", t: "text", label: "Website address", ph: "https://www.company.com", hint: "The sitemap and every search-engine link use this address." }] },
      { title: "In search results", fields: [{ k: "meta_description", t: "pairarea", label: "Site description", hint: "About 150 characters. Shown under the site name in search results." }, { k: "share_image", t: "image", label: "Sharing picture", none: "No picture", hint: "Shown when the site is shared on Facebook or WhatsApp. 1200 × 630 px works best." }] },
      { title: "Verification", desc: "Proves to the search engine that you manage this site.", fields: [{ k: "google_verification", t: "text", label: "Google Search Console code", hint: "Only the code from the HTML tag method, not the whole tag." }, { k: "bing_verification", t: "text", label: "Bing Webmaster code" }] },
      { title: "Languages", fields: [{ k: "enable_bangla", t: "bool", def: true, label: "Bangla version", hint: "A full Bangla copy of every page." }, { k: "default_language", t: "select", def: "en", opts: [["en", "English"], ["bn", "Bangla"]], label: "Main language", hint: "The language visitors see first." }] },
    ] },
    inquiry: { file: "inquiry", title: "Inquiry form", desc: "How inquiries from pharmacies and doctors reach the importer.", groups: [
      { title: "By email", desc: "Get a free key at web3forms.com using the importer's email address. Inquiries then arrive in that inbox.", fields: [{ k: "access_key", t: "text", label: "Web3Forms access key" }, { k: "subject", t: "text", label: "Email subject", ph: "Website inquiry" }] },
      { title: "By WhatsApp", desc: "Without a key, visitors get a “Send on WhatsApp” button with the inquiry already written.", fields: [{ k: "whatsapp", t: "text", label: "WhatsApp number", hint: "With country code, for example 8801712345678.", path: SET("company") }] },
    ] },
  };

  /* ---------- screens ---------- */
  const head = (title, desc, actions, back) => h("div", null, back ? h("a", { class: "back", href: back[0] }, "← " + back[1]) : null, h("div", { class: "page-head" }, h("div", null, h("h1", null, title), desc ? h("p", null, desc) : null), actions ? h("div", { class: "quick" }, actions) : null));
  const tagFor = (path) => (isNew(path) ? h("span", { class: "tag" }, "New") : isEdited(path) ? h("span", { class: "tag" }, "Edited") : null);

  function todos() {
    const out = [], site = settings("site"), home = settings("home"), comp = settings("company"), inq = settings("inquiry"), secs = settings("sections"), prods = list("products");
    const shown = prods.filter((p) => p.data.published !== false);
    const n = (arr) => arr.length, s = (c) => (c === 1 ? "" : "s");
    if (secs.notice_bar !== false && /sample content/i.test(home.notice_en || "")) out.push(["The sample notice bar is still showing", "Change the text or switch the notice bar off.", "#/home"]);
    if (!site.site_url) out.push(["Website address is not set", "The sitemap needs the importer's real address.", "#/search"]);
    if (!comp.logo) out.push(["No logo yet", "The company name is shown as text until a logo is added.", "#/company"]);
    if (!inq.access_key && !comp.whatsapp && secs.pharmacies !== false && secs.inquiry_form !== false) out.push(["Inquiries cannot reach the importer", "Add a WhatsApp number or an email key.", "#/inquiry"]);
    if (!site.google_verification) out.push(["Google Search Console is not verified", "Add the verification code, then submit the sitemap in Search Console.", "#/search"]);
    const noPhoto = shown.filter((p) => !p.data.image), noDesc = shown.filter((p) => !p.data.description_en), noBn = bnOn() ? shown.filter((p) => !p.data.name_bn) : [];
    if (n(noPhoto)) out.push([`${n(noPhoto)} product${s(n(noPhoto))} without a photo`, "A drawing of the pack is shown instead.", "#/products?f=nophoto"]);
    if (n(noDesc)) out.push([`${n(noDesc)} product${s(n(noDesc))} without a description`, "Search engines have little to show for these.", "#/products?f=nodesc"]);
    if (n(noBn)) out.push([`${n(noBn)} product${s(n(noBn))} without a Bangla name`, "The English name is used on the Bangla pages.", "#/products?f=nobn"]);
    return out;
  }
  function statusNode() {
    const b = S.pub.state === "building" || S.pub.state === "slow" || S.pub.state === "saving";
    return h("div", { class: "status" + (b || pending() ? " wait" : ""), id: "status" }, h("span", { class: "dot" }),
      h("span", null, b ? "Your last publish is being built. It will be live shortly." : pending() ? "You have unpublished changes. The website still shows the previous version." : "The website is up to date with everything here."));
  }
  function refreshStatus() { const el = document.getElementById("status"); if (el) el.replaceWith(statusNode()); }
  function viewDashboard() {
    const prods = list("products"), hidden = prods.filter((p) => p.data.published === false).length, t = todos();
    return h("div", { class: "page" },
      head(settings("company").name || "Website", "Change the catalogue and the site here, then press Publish.", [h("a", { class: "btn", href: SITE_ROOT + "/", target: "_blank", rel: "noopener" }, "View site"), h("button", { class: "btn primary", onclick: addProduct }, "Add product")]),
      statusNode(),
      h("div", { class: "summary" },
        h("a", { href: "#/products" }, h("b", null, prods.length), h("span", null, hidden ? `products, ${hidden} hidden` : "products")),
        h("a", { href: "#/brands" }, h("b", null, list("brands").length), h("span", null, "brands")),
        h("a", { href: "#/categories" }, h("b", null, list("categories").length), h("span", null, "categories"))),
      h("h2", { class: "sec-title" }, t.length ? "Needs attention" : "Nothing needs attention"),
      t.length ? h("div", { class: "todo" }, t.map(([title, text, href]) => h("div", { class: "todo-item" }, h("div", null, h("b", null, title), h("span", null, text)), h("a", { class: "btn small", href }, "Fix")))) : h("p", { class: "hint", style: "margin-bottom:30px" }, "The address, logo, inquiry route and product details are all in place."),
      h("h2", { class: "sec-title" }, "Search engine files"),
      h("p", { class: "hint", style: "margin-bottom:10px" }, "Rebuilt automatically every time you publish."),
      h("div", { class: "quick" }, h("a", { class: "btn small", href: SITE_ROOT + "/sitemap.xml", target: "_blank", rel: "noopener" }, "Open sitemap"), h("a", { class: "btn small", href: SITE_ROOT + "/robots.txt", target: "_blank", rel: "noopener" }, "Open robots.txt"), h("a", { class: "btn small", href: "https://search.google.com/search-console", target: "_blank", rel: "noopener" }, "Google Search Console")));
  }

  function addProduct() {
    if (!list("brands").length || !list("categories").length) { toast("Add at least one brand and one category first."); location.hash = list("brands").length ? "#/categories" : "#/brands"; return; }
    const name = h("input", { type: "text", required: true, "aria-label": "Product name" });
    const brand = h("select", { required: true, "aria-label": "Brand" }, list("brands").map((b) => h("option", { value: b.slug }, b.data.name)));
    const cat = h("select", { required: true, "aria-label": "Category" }, list("categories").map((c) => h("option", { value: c.slug }, c.data.name_en)));
    dialog("Add a product", h("div", { style: "display:grid;gap:12px" }, row("Product name (English)", null, name), row("Brand", null, brand), row("Category", null, cat)), "Add product", () => {
      if (!name.value.trim()) return false;
      const path = uniquePath("products", brand.value + " " + name.value);
      stage(path, { name_en: name.value.trim(), name_bn: "", brand: brand.value, category: cat.value, image: "", pack_shape: "bottle", pack_en: "", pack_bn: "", composition: [], description_en: "", description_bn: "", usage_en: "", usage_bn: "", origin_en: "", origin_bn: "", reg_no: "", mrp: null, featured: false, published: true, order: list("products").length + 1 });
      location.hash = "#/products/" + path.slice(DIR.products.length, -5);
    });
    name.focus();
  }
  function addSimple(kind) {
    const label = kind === "brands" ? "brand" : "category";
    const name = h("input", { type: "text", required: true, "aria-label": "Name" });
    dialog(`Add a ${label}`, row(kind === "brands" ? "Brand name" : "Category name (English)", null, name), `Add ${label}`, () => {
      if (!name.value.trim()) return false;
      const path = uniquePath(kind, name.value);
      stage(path, kind === "brands" ? { name: name.value.trim(), country_en: "", country_bn: "", logo: "", description_en: "", description_bn: "", order: list(kind).length + 1 } : { name_en: name.value.trim(), name_bn: "", description_en: "", description_bn: "", color: "", order: list(kind).length + 1 });
      location.hash = `#/${kind}/` + path.slice(DIR[kind].length, -5);
    });
    name.focus();
  }

  function viewProducts(query) {
    const brands = Object.fromEntries(list("brands").map((b) => [b.slug, b.data.name])), cats = Object.fromEntries(list("categories").map((c) => [c.slug, c.data.name_en]));
    const preset = new URLSearchParams(query || "").get("f") || "";
    const q = h("input", { type: "search", placeholder: "Search products", "aria-label": "Search products" });
    const fb = h("select", { "aria-label": "Brand" }, h("option", { value: "" }, "All brands"), Object.entries(brands).map(([v, l]) => h("option", { value: v }, l)));
    const fs = h("select", { "aria-label": "Show" }, [["", "All products"], ["shown", "Shown on website"], ["hidden", "Hidden"], ["home", "On home page"], ["nophoto", "Without a photo"], ["nodesc", "Without a description"], ["nobn", "Without a Bangla name"]].map(([v, l]) => h("option", { value: v }, l)));
    fs.value = preset;
    const body = h("div");
    const sw = (p, key, def) => {
      const on = () => (p.data[key] == null ? def : !!p.data[key]);
      const b = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on()), "aria-label": key === "published" ? "Show on website" : "Show on home page", onclick: (e) => { e.stopPropagation(); edit(p.path, key, !on()); p.data = cur(p.path); b.setAttribute("aria-checked", String(on())); } });
      return b;
    };
    const draw = () => {
      const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = list("products").filter((p) => {
        const d = p.data, hay = [d.name_en, d.name_bn, brands[d.brand], cats[d.category], d.reg_no].join(" ").toLowerCase();
        const f = fs.value;
        return (!fb.value || d.brand === fb.value) && words.every((w) => hay.includes(w)) &&
          (!f || (f === "shown" && d.published !== false) || (f === "hidden" && d.published === false) || (f === "home" && d.featured) || (f === "nophoto" && !d.image) || (f === "nodesc" && !d.description_en) || (f === "nobn" && !d.name_bn));
      });
      body.replaceChildren(rows.length ? h("div", { class: "tbl-wrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, ""), h("th", null, "Product"), h("th", null, "Category"), h("th", null, "MRP"), h("th", null, "Home page"), h("th", null, "On website"))),
        h("tbody", null, rows.map((p) => h("tr", { onclick: () => { location.hash = "#/products/" + p.slug; } },
          h("td", null, h("div", { class: "mini" }, p.data.image ? h("img", { src: photoSrc(p.data.image), alt: "", loading: "lazy" }) : "")),
          h("td", null, h("a", { class: "name", href: "#/products/" + p.slug, style: "color:inherit;text-decoration:none" }, p.data.name_en || "(no name)"), " ", tagFor(p.path), h("span", { class: "sub" }, brands[p.data.brand] || "No brand")),
          h("td", null, cats[p.data.category] || "No category"),
          h("td", { class: "num" }, money(p.data.mrp)),
          h("td", null, sw(p, "featured", false)),
          h("td", null, sw(p, "published", true))))))) :
        h("div", { class: "empty" }, h("p", null, list("products").length ? "No product matches these filters." : "No products yet. Add the first one."), list("products").length ? h("button", { class: "btn", onclick: () => { q.value = ""; fb.value = ""; fs.value = ""; draw(); } }, "Clear filters") : h("button", { class: "btn primary", onclick: addProduct }, "Add product")));
    };
    [q, fb, fs].forEach((el) => el.addEventListener("input", draw));
    draw();
    return h("div", { class: "page" }, head("Products", "Every product has its own page on the website in each language.", [h("button", { class: "btn primary", onclick: addProduct }, "Add product")]), h("div", { class: "toolbar" }, q, fb, fs), body);
  }

  function viewEntity(kind, slug) {
    const path = DIR[kind] + slug + ".json", d = cur(path);
    const one = kind === "products" ? "product" : kind === "brands" ? "brand" : "category";
    const title = kind === "products" ? "Products" : kind === "brands" ? "Brands" : "Categories";
    if (!d) return h("div", { class: "page" }, head("Not found", `This ${one} does not exist or was deleted.`, null, ["#/" + kind, title]));
    const users = kind === "products" ? [] : list("products").filter((p) => p.data[kind === "brands" ? "brand" : "category"] === slug);
    const actions = [
      !isNew(path) && (kind !== "products" || d.published !== false) && (kind === "products" || users.length) ? h("a", { class: "btn", href: `${SITE_ROOT}/${kind === "categories" ? "category" : kind}/${slug}/`, target: "_blank", rel: "noopener" }, "View on site") : null,
      kind === "products" ? h("button", { class: "btn", onclick: () => { const p2 = uniquePath("products", slug + " copy"); stage(p2, Object.assign(clone(d), { name_en: (d.name_en || "") + " (copy)", published: false })); location.hash = "#/products/" + p2.slice(DIR.products.length, -5); } }, "Duplicate") : null,
      h("button", { class: "btn danger", onclick: () => {
        if (users.length) return toast(`${users.length} product${users.length === 1 ? " uses" : "s use"} this ${one}. Move them to another ${one} first.`);
        confirmBox(`Delete this ${one}?`, `“${d.name_en || d.name}” is removed from the website when you publish.`, "Delete", () => { removeFile(path); location.hash = "#/" + kind; });
      } }, "Delete"),
    ];
    return h("div", { class: "page" }, head(d.name_en || d.name || "(no name)", kind === "products" ? null : `${users.length} product${users.length === 1 ? "" : "s"} in this ${one}.`, actions, ["#/" + kind, title]), formSections(path, FORMS[kind]));
  }

  function viewSimpleList(kind) {
    const isB = kind === "brands", items = list(kind), prods = list("products");
    const count = (slug) => prods.filter((p) => p.data[isB ? "brand" : "category"] === slug).length;
    return h("div", { class: "page" },
      head(isB ? "Brands" : "Categories", isB ? "Each brand gets its own page, which helps people searching for the brand by name." : "Categories group products and appear as filters in the catalogue.", [h("button", { class: "btn primary", onclick: () => addSimple(kind) }, isB ? "Add brand" : "Add category")]),
      items.length ? h("div", { class: "tbl-wrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, isB ? "Brand" : "Category"), h("th", null, isB ? "Country" : "Bangla name"), h("th", null, "Products"))),
        h("tbody", null, items.map((x) => h("tr", { onclick: () => { location.hash = `#/${kind}/${x.slug}`; } },
          h("td", null, h("a", { class: "name", href: `#/${kind}/${x.slug}`, style: "color:inherit;text-decoration:none" }, x.data.name_en || x.data.name || "(no name)"), " ", tagFor(x.path)),
          h("td", null, isB ? x.data.country_en || "" : x.data.name_bn || ""),
          h("td", { class: "num" }, count(x.slug))))))) :
        h("div", { class: "empty" }, h("p", null, isB ? "No brands yet." : "No categories yet."), h("button", { class: "btn primary", onclick: () => addSimple(kind) }, isB ? "Add brand" : "Add category")));
  }

  function drawPreview() {
    const el = document.getElementById("preview"); if (!el) return;
    const d = settings("design"), p = d.primary || "#0A6B62", a = d.accent || "#F6B93B";
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
    el.replaceChildren(
      h("div", { class: "p-top" }, h("span", null, settings("company").name || "Company"), h("span", { class: "p-btn", style: `background:${p};color:${lum(p) > 0.6 ? "#18211F" : "#fff"};font-size:.8rem` }, "EN")),
      h("div", { class: "p-body", style: `background:color-mix(in srgb, ${p} 14%, #fff)` }, h("span", { class: "p-btn", style: `background:${p};color:${lum(p) > 0.6 ? "#18211F" : "#fff"}` }, "Search"), h("span", { class: "p-label", style: `background:${a};color:${lum(a) > 0.6 ? "#2A1E00" : "#fff"}` }, "MRP ৳ 1,850")));
  }
  function viewSettings(key) {
    const page = PAGES[key], path = SET(page.file);
    const nodes = [head(page.title, page.desc), formSections(path, page.groups)];
    if (key === "colours") nodes.push(h("section", { class: "fs" }, h("header", null, h("h2", null, "Preview"), h("p", null, "A rough idea of how the colours look together.")), h("div", { class: "fs-body" }, h("div", { class: "preview", id: "preview" }))));
    const el = h("div", { class: "page" }, nodes);
    if (key === "colours") setTimeout(drawPreview);
    return el;
  }

  /* ---------- frame and routing ---------- */
  const NAV = [
    ["", [["", "Dashboard"]]],
    ["Catalogue", [["products", "Products"], ["brands", "Brands"], ["categories", "Categories"]]],
    ["Pages", [["home", "Home page"], ["sections", "Show or hide"]]],
    ["Site", [["company", "Company"], ["colours", "Colours"], ["search", "Search engines"], ["inquiry", "Inquiry form"]]],
  ];
  function render() {
    if (!S.ready) return;
    const raw = location.hash.replace(/^#\/?/, ""), [pathPart, query] = raw.split("?"), [a, b] = pathPart.split("/");
    let view;
    if (!a) view = viewDashboard();
    else if (a === "products") view = b ? viewEntity("products", b) : viewProducts(query);
    else if (a === "brands" || a === "categories") view = b ? viewEntity(a, b) : viewSimpleList(a);
    else if (PAGES[a]) view = viewSettings(a);
    else view = viewDashboard();
    const counts = { products: list("products").length, brands: list("brands").length, categories: list("categories").length };
    const shell = h("div", { class: "shell", id: "shell" },
      h("aside", { class: "rail" },
        h("div", { class: "rail-site" }, h("b", null, settings("company").name || "Website"), h("a", { href: SITE_ROOT + "/", target: "_blank", rel: "noopener" }, (CFG.site_url || location.origin + SITE_ROOT).replace(/^https?:\/\//, ""))),
        h("nav", { "aria-label": "Admin" }, NAV.map(([group, items]) => h("div", { class: "rail-group" }, group ? h("span", null, group) : null,
          items.map(([key, label]) => h("a", { class: "nav", href: "#/" + key, "aria-current": a === key || (!a && !key) ? "page" : null, onclick: () => document.getElementById("shell").classList.remove("open") }, label, counts[key] != null ? h("small", null, counts[key]) : null))))),
        h("div", { class: "rail-foot" }, h("a", { href: "classic/", title: "The earlier editor, kept as a backup" }, "Backup editor"), h("button", { type: "button", onclick: () => { if (pending()) return confirmBox("Sign out and lose unpublished changes?", "Your unpublished changes will be discarded.", "Sign out", signOut); signOut(); } }, "Sign out"))),
      h("main", { class: "main", onclick: () => document.getElementById("shell").classList.remove("open") },
        h("button", { class: "btn small menu-btn", type: "button", onclick: (e) => { e.stopPropagation(); document.getElementById("shell").classList.toggle("open"); } }, "Menu"), view));
    app.replaceChildren(shell);
    window.scrollTo(0, 0);
    drawSlip();
  }
  window.addEventListener("hashchange", render);
  function signOut() { try { localStorage.removeItem("admin-token"); } catch (e) {} S.staged = {}; location.hash = ""; location.reload(); }

  /* ---------- sign in ---------- */
  function gate(message) {
    const token = h("input", { type: "password", autocomplete: "off", required: true, placeholder: "github_pat_…", "aria-label": "GitHub token" });
    const btn = h("button", { class: "btn primary", type: "submit" }, "Sign in");
    const err = h("p", { class: "msg", role: "alert", hidden: !message }, message || "");
    app.replaceChildren(h("div", { class: "gate" }, h("form", { class: "gate-card", onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; btn.textContent = "Signing in…"; err.hidden = true;
      const fail = (m) => { err.textContent = m; err.hidden = false; btn.disabled = false; btn.textContent = "Sign in"; };
      S.token = token.value.trim();
      try {
        const repo = await api(R());
        if (repo.permissions && repo.permissions.push === false) return fail("This token can read the site but cannot change it. Create it with Contents set to Read and write.");
        try { localStorage.setItem("admin-token", S.token); } catch (x) {}
        await start();
      } catch (x) { fail(x.message); }
    } },
      h("h1", null, "Website admin"),
      h("p", { class: "hint" }, CFG.repo ? `Sign in with a GitHub token to manage ${CFG.repo.split("/")[1]}.` : ""),
      err, token, btn,
      h("details", null, h("summary", null, "How to get a token"),
        h("ol", null, h("li", null, "On GitHub, open your profile picture, then Settings, Developer settings, Personal access tokens, Fine-grained tokens."), h("li", null, "Press Generate new token and give it a name."), h("li", null, "Under Repository access choose All repositories, or select this site's repository."), h("li", null, "Under Permissions add Contents and set it to Read and write."), h("li", null, "Generate the token, copy it and paste it above."))),
      h("p", { class: "hint" }, "The token stays in this browser only. It is sent to GitHub and nowhere else."))));
    token.focus();
  }
  async function start() {
    app.replaceChildren(h("p", { class: "boot" }, "Loading the site's content…"));
    await loadRepo();
    S.ready = true;
    render();
    const live = await liveSha();
    if (live && live !== S.head) watchBuild(S.head);
  }
  async function boot() {
    try { const r = await fetch("site.json?t=" + Date.now(), { cache: "no-store" }); if (r.ok) CFG = Object.assign(CFG, await r.json()); } catch (e) {}
    if (!CFG.repo) { app.replaceChildren(h("div", { class: "gate" }, h("div", { class: "gate-card" }, h("h1", null, "Admin is not connected yet"), h("p", null, "In your hosting dashboard, add an environment variable named CMS_REPO with the value github-username/repository-name, then deploy the site again.")))); return; }
    try { S.token = localStorage.getItem("admin-token") || ""; } catch (e) {}
    if (!S.token) return gate();
    try { await start(); } catch (err) { S.ready = false; gate(err.message); }
  }
  window.addEventListener("unhandledrejection", (e) => toast((e.reason && e.reason.message) || "Something went wrong."));
  boot();
})();
