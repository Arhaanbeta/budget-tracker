/**
 * Budget Tracker: Google Sheets back end.
 *
 * Paste this whole file into Extensions > Apps Script of the
 * "Budget Tracker data" spreadsheet, set the APP_KEY script property,
 * and deploy as a Web app (Execute as: Me, Who has access: Anyone).
 *
 * The app sends one POST per sync: {key, ops: [...]}. Each op is an
 * upsert or a delete, so sending the same op twice is harmless.
 * The reply is always the full, current data set.
 */

var TABS = {
  Entries: ['ID', 'Date', 'Cycle', 'Type', 'Category', 'Amount', 'Account', 'Card', 'Note', 'For whom', 'Tag', 'Refund',
            'Category ID', 'Account ID', 'Card ID', 'Created at', 'Saved at'],
  Balances: ['Date', 'Account ID', 'Account', 'Balance'],
  CardFix: ['Card ID', 'Card', 'Statement date', 'Your figure'],
  Config: ['Key', 'Value', 'Note']
};
var E = {id: 0, date: 1, cycle: 2, type: 3, catName: 4, amount: 5, acctName: 6, cardName: 7, note: 8, member: 9, tag: 10,
         refund: 11, cat: 12, acct: 13, card: 14, at: 15, saved: 16};
var CHUNK = 40000; // characters per Config cell

var APP_URL = 'https://arhaanbeta.github.io/budget-tracker/';

/* The first time the owner opens the Web app URL, the script makes its own access key and
   shows a one-tap link that connects a phone. After that it never shows the key again. */
function doGet() {
  var props = PropertiesService.getScriptProperties(), lock = LockService.getScriptLock(), key, fresh = false;
  lock.waitLock(20000);
  try {
    key = props.getProperty('APP_KEY');
    if (!key) {
      key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
      props.setProperty('APP_KEY', key); fresh = true;
    }
  } finally { lock.releaseLock(); }
  var page = '<meta name="viewport" content="width=device-width,initial-scale=1"><div style="font:16px/1.5 Arial,sans-serif;max-width:560px;margin:24px auto;padding:0 16px">';
  if (fresh) {
    var link = APP_URL + '#connect=' + Utilities.base64EncodeWebSafe(JSON.stringify({url: ScriptApp.getService().getUrl(), key: key}));
    page += '<h2>Budget Tracker is connected to this sheet</h2>' +
      '<p><b>Open this link on each phone</b> (send it to yourself on WhatsApp or email). It connects the app in one tap.</p>' +
      '<p><a target="_blank" style="word-break:break-all" href="' + link + '">' + link + '</a></p>' +
      '<p>Save this link somewhere private, like a note. This page shows it only once. Anyone with the link can see and change your budget.</p>' +
      '<p style="color:#666;font-size:13px">Lost it? In Apps Script open Project Settings, delete the APP_KEY script property, then open this page again for a new link. Old links stop working.</p>';
  } else {
    page += '<h2>Budget Tracker back end is running</h2><p>The phone link was already shown once. To make a new one, delete the APP_KEY script property in Apps Script → Project Settings, then open this page again.</p>';
  }
  return HtmlService.createHtmlOutput(page + '</div>').setTitle('Budget Tracker set-up');
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out({ok: false, error: 'bad_json'}); }
  var key = PropertiesService.getScriptProperties().getProperty('APP_KEY');
  if (!key) return out({ok: false, error: 'no_key_set'});
  if (!req || req.key !== key) return out({ok: false, error: 'bad_key'});
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return out({ok: false, error: 'busy'});
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureTabs(ss);
    var ops = Array.isArray(req.ops) ? req.ops : [];
    for (var i = 0; i < ops.length; i++) applyOp(ss, ops[i]);
    if (ops.length) SpreadsheetApp.flush();
    return out({ok: true, applied: ops.length, data: readAll(ss), at: Date.now()});
  } catch (err) {
    return out({ok: false, error: String(err && err.message || err)});
  } finally {
    lock.releaseLock();
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- sheet helpers ---------- */
function ensureTabs(ss) {
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
      sh.getRange('A:Z').setNumberFormat('@');
    }
  });
}
function tz() { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Kolkata'; }
function rows(sh) {
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
}
function dstr(v) { // any cell value -> 'yyyy-MM-dd' or ''
  if (v instanceof Date) return Utilities.formatDate(v, tz(), 'yyyy-MM-dd');
  v = String(v == null ? '' : v).trim();
  var m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); // dd/mm/yyyy as typed in India
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}
function num(v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v == null ? '' : v).replace(/[,\s₹]/g, '').replace('−', '-'));
  return isFinite(n) ? n : NaN;
}
function stamp(ms) { return Utilities.formatDate(new Date(ms || Date.now()), tz(), "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function txt(v) { return v == null ? '' : String(v); }
function deleteRowsWhere(sh, test) {
  var r = rows(sh);
  for (var i = r.length - 1; i >= 0; i--) if (test(r[i])) sh.deleteRow(i + 2);
}

/* ---------- config ---------- */
function readConfig(ss) {
  var sh = ss.getSheetByName('Config'), r = rows(sh), parts = [];
  r.forEach(function (row) { var m = String(row[0]).match(/^config part (\d+)$/); if (m) parts[+m[1] - 1] = String(row[1]); });
  if (!parts.length) return null;
  try { return JSON.parse(parts.join('')); } catch (e) { return null; }
}
function writeConfig(ss, cfg) {
  var sh = ss.getSheetByName('Config');
  deleteRowsWhere(sh, function (row) { return /^config part \d+$/.test(String(row[0])); });
  var s = JSON.stringify(cfg), data = [];
  for (var i = 0, p = 1; i < s.length; i += CHUNK, p++) {
    data.push(['config part ' + p, s.slice(i, i + CHUNK), p === 1 ? 'Categories, budgets, accounts and cards. Change these in the app, not here.' : '']);
  }
  if (data.length) sh.getRange(sh.getLastRow() + 1, 1, data.length, 3).setNumberFormat('@').setValues(data);
  refreshNames(ss, cfg);
}
function maps(cfg) {
  var m = {cat: {}, catByName: {}, acct: {}, card: {}};
  if (!cfg) return m;
  (cfg.categories || []).forEach(function (c) { m.cat[c.id] = c; m.catByName[String(c.name).toLowerCase()] = c; });
  (cfg.accounts || []).forEach(function (a) { m.acct[a.id] = a; });
  (cfg.cards || []).forEach(function (c) { m.card[c.id] = c; });
  return m;
}
function cycleOf(date, cfg) {
  var S = Math.min(28, Math.max(1, +(cfg && cfg.cycleStartDay) || 25));
  var p = date.split('-').map(Number), y = p[0], mo = p[1];
  if (S > 1 && p[2] >= S) { mo++; if (mo > 12) { mo = 1; y++; } }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return MON[mo - 1] + '-' + String(y).slice(2);
}
// Keep the human-readable columns in step when names change in Setup.
function refreshNames(ss, cfg) {
  var M = maps(cfg);
  var sh = ss.getSheetByName('Entries'), r = rows(sh);
  if (r.length) {
    var block = r.map(function (row) {
      var c = M.cat[row[E.cat]], d = dstr(row[E.date]);
      return [d ? cycleOf(d, cfg) : row[E.cycle], c ? c.type : row[E.type], c ? c.name : row[E.catName], row[E.amount],
              M.acct[row[E.acct]] ? M.acct[row[E.acct]].name : (row[E.acct] ? row[E.acctName] : ''),
              M.card[row[E.card]] ? M.card[row[E.card]].name : (row[E.card] ? row[E.cardName] : '')];
    });
    sh.getRange(2, E.cycle + 1, block.length, 6).setValues(block);
  }
  var bs = ss.getSheetByName('Balances'), br = rows(bs);
  if (br.length) bs.getRange(2, 3, br.length, 1).setValues(br.map(function (row) { return [M.acct[row[1]] ? M.acct[row[1]].name : row[2]]; }));
  var fs = ss.getSheetByName('CardFix'), fr = rows(fs);
  if (fr.length) fs.getRange(2, 2, fr.length, 1).setValues(fr.map(function (row) { return [M.card[row[0]] ? M.card[row[0]].name : row[1]]; }));
}

/* ---------- entries ---------- */
function txnRow(t, cfg) {
  var M = maps(cfg), c = M.cat[t.cat] || {}, a = M.acct[t.acct], k = M.card[t.card];
  return [txt(t.id), txt(t.date), cycleOf(t.date, cfg), txt(c.type || 'Expense'), txt(c.name || ''), +t.amount || 0,
          a ? a.name : '', k ? k.name : '', txt(t.note), txt(t.member), txt(t.tag), t.refund ? 'Yes' : '',
          txt(t.cat), txt(t.acct), txt(t.card), stamp(t.at), stamp()];
}
function putTxn(ss, t, cfg) {
  if (!t || !t.id || !dstr(t.date) || !isFinite(+t.amount)) return;
  var sh = ss.getSheetByName('Entries'), ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
  var row = txnRow(t, cfg);
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(t.id)) {
      var old = sh.getRange(i + 2, E.at + 1).getValue();
      if (old) row[E.at] = old; // keep the original "Created at"
      sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  sh.getRange(sh.getLastRow(), E.amount + 1).setNumberFormat('#,##0.00');
}
function readTxns(ss, cfg) {
  var sh = ss.getSheetByName('Entries'), r = rows(sh), M = maps(cfg), list = [], fixes = [];
  r.forEach(function (row, i) {
    var date = dstr(row[E.date]), amount = num(row[E.amount]);
    if (!date || !isFinite(amount) || amount === 0) return;
    var id = txt(row[E.id]).trim(), cat = txt(row[E.cat]).trim();
    // Rows typed straight into the sheet: give them an ID and match the category by name.
    if (!cat && row[E.catName]) { var byName = M.catByName[String(row[E.catName]).trim().toLowerCase()]; if (byName) { cat = byName.id; fixes.push([i + 2, E.cat + 1, cat]); } }
    if (!id) { id = 's' + Date.now().toString(36) + i; fixes.push([i + 2, E.id + 1, id]); }
    var at = Date.parse(txt(row[E.at])) || 0;
    list.push({id: id, date: date, amount: Math.abs(amount), cat: cat, acct: txt(row[E.acct]), note: txt(row[E.note]),
               member: txt(row[E.member]), tag: txt(row[E.tag]), at: at, refund: /^(yes|y|true|1)$/i.test(txt(row[E.refund])) || amount < 0,
               card: txt(row[E.card])});
  });
  fixes.forEach(function (f) { sh.getRange(f[0], f[1]).setNumberFormat('@').setValue(f[2]); });
  return list;
}

/* ---------- balances and card figures ---------- */
function putBalance(ss, date, values, cfg) {
  var sh = ss.getSheetByName('Balances'), M = maps(cfg);
  deleteRowsWhere(sh, function (row) { return dstr(row[0]) === date; });
  var data = Object.keys(values || {}).filter(function (id) { return isFinite(+values[id]); })
    .map(function (id) { return [date, id, M.acct[id] ? M.acct[id].name : '', +values[id]]; });
  if (data.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, data.length, 3).setNumberFormat('@');
    sh.getRange(start, 4, data.length, 1).setNumberFormat('#,##0.00');
    sh.getRange(start, 1, data.length, 4).setValues(data);
  }
}
function readBalances(ss) {
  var b = {};
  rows(ss.getSheetByName('Balances')).forEach(function (row) {
    var d = dstr(row[0]), v = num(row[3]); if (!d || !row[1] || !isFinite(v)) return;
    (b[d] = b[d] || {date: d, values: {}}).values[String(row[1])] = v;
  });
  return b;
}
function putFix(ss, card, sd, v, cfg) {
  var sh = ss.getSheetByName('CardFix'), M = maps(cfg);
  deleteRowsWhere(sh, function (row) { return String(row[0]) === String(card) && dstr(row[2]) === sd; });
  if (v === null || v === undefined || !isFinite(+v)) return;
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, 1, 3).setNumberFormat('@');
  sh.getRange(start, 1, 1, 4).setValues([[card, M.card[card] ? M.card[card].name : '', sd, +v]]);
}
function readFixes(ss) {
  var f = {};
  rows(ss.getSheetByName('CardFix')).forEach(function (row) {
    var sd = dstr(row[2]), v = num(row[3]); if (!row[0] || !sd || !isFinite(v)) return;
    (f[row[0]] = f[row[0]] || {card: String(row[0]), fix: {}}).fix[sd] = v;
  });
  return f;
}

/* ---------- ops ---------- */
function applyOp(ss, op) {
  if (!op || !op.t) return;
  var cfg = readConfig(ss);
  switch (op.t) {
    case 'config': if (op.config && Array.isArray(op.config.categories)) writeConfig(ss, op.config); break;
    case 'txn': putTxn(ss, op.txn, cfg); break;
    case 'deltxn': deleteRowsWhere(ss.getSheetByName('Entries'), function (row) { return String(row[0]) === String(op.id); }); break;
    case 'bal': if (dstr(op.date)) putBalance(ss, dstr(op.date), op.values, cfg); break;
    case 'delbal': deleteRowsWhere(ss.getSheetByName('Balances'), function (row) { return dstr(row[0]) === op.date; }); break;
    case 'fix': putFix(ss, op.card, op.sd, op.v, cfg); break;
    case 'replace': replaceAll(ss, op); break;
  }
}
function clearBody(sh) { if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1); }
function replaceAll(ss, op) {
  if (!op.config || !Array.isArray(op.config.categories)) return;
  ['Entries', 'Balances', 'CardFix'].forEach(function (n) { clearBody(ss.getSheetByName(n)); });
  writeConfig(ss, op.config);
  var sh = ss.getSheetByName('Entries');
  var data = (op.txns || []).filter(function (t) { return t && t.id && dstr(t.date) && isFinite(+t.amount); })
    .map(function (t) { return txnRow(t, op.config); });
  if (data.length) {
    sh.getRange(2, 1, data.length, data[0].length).setNumberFormat('@');
    sh.getRange(2, E.amount + 1, data.length, 1).setNumberFormat('#,##0.00');
    sh.getRange(2, 1, data.length, data[0].length).setValues(data);
  }
  Object.keys(op.balances || {}).forEach(function (d) { putBalance(ss, d, op.balances[d].values, op.config); });
  Object.keys(op.cardfix || {}).forEach(function (c) {
    var fx = (op.cardfix[c] && op.cardfix[c].fix) || {};
    Object.keys(fx).forEach(function (sd) { putFix(ss, c, sd, fx[sd], op.config); });
  });
}
function readAll(ss) {
  var cfg = readConfig(ss);
  return {config: cfg, txns: readTxns(ss, cfg), balances: readBalances(ss), cardfix: readFixes(ss)};
}

/* Run this once from the editor to check everything is wired up. */
function selfTest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTabs(ss);
  var d = readAll(ss);
  Logger.log('Key set: ' + !!PropertiesService.getScriptProperties().getProperty('APP_KEY'));
  Logger.log('Config found: ' + !!d.config + ', entries: ' + d.txns.length + ', balance dates: ' + Object.keys(d.balances).length);
}
