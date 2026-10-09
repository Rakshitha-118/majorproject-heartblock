// CardioAlert — presentation-only helpers.
// No fetch/XHR, no storage writes, no changes to form values or submit handlers.
// Loaded after app.js (reads getUsername() only to display the name).

(function () {
  "use strict";

  // ---- Light / dark theme (preference stored under its own key only) ----
  var themeBtn = document.getElementById("theme-btn");
  function currentTheme() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function syncThemeBtn() {
    if (themeBtn) themeBtn.setAttribute("aria-label", currentTheme() === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("cardioalert_theme", next); } catch (e) {}
      syncThemeBtn();
    });
    syncThemeBtn();
  }

  // ---- Sidebar (mobile off-canvas) ----
  var side = document.getElementById("sidebar");
  var scrim = document.getElementById("scrim");
  var menuBtn = document.getElementById("menu-btn");

  function setSidebar(open) {
    if (!side) return;
    side.classList.toggle("open", open);
    if (scrim) scrim.classList.toggle("show", open);
    if (menuBtn) menuBtn.setAttribute("aria-expanded", String(open));
  }
  if (menuBtn) menuBtn.addEventListener("click", function () { setSidebar(!side.classList.contains("open")); });
  if (scrim) scrim.addEventListener("click", function () { setSidebar(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setSidebar(false); });

  // ---- User chip (display only) ----
  var nameEl = document.getElementById("user-name");
  var avatarEl = document.getElementById("user-avatar");
  if (nameEl && typeof getUsername === "function") {
    var u = getUsername() || "User";
    nameEl.textContent = u;
    if (avatarEl) avatarEl.textContent = u.charAt(0);
  }

  // ---- Show / hide password ----
  document.querySelectorAll("[data-toggle-password]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var input = btn.parentElement.querySelector("input");
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
      btn.setAttribute("aria-pressed", String(show));
    });
  });

  // ---- Enter-data page: units, labels, section headings, progress ----
  if (document.body.dataset.page === "enter-data") {
    var form = document.querySelector("form");
    if (!form) return;

    var units = { spo2: "%", heart_rate: "bpm", temperature: "\u00B0C" };
    Object.keys(units).forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      if (!input) return;
      var field = input.closest(".field");
      var label = field && field.querySelector("label");
      if (!input.id) input.id = "in-" + name;
      if (label) label.setAttribute("for", input.id);
      var wrap = document.createElement("span");
      wrap.className = "input-unit";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      var u = document.createElement("span");
      u.className = "unit";
      u.setAttribute("aria-hidden", "true");
      u.textContent = units[name];
      wrap.appendChild(u);
    });

    function heading(num, title, hint) {
      var d = document.createElement("div");
      d.className = "form-section";
      d.innerHTML = '<span class="num">' + num + '</span><h3>' + title + '</h3><span class="hint">' + hint + '</span>';
      return d;
    }
    var spo2 = form.querySelector('[name="spo2"]');
    var ecg = form.querySelector('[name="ecg_file"]');
    if (spo2) {
      var f1 = spo2.closest(".field");
      f1.parentNode.insertBefore(heading(1, "Physiological parameters", "Vital signs"), f1);
    }
    if (ecg) {
      var f2 = ecg.closest(".field");
      f2.parentNode.insertBefore(heading(2, "ECG signal", "Raw signal file"), f2);
    }

    // Progress indicator (visual only; reflects what is filled in)
    var steps = document.querySelectorAll("#stepper li");
    function update() {
      var vitalsOk = ["spo2", "heart_rate", "temperature"].every(function (n) {
        var el = form.querySelector('[name="' + n + '"]');
        return el && el.value !== "" && el.checkValidity();
      });
      var ecgOk = ecg && ecg.files && ecg.files.length > 0;
      var states = [vitalsOk, ecgOk, vitalsOk && ecgOk];
      var currentSet = false;
      steps.forEach(function (li, i) {
        li.classList.remove("done", "current");
        if (states[i]) li.classList.add("done");
        else if (!currentSet) { li.classList.add("current"); currentSet = true; }
      });
    }
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    if (ecg) {
      var drop = document.getElementById("file-drop");
      if (drop) new MutationObserver(update).observe(drop, { attributes: true, attributeFilter: ["class"] });
    }
    update();
  }
})();


// ---------------------------------------------------------------------
// Phase 2 — presentation-only enhancements (no API calls, no form changes)
// ---------------------------------------------------------------------
(function () {
  "use strict";
  var page = document.body.dataset.page;

  // ---- Busy indicator: mirrors the EXISTING submit button state ----
  // app.js disables the submit button and changes its label while the request
  // runs, then restores it. We only watch that and show a status bar.
  if (page === "hardware" || page === "enter-data") {
    var btn = document.querySelector("form button[type=submit]");
    if (btn) {
      var bar = document.createElement("div");
      bar.className = "busy-bar";
      bar.setAttribute("role", "status");
      bar.setAttribute("aria-live", "polite");
      bar.hidden = true;
      bar.innerHTML = '<span class="busy-spin" aria-hidden="true"></span><span class="busy-text"></span>';
      document.body.appendChild(bar);
      var txt = bar.querySelector(".busy-text");
      var sync = function () {
        if (btn.disabled) {
          var t = (btn.textContent || "").replace(/\s+/g, " ").trim();
          txt.textContent = /capturing/i.test(t) ? t.replace(/\.*$/, "") + "…" : "Analyzing patient data…";
          bar.hidden = false;
        } else {
          bar.hidden = true;
        }
      };
      new MutationObserver(sync).observe(btn, { attributes: true, childList: true, characterData: true, subtree: true });
    }
  }

  // ---- Inline validation messages (enter-data) ----
  if (page === "enter-data") {
    ["spo2", "heart_rate", "temperature"].forEach(function (name) {
      var input = document.querySelector('[name="' + name + '"]');
      if (!input) return;
      var host = input.closest(".field");
      var msg = document.createElement("div");
      msg.className = "field-msg";
      msg.id = "msg-" + name;
      msg.setAttribute("aria-live", "polite");
      host.appendChild(msg);
      input.setAttribute("aria-describedby", msg.id);
      function check() {
        if (input.value === "" || input.checkValidity()) { msg.textContent = ""; input.removeAttribute("aria-invalid"); return; }
        var v = input.validity, text = "Enter a valid number.";
        if (v.rangeUnderflow) text = "Value must be at least " + input.min + ".";
        else if (v.rangeOverflow) text = "Value must be at most " + input.max + ".";
        msg.textContent = text;
        input.setAttribute("aria-invalid", "true");
      }
      input.addEventListener("input", check);
      input.addEventListener("blur", check);
    });
  }

  // ---- Tooltips ----
  function tip(el, text) {
    if (!el || el.dataset.tip) return;
    el.classList.add("tip");
    el.dataset.tip = text;
    el.setAttribute("tabindex", "0");
  }
  if (page === "hardware") {
    document.querySelectorAll(".readout .r-label").forEach(function (el) {
      tip(el, "Shown after the device completes its averaging window.");
    });
  }

  // ---- Result enhancements: print button + tooltips (watch #result-box) ----
  var box = document.getElementById("result-box");
  if (box) {
    new MutationObserver(function () {
      var head = box.querySelector(".inline-results-heading");
      if (head && !head.querySelector(".print-btn")) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-outline print-btn";
        b.textContent = "Print result";
        b.addEventListener("click", function () {
          var stamp = box.querySelector(".print-stamp");
          if (!stamp) {
            stamp = document.createElement("p");
            stamp.className = "print-stamp";
            head.appendChild(stamp);
          }
          stamp.textContent = "CardioAlert assessment — printed " + new Date().toLocaleString();
          window.print();
        });
        head.appendChild(b);
      }
      box.querySelectorAll(".inline-risk-title, .inline-overall-card .inline-card-subtitle").forEach(function (el) {
        tip(el, "Model-based screening estimate. Not a diagnosis.");
      });
    }).observe(box, { childList: true, subtree: true });
  }
})();


// ---------------------------------------------------------------------
// Phase 3 — local-only features (history, reports, settings, notifications)
// Everything is stored in THIS browser under cardioalert_* keys.
// No network calls. Existing keys (ecg_token, ecg_username, screeningResult)
// are only READ, never written or removed.
// ---------------------------------------------------------------------
(function () {
  "use strict";
  var page = document.body.dataset.page;

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function read(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function user() { try { return (typeof getUsername === "function" && getUsername()) || "user"; } catch (e) { return "user"; } }
  var K = { prefs: "cardioalert_prefs", hist: function () { return "cardioalert_hist_" + user(); }, notif: function () { return "cardioalert_notifs_" + user(); } };

  var S = window.CardioStore = {
    prefs: function () { var p = read(K.prefs, {}); return { saveHistory: p.saveHistory !== false, notifications: p.notifications !== false }; },
    setPrefs: function (p) { write(K.prefs, p); },
    history: function () { return read(K.hist(), []); },
    setHistory: function (a) { return write(K.hist(), a.slice(0, 200)); },
    notifs: function () { return read(K.notif(), []); },
    setNotifs: function (a) { write(K.notif(), a.slice(0, 30)); },
    pushNotif: function (level, text) {
      if (!S.prefs().notifications) return;
      var a = S.notifs(); a.unshift({ id: Date.now().toString(36), ts: new Date().toISOString(), level: level, text: text, read: false }); S.setNotifs(a);
    }
  };

  function cls(v) { var t = String(v || "").toLowerCase(); return (t === "low" || t === "medium" || t === "high") ? t : "unknown"; }
  function fmt(ts) { try { return new Date(ts).toLocaleString(); } catch (e) { return ts; } }
  function num(v, unit) { return (v == null) ? "Not available" : v + (unit || ""); }

  // ---------------- Capture a completed assessment (read-only from the DOM) ----------------
  if (page === "hardware" || page === "enter-data") {
    var box = document.getElementById("result-box");
    var seen = typeof WeakSet === "function" ? new WeakSet() : null;
    var txt = function (el, sel) { var n = el.querySelector(sel); return n ? n.textContent.replace(/\s+/g, " ").trim() : ""; };
    function capture(sec) {
      if (seen) { if (seen.has(sec)) return; seen.add(sec); }
      if (!S.prefs().saveHistory) return;
      var rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString(), source: page === "hardware" ? "Sensor" : "Manual", vitals: {}, risks: {} };
      sec.querySelectorAll(".inline-results-grid .inline-result-card").forEach(function (c) {
        var t = txt(c, "h3"), v = parseFloat(txt(c, ".inline-sensor-value"));
        var key = /spo/i.test(t) ? "spo2" : /heart/i.test(t) ? "heart_rate" : /temp/i.test(t) ? "temperature" : null;
        if (key) rec.vitals[key] = isFinite(v) ? v : null;
      });
      sec.querySelectorAll(".inline-risk-card").forEach(function (c) {
        var t = txt(c, ".inline-risk-title"), l = txt(c, ".inline-risk-level");
        if (/heart/i.test(t)) rec.risks.heartBlock = l; else if (/pulmonary/i.test(t)) rec.risks.pulmonary = l;
      });
      rec.overall = txt(sec, ".inline-overall-status") || "Not available";
      var banner = sec.querySelector(".inline-heart-risk-banner");
      rec.heartRiskDetected = !!(banner && banner.classList.contains("detected"));
      var recEl = sec.querySelector(".inline-recommendation-box");
      rec.recommendation = recEl ? recEl.textContent.replace(/^\s*Screening guidance\s*/i, "").replace(/\s+/g, " ").trim() : "";
      rec.nextSteps = Array.prototype.map.call(sec.querySelectorAll(".remedy-box li"), function (li) { return li.textContent.trim(); });
      try {
        var raw = localStorage.getItem("screeningResult");
        if (raw && typeof inlineGetEcgSignal === "function") {
          var sig = inlineGetEcgSignal(JSON.parse(raw)), step = Math.max(1, Math.ceil(sig.length / 400)), out = [];
          for (var i = 0; i < sig.length; i += step) out.push(+sig[i].toFixed(4));
          rec.ecg = out;
        }
      } catch (e) {}
      var all = S.history(); all.unshift(rec);
      if (S.setHistory(all)) {
        S.pushNotif(cls(rec.overall) === "high" ? "high" : "info", "Assessment saved — overall status " + rec.overall + "." + (cls(rec.overall) === "high" ? " Consider reviewing the result with a healthcare professional." : ""));
        renderNotifs();
      }
    }
    if (box) new MutationObserver(function () { var sec = box.querySelector(".inline-screening-results"); if (sec) capture(sec); }).observe(box, { childList: true, subtree: true });
  }

  // ---------------- Notification center ----------------
  var nBtn = document.getElementById("notif-btn"), nPanel = document.getElementById("notif-panel"),
      nList = document.getElementById("notif-list"), nBadge = document.getElementById("notif-badge");
  function renderNotifs() {
    if (!nList) return;
    var a = S.notifs(), unread = a.filter(function (n) { return !n.read; }).length;
    nBadge.hidden = unread === 0; nBadge.textContent = unread > 9 ? "9+" : unread;
    nList.innerHTML = a.length ? a.map(function (n) {
      return '<div class="notif-item ' + esc(n.level) + (n.read ? "" : " unread") + '"><p>' + esc(n.text) + '</p><time>' + esc(fmt(n.ts)) + '</time></div>';
    }).join("") : '<p class="notif-empty">No notifications yet.</p>';
  }
  if (nBtn) {
    nBtn.addEventListener("click", function (e) { e.stopPropagation(); nPanel.hidden = !nPanel.hidden; nBtn.setAttribute("aria-expanded", String(!nPanel.hidden)); });
    document.addEventListener("click", function (e) { if (!nPanel.hidden && !nPanel.contains(e.target)) { nPanel.hidden = true; nBtn.setAttribute("aria-expanded", "false"); } });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") nPanel.hidden = true; });
    document.getElementById("notif-read").addEventListener("click", function () { S.setNotifs(S.notifs().map(function (n) { n.read = true; return n; })); renderNotifs(); });
    document.getElementById("notif-clear").addEventListener("click", function () { S.setNotifs([]); renderNotifs(); });
    renderNotifs();
  }

  // ---------------- Report (print-ready, built from stored assessment) ----------------
  function ecgSvg(sig) {
    if (!sig || sig.length < 2) return '<p class="rp-muted">ECG waveform was not stored for this assessment.</p>';
    var w = 700, h = 130, min = Math.min.apply(null, sig), max = Math.max.apply(null, sig), r = (max - min) || 1;
    var pts = sig.map(function (v, i) { return (i / (sig.length - 1) * w).toFixed(1) + "," + (h - 8 - (v - min) / r * (h - 16)).toFixed(1); }).join(" ");
    return '<svg viewBox="0 0 ' + w + " " + h + '" class="rp-ecg" role="img" aria-label="ECG waveform"><polyline fill="none" stroke="#1565c0" stroke-width="1.4" points="' + pts + '"/></svg>';
  }
  function reportHtml(r) {
    var v = r.vitals || {};
    return '<h1>CardioAlert — Assessment Report</h1>' +
      '<p class="rp-muted">Generated ' + esc(new Date().toLocaleString()) + ' · Account: ' + esc(user()) + '</p>' +
      '<table class="rp-table"><tr><th>Assessment date</th><td>' + esc(fmt(r.ts)) + '</td><th>Source</th><td>' + esc(r.source) + ' assessment</td></tr>' +
      '<tr><th>Overall screening status</th><td colspan="3"><strong>' + esc(r.overall) + '</strong>' + (r.heartRiskDetected ? " — heart risk detected by the fusion model" : "") + '</td></tr>' +
      '<tr><th>Heart block risk</th><td>' + esc((r.risks && r.risks.heartBlock) || "Not available") + '</td><th>Pulmonary hypertension risk</th><td>' + esc((r.risks && r.risks.pulmonary) || "Not available") + '</td></tr></table>' +
      '<h2>Measurements</h2><table class="rp-table"><tr><th>SpO₂</th><td>' + esc(num(v.spo2, " %")) + '</td><th>Heart rate</th><td>' + esc(num(v.heart_rate, " bpm")) + '</td><th>Temperature</th><td>' + esc(num(v.temperature, " °C")) + '</td></tr></table>' +
      '<h2>ECG waveform</h2>' + ecgSvg(r.ecg) +
      '<h2>Recommendation</h2><p>' + esc(r.recommendation || "Not available") + '</p>' +
      (r.nextSteps && r.nextSteps.length ? '<ul>' + r.nextSteps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>" : "") +
      '<p class="rp-foot">This report provides decision-support information from an academic prototype and is not a substitute for professional medical diagnosis.</p>';
  }
  S.openReport = function (r) {
    var old = document.getElementById("report-modal"); if (old) old.remove();
    var m = document.createElement("div"); m.id = "report-modal"; m.className = "report-modal";
    m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", "Assessment report");
    m.innerHTML = '<div class="report-card"><div class="report-actions"><button type="button" class="btn btn-primary" id="rp-print">Print / Save as PDF</button><button type="button" class="btn btn-outline" id="rp-close">Close</button></div><div class="report-sheet">' + reportHtml(r) + '</div></div>';
    document.body.appendChild(m);
    function close() { m.remove(); document.body.classList.remove("print-report"); }
    m.addEventListener("click", function (e) { if (e.target === m) close(); });
    document.getElementById("rp-close").addEventListener("click", close);
    document.getElementById("rp-print").addEventListener("click", function () {
      document.body.classList.add("print-report");
      window.print();
      setTimeout(function () { document.body.classList.remove("print-report"); }, 500);
    });
    document.getElementById("rp-print").focus();
  };

  function tag(level) { return '<span class="rtag ' + cls(level) + '">' + esc(level || "Not available") + '</span>'; }

  // ---------------- Dashboard widget ----------------
  var widget = document.getElementById("local-widget");
  if (widget) {
    var h = S.history().slice(0, 3);
    widget.innerHTML = h.length ? h.map(function (r) {
      return '<div class="local-row ' + cls(r.overall) + '"><div><strong>' + esc(r.source) + ' assessment</strong><span>' + esc(fmt(r.ts)) + '</span></div>' + tag(r.overall) + '<button type="button" class="link-btn" data-report="' + esc(r.id) + '">Report</button></div>';
    }).join("") : '<p class="rp-muted">No assessments saved on this device yet. New results are saved here automatically after each analysis.</p>';
    widget.addEventListener("click", function (e) { var b = e.target.closest("[data-report]"); if (!b) return; var r = S.history().filter(function (x) { return x.id === b.dataset.report; })[0]; if (r) S.openReport(r); });
  }

  // ---------------- History page ----------------
  if (page === "history") {
    var list = document.getElementById("h-list"), count = document.getElementById("h-count");
    var q = document.getElementById("h-search"), fr = document.getElementById("h-risk"), fs = document.getElementById("h-source");
    function filtered() {
      var term = q.value.trim().toLowerCase();
      return S.history().filter(function (r) {
        if (fr.value && cls(r.overall) !== fr.value) return false;
        if (fs.value && r.source !== fs.value) return false;
        if (!term) return true;
        return [fmt(r.ts), r.source, r.overall, r.risks && r.risks.heartBlock, r.risks && r.risks.pulmonary].join(" ").toLowerCase().indexOf(term) !== -1;
      });
    }
    function render() {
      var all = S.history(), a = filtered();
      count.textContent = a.length + " of " + all.length + " assessments";
      if (!all.length) { list.innerHTML = '<div class="empty-state"><h3>No saved assessments yet</h3><p>Run a sensor or manual assessment and the result will be saved here, on this device only.' + (S.prefs().saveHistory ? "" : " Saving is currently turned off in Settings.") + '</p></div>'; return; }
      if (!a.length) { list.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>Try a different search or filter.</p></div>'; return; }
      list.innerHTML = a.map(function (r) {
        var v = r.vitals || {};
        return '<article class="hist-row ' + cls(r.overall) + '"><div class="hist-main"><strong>' + esc(r.source) + ' assessment</strong><span>' + esc(fmt(r.ts)) + '</span></div>' +
          '<div class="hist-risks">' + tag(r.overall) + '<small>Heart block: <b>' + esc((r.risks && r.risks.heartBlock) || "—") + '</b> · Pulmonary hypertension: <b>' + esc((r.risks && r.risks.pulmonary) || "—") + '</b></small></div>' +
          '<div class="hist-vitals"><span>SpO₂ <b>' + esc(num(v.spo2, "%")) + '</b></span><span>HR <b>' + esc(num(v.heart_rate, " bpm")) + '</b></span><span>Temp <b>' + esc(num(v.temperature, "°C")) + '</b></span></div>' +
          '<div class="hist-actions"><button type="button" class="btn btn-outline" data-report="' + esc(r.id) + '">View report</button><button type="button" class="link-btn danger" data-del="' + esc(r.id) + '">Delete</button></div></article>';
      }).join("");
    }
    [q, fr, fs].forEach(function (el) { el.addEventListener("input", render); el.addEventListener("change", render); });
    list.addEventListener("click", function (e) {
      var rb = e.target.closest("[data-report]"), db = e.target.closest("[data-del]");
      if (rb) { var r = S.history().filter(function (x) { return x.id === rb.dataset.report; })[0]; if (r) S.openReport(r); }
      if (db && window.confirm("Delete this saved assessment from this device?")) { S.setHistory(S.history().filter(function (x) { return x.id !== db.dataset.del; })); render(); }
    });
    document.getElementById("h-export").addEventListener("click", function () {
      var rows = [["Date", "Source", "Overall", "Heart block risk", "Pulmonary hypertension risk", "SpO2 (%)", "Heart rate (bpm)", "Temperature (C)"]];
      filtered().forEach(function (r) { var v = r.vitals || {}; rows.push([fmt(r.ts), r.source, r.overall, (r.risks && r.risks.heartBlock) || "", (r.risks && r.risks.pulmonary) || "", v.spo2 == null ? "" : v.spo2, v.heart_rate == null ? "" : v.heart_rate, v.temperature == null ? "" : v.temperature]); });
      var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\r\n");
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "cardioalert-history.csv"; document.body.appendChild(a); a.click(); a.remove();
    });
    render();
  }

  // ---------------- Settings page ----------------
  if (page === "settings") {
    var sSave = document.getElementById("s-save"), sNotif = document.getElementById("s-notif"), sTheme = document.getElementById("s-theme"), info = document.getElementById("s-info");
    var p = S.prefs(); sSave.checked = p.saveHistory; sNotif.checked = p.notifications;
    sTheme.value = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    function usage() { info.textContent = S.history().length + " saved assessment(s) and " + S.notifs().length + " notification(s) stored on this device for “" + user() + "”."; }
    function savePrefs() { S.setPrefs({ saveHistory: sSave.checked, notifications: sNotif.checked }); }
    sSave.addEventListener("change", savePrefs); sNotif.addEventListener("change", savePrefs);
    sTheme.addEventListener("change", function () {
      document.documentElement.setAttribute("data-theme", sTheme.value);
      try { localStorage.setItem("cardioalert_theme", sTheme.value); } catch (e) {}
    });
    document.getElementById("s-clear-hist").addEventListener("click", function () { if (window.confirm("Delete all saved assessments on this device?")) { S.setHistory([]); usage(); } });
    document.getElementById("s-clear-notif").addEventListener("click", function () { S.setNotifs([]); renderNotifs(); usage(); });
    document.getElementById("s-reset").addEventListener("click", function () { S.setPrefs({ saveHistory: true, notifications: true }); sSave.checked = true; sNotif.checked = true; });
    usage();
  }
})();


// ---------------------------------------------------------------------
// Dashboard visuals — built ONLY from assessments saved on this device
// (nothing invented; empty states are shown when there is no data).
// ---------------------------------------------------------------------
(function () {
  "use strict";
  if (document.body.dataset.page !== "dashboard" || !window.CardioStore) return;
  var S = window.CardioStore;
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var h = S.history();
  var latest = h.filter(function (r) { return r.vitals && (r.vitals.heart_rate != null || r.vitals.spo2 != null || r.vitals.temperature != null); })[0];

  // Vitals tiles
  var vp = document.getElementById("vitals-panel");
  if (vp) {
    var v = latest ? latest.vitals : {};
    function tile(cls, label, val, unit, icon, extra) {
      return '<div class="vtile ' + cls + '"><div class="vi">' + icon + (cls === "hr" ? '<span class="ring"></span><span class="ring r2"></span>' : "") + '</div><div class="vt"><span class="vl">' + label + '</span><strong>' + (val == null ? "&mdash;" : esc(val)) + '<em>' + (val == null ? "" : unit) + '</em></strong></div>' + (extra || "") + '</div>';
    }
    var MINI = '<svg class="mini" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" points="0,24 20,24 26,24 30,8 36,38 42,24 80,24 90,18 100,24 120,24 126,24 130,8 136,38 142,24 180,24 190,18 200,24 220,24 226,24 230,8 236,38 242,24 280,24 290,18 300,24 320,24 326,24 330,8 336,38 342,24 380,24 390,18 400,24"/></svg>';
    function gauge(pct) { return '<svg class="gauge" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="g-bg"/><circle cx="18" cy="18" r="15.5" class="g-fg" pathLength="100" stroke-dasharray="' + Math.max(0, Math.min(100, pct)) + ' 100"/></svg>'; }
    var svg = function (d) { return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
    vp.innerHTML =
      tile("hr", "Heart rate", v.heart_rate, " bpm", svg('<path d="M12 21s-7.5-4.6-10-9.3C.5 8.1 2.4 4.5 6 4c2-.3 3.6.7 6 3.2C14.4 4.7 16 3.7 18 4c3.6.5 5.5 4.1 4 7.7C19.5 16.4 12 21 12 21z"/>'), v.heart_rate != null ? MINI : "") +
      tile("sp", "SpO₂", v.spo2, " %", svg('<path d="M12 3s6 6.2 6 10.5A6 6 0 016 13.5C6 9.2 12 3 12 3z"/>'), v.spo2 != null ? gauge(v.spo2) : "") +
      tile("tp", "Temperature", v.temperature, " °C", svg('<path d="M14 14.8V5a2 2 0 00-4 0v9.8a4 4 0 104 0z"/>'));
    document.getElementById("vit-when").textContent = latest ? new Date(latest.ts).toLocaleString() : "No saved vitals yet";
    if (!latest) vp.insertAdjacentHTML("afterend", '<p class="rp-muted vit-empty">Vitals appear here after your next assessment is saved on this device.</p>');
  }

  // Beat speed follows the latest saved real heart rate (clamped for comfort)
  var hero = document.getElementById("dash-hero");
  if (hero) {
    var hr = latest && latest.vitals.heart_rate;
    if (hr) {
      var bpm = Math.min(180, Math.max(40, hr));
      hero.style.setProperty("--beat", (60 / bpm).toFixed(2) + "s");
      document.getElementById("hm-bpm").textContent = hr + " bpm";
    }
  }

  // Heart-rate trend (sparkline from saved assessments)
  var tp = document.getElementById("trend-panel");
  if (tp) {
    var pts = h.filter(function (r) { return r.vitals && r.vitals.heart_rate != null; }).slice(0, 12).reverse();
    if (pts.length < 2) {
      tp.innerHTML = '<p class="rp-muted">Save at least two assessments to see a heart-rate trend here.</p>';
    } else {
      var vals = pts.map(function (r) { return r.vitals.heart_rate; }), w = 360, ht = 120, pad = 14;
      var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), rg = (max - min) || 1;
      var xy = vals.map(function (x, i) { return [pad + i / (vals.length - 1) * (w - 2 * pad), ht - pad - (x - min) / rg * (ht - 2 * pad)]; });
      var line = xy.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
      var area = pad + "," + (ht - pad) + " " + line + " " + (w - pad) + "," + (ht - pad);
      tp.innerHTML = '<svg viewBox="0 0 ' + w + " " + ht + '" class="spark" role="img" aria-label="Heart rate across your last ' + vals.length + ' saved assessments"><polygon points="' + area + '" class="sp-area"/><polyline points="' + line + '" class="sp-line" fill="none"/>' +
        xy.map(function (p, i) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" class="sp-dot"><title>' + vals[i] + " bpm</title></circle>"; }).join("") + '</svg>' +
        '<div class="spark-meta"><span>Min <b>' + min + '</b></span><span>Latest <b>' + vals[vals.length - 1] + '</b> bpm</span><span>Max <b>' + max + '</b></span></div>';
    }
  }
})();


// Dashboard: risk distribution donut + last-7-days strip (saved assessments only)
(function () {
  "use strict";
  if (document.body.dataset.page !== "dashboard" || !window.CardioStore) return;
  var h = window.CardioStore.history();
  var cls = function (v) { var t = String(v || "").toLowerCase(); return (t === "low" || t === "medium" || t === "high") ? t : null; };

  var dp = document.getElementById("donut-panel");
  if (dp) {
    var n = { low: 0, medium: 0, high: 0 };
    h.forEach(function (r) { var k = cls(r.overall); if (k) n[k]++; });
    var total = n.low + n.medium + n.high;
    if (!total) {
      dp.innerHTML = '<p class="rp-muted">Your risk breakdown appears here once assessments are saved on this device.</p>';
    } else {
      var segs = [["low", "Low", "#138a5b"], ["medium", "Medium", "#e0a000"], ["high", "High", "#c62828"]], off = 0, arcs = "";
      segs.forEach(function (s) {
        var pct = n[s[0]] / total * 100;
        if (pct > 0) arcs += '<circle cx="21" cy="21" r="15.9155" fill="none" stroke="' + s[2] + '" stroke-width="5" stroke-dasharray="' + pct.toFixed(2) + ' ' + (100 - pct).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 21 21)"/>';
        off += pct;
      });
      dp.innerHTML = '<div class="donut-wrap"><svg viewBox="0 0 42 42" class="donut" role="img" aria-label="Risk distribution of ' + total + ' saved assessments"><circle cx="21" cy="21" r="15.9155" fill="none" class="d-track" stroke-width="5"/>' + arcs + '</svg><div class="d-center"><strong>' + total + '</strong><span>assessments</span></div></div>' +
        '<ul class="d-legend">' + segs.map(function (s) { return '<li><i style="background:' + s[2] + '"></i>' + s[1] + '<b>' + n[s[0]] + '</b></li>'; }).join("") + '</ul>';
    }
  }

  var wp = document.getElementById("week-panel");
  if (wp) {
    var days = [], today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 6; i >= 0; i--) { var d = new Date(today); d.setDate(today.getDate() - i); days.push(d); }
    var key = function (d) { return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
    var counts = {}; h.forEach(function (r) { var d = new Date(r.ts); if (!isNaN(d)) counts[key(d)] = (counts[key(d)] || 0) + 1; });
    var week = days.reduce(function (a, d) { return a + (counts[key(d)] || 0); }, 0);
    wp.innerHTML = '<div class="week-strip">' + days.map(function (d, i) {
      var c = counts[key(d)] || 0;
      return '<div class="wd' + (c ? " has" : "") + (i === 6 ? " today" : "") + '"><span>' + d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3) + '</span><b>' + d.getDate() + '</b><i>' + (c || "") + '</i></div>';
    }).join("") + '</div><p class="rp-muted week-sum">' + (week ? week + " assessment" + (week === 1 ? "" : "s") + " in the last 7 days" : "No assessments saved in the last 7 days") + '</p>';
  }
})();
