/* Small script for the visitor-facing site: catalogue search and filters, and the inquiry form. Pages work without it. */
(function () {
  var M = {};
  try { M = JSON.parse(document.getElementById("i18n").textContent); } catch (e) {}
  var lang = document.documentElement.lang || "en";
  var params = new URLSearchParams(location.search);
  function $(id) { return document.getElementById(id); }
  function num(n) { try { return n.toLocaleString(lang === "bn" ? "bn-BD" : "en-US"); } catch (e) { return String(n); } }

  /* ---- catalogue ---- */
  var grid = $("grid"), q = $("q");
  if (grid && q) {
    var cards = Array.prototype.slice.call(grid.querySelectorAll(".card"));
    var chips = Array.prototype.slice.call(document.querySelectorAll(".chip"));
    var brandSel = $("brandSel"), cat = "all";
    var apply = function () {
      var words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean), shown = 0;
      var brand = brandSel ? brandSel.value : "";
      cards.forEach(function (c) {
        var hay = c.getAttribute("data-search") || "";
        var ok = (cat === "all" || c.getAttribute("data-cat") === cat) &&
                 (!brand || c.getAttribute("data-brand") === brand) &&
                 words.every(function (w) { return hay.indexOf(w) !== -1; });
        c.hidden = !ok; if (ok) shown++;
      });
      grid.hidden = shown === 0;
      $("empty").hidden = shown !== 0;
      $("count").textContent = (shown === 1 ? M.count_one : M.count_many).replace("{n}", num(shown));
      chips.forEach(function (ch) { ch.setAttribute("aria-pressed", String(ch.getAttribute("data-cat") === cat)); });
    };
    if (params.get("q")) q.value = params.get("q");
    if (params.get("cat")) cat = params.get("cat");
    if (brandSel && params.get("brand")) brandSel.value = params.get("brand");
    q.addEventListener("input", apply);
    if (brandSel) brandSel.addEventListener("change", apply);
    chips.forEach(function (ch) { ch.addEventListener("click", function () { cat = ch.getAttribute("data-cat"); apply(); }); });
    $("clearBtn").addEventListener("click", function () { q.value = ""; if (brandSel) brandSel.value = ""; cat = "all"; apply(); q.focus(); });
    apply();
  }

  /* ---- inquiry form ---- */
  var form = $("inqForm");
  if (form) {
    var key = form.getAttribute("data-key") || "", wa = (form.getAttribute("data-wa") || "").replace(/\D/g, "");
    var role = $("inqRole"), err = $("inqErr"), out = $("inqOut"), status = $("inqStatus");
    if (params.get("product")) $("inqProds").value = params.get("product");
    if (params.get("role") && role) role.value = params.get("role");

    var compose = function () {
      var rows = [];
      form.querySelectorAll("[data-l]").forEach(function (el) {
        var v = el.tagName === "SELECT" ? el.options[el.selectedIndex].textContent : el.value.trim();
        if (v) rows.push(el.getAttribute("data-l") + ": " + v);
      });
      return rows.join("\n");
    };
    var showOut = function (text) {
      $("inqText").textContent = text;
      var waBtn = $("waBtn");
      if (waBtn) waBtn.href = "https://wa.me/" + wa + "?text=" + encodeURIComponent(text);
      $("copyBtn").textContent = M.copy;
      out.hidden = false;
    };
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var digits = $("inqPhone").value.replace(/\D/g, "");
      var ok = $("inqName").value.trim() && $("inqDist").value.trim() && digits.length >= 10 && digits.length <= 14;
      err.hidden = !!ok; status.hidden = true;
      if (!ok) { out.hidden = true; return; }
      var text = compose();
      if (!key) { showOut(text); return; }
      var btn = form.querySelector("button[type=submit]"), label = btn.textContent;
      btn.disabled = true; btn.textContent = M.sending; out.hidden = true;
      var done = function (success) {
        btn.disabled = false; btn.textContent = label;
        status.hidden = false;
        status.className = (success ? "ok" : "err") + " full";
        status.textContent = success ? M.sent_ok : M.sent_fail;
        if (success) form.reset(); else showOut(text);
      };
      fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: key, subject: form.getAttribute("data-subject"), from_name: form.getAttribute("data-site"),
          name: $("inqName").value.trim(), phone: $("inqPhone").value.trim(), message: text,
          botcheck: $("inqBot").checked ? "1" : ""
        })
      }).then(function (r) { done(r.status === 200); }, function () { done(false); });
    });
    $("copyBtn").addEventListener("click", function () {
      var btn = $("copyBtn"), pre = $("inqText");
      var fallback = function () {
        var r = document.createRange(); r.selectNodeContents(pre);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        btn.textContent = M.copy_fail;
      };
      try { navigator.clipboard.writeText(pre.textContent).then(function () { btn.textContent = M.copied; }, fallback); }
      catch (x) { fallback(); }
    });
  }
})();
