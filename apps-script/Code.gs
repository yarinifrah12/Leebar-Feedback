/**
 * LEE BAR — dining-room feedback backend (Google Apps Script).
 * Stores tablet responses in this spreadsheet, serves the management
 * dashboard, and emails a daily report to each recipient.
 *
 * Setup: see README.md. In short: paste this file, set DASHBOARD_URL,
 * run setup() once, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone).
 */

// Link that appears in the daily email. Replace after GitHub Pages is live.
var DASHBOARD_URL = 'https://YOUR-USER.github.io/YOUR-REPO/dashboard.html';
var TZ = 'Asia/Jerusalem';
var DEFAULT_MASTER_PIN = '1234';
var SESSION_HOURS = 12;

var SHEETS = {
  responses: ['ts', 'date', 'time', 'station', 'stationName', 'food', 'service', 'variety', 'clean', 'expect', 'enjoyed', 'improve', 'comments', 'lang', 'id'],
  stations: ['id', 'name', 'order', 'managerPinHash', 'partnerLogo', 'partnerName'],
  recipients: ['id', 'email', 'time', 'stations', 'active', 'order'],
  settings: ['key', 'value']
};
var SHEET_TITLES = { responses: 'משובים', stations: 'תחנות', recipients: 'נמענים', settings: 'הגדרות' };
var METRICS = [['food', 'איכות האוכל'], ['service', 'שירות'], ['variety', 'מגוון התפריט'], ['clean', 'ניקיון']];
var EXPECT = { exceeded: 'עלתה על הציפיות', met: 'עמדה בציפיות', partial: 'עמדה חלקית', not: 'לא עמדה בציפיות' };

/* ===================== setup ===================== */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (k) {
    var sh = ss.getSheetByName(SHEET_TITLES[k]) || ss.insertSheet(SHEET_TITLES[k]);
    if (sh.getLastRow() === 0) {
      sh.appendRow(SHEETS[k]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, SHEETS[k].length).setFontWeight('bold');
    }
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!getSetting_('masterPinHash')) setSetting_('masterPinHash', hash_(DEFAULT_MASTER_PIN));
  if (getSetting_('prevDay') === null) setSetting_('prevDay', 'true');

  if (rows_('stations').length === 0) {
    appendObj_('stations', { id: 'natbag', name: 'כוחות זרים - נתב"ג', order: 1, managerPinHash: '', partnerLogo: 'assets/noamer.png', partnerName: 'NOAMER' });
  }
  if (rows_('recipients').length === 0) {
    var seed = [['chef', '09:00'], ['Yonatan', '09:00'], ['eden', '09:00'], ['asaf', '09:00'], ['simo', '09:00'], ['zion', '09:00'],
      ['refael', '09:00'], ['Avivm', '09:00'], ['natan', '10:00'], ['Eyal', '08:00']];
    seed.forEach(function (r, i) {
      appendObj_('recipients', { id: 'r' + (i + 1), email: r[0] + '@leebar.co.il', time: r[1], stations: 'all', active: true, order: i + 1 });
    });
  }
  // Hourly trigger for the daily reports.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'hourlyReports') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('hourlyReports').timeBased().everyHours(1).nearMinute(2).create();
  var orphan = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (orphan && orphan.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(orphan);
}

/* ===================== web app ===================== */

function doGet() {
  return json_({ ok: true, service: 'leebar-feedback' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = ACTIONS[req.action];
    if (!fn) return json_({ ok: false, error: 'unknown_action' });
    var needsLock = ['submit', 'addStation', 'setStationPin', 'setMasterPin', 'saveRecipient', 'deleteRecipient', 'setPrevDay', 'renameStation'].indexOf(req.action) >= 0;
    if (needsLock) lock.waitLock(20000);
    return json_(fn(req));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

var ACTIONS = {
  /* ---- tablet ---- */
  publicStations: function () {
    return { ok: true, stations: stations_().map(function (s) {
      return { id: s.id, name: s.name, partnerLogo: s.partnerLogo || '', partnerName: s.partnerName || '' };
    }) };
  },
  stationLogin: function (req) {
    var st = stationById_(req.station);
    if (!st) return { ok: false, error: 'no_station' };
    var code = String(req.code || '').replace(/\s/g, '').toLowerCase();
    var ok = code && code === stCode_(st.name);
    if (!ok) ok = hash_(code) === getSetting_('masterPinHash');
    if (!ok) return { ok: false, error: 'wrong_code' };
    return { ok: true, token: sign_('kiosk|' + st.id), station: { id: st.id, name: st.name, partnerLogo: st.partnerLogo || '', partnerName: st.partnerName || '' } };
  },
  submit: function (req) {
    var p = verify_(req.token);
    if (!p || p[0] !== 'kiosk') return { ok: false, error: 'not_logged_in' };
    var st = stationById_(p[1]);
    if (!st) return { ok: false, error: 'no_station' };
    var r = req.record || {};
    if (r.id && responseIdExists_(r.id)) return { ok: true, duplicate: true };
    var now = Date.now(), ts = Number(r.ts) || now;
    if (ts > now + 600000 || ts < now - 7 * 864e5) ts = now; // keep client time for queued offline answers, within a week
    var d = new Date(ts);
    var clip = function (v) { return String(v || '').slice(0, 600); };
    var score = function (v) { v = Number(v); return v >= 1 && v <= 5 ? Math.round(v) : ''; };
    appendObj_('responses', {
      ts: ts, date: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), time: Utilities.formatDate(d, TZ, 'HH:mm'),
      station: st.id, stationName: st.name,
      food: score(r.food), service: score(r.service), variety: score(r.variety), clean: score(r.clean),
      expect: EXPECT[r.expect] ? r.expect : '', enjoyed: clip(r.enjoyed), improve: clip(r.improve), comments: clip(r.comments),
      lang: r.lang === 'he' ? 'he' : 'en', id: String(r.id || Utilities.getUuid()).slice(0, 40)
    });
    return { ok: true };
  },

  /* ---- dashboard ---- */
  login: function (req) {
    var h = hash_(String(req.pin || ''));
    if (h === getSetting_('masterPinHash')) {
      return { ok: true, token: sign_('dash|all|' + (Date.now() + SESSION_HOURS * 36e5)), role: 'all', defaultPin: h === hash_(DEFAULT_MASTER_PIN) };
    }
    var st = stations_().filter(function (s) { return s.managerPinHash && s.managerPinHash === h; })[0];
    if (st) return { ok: true, token: sign_('dash|' + st.id + '|' + (Date.now() + SESSION_HOURS * 36e5)), role: st.id, stationName: st.name };
    return { ok: false, error: 'wrong_code' };
  },
  data: function (req) {
    var s = session_(req.token);
    if (!s) return { ok: false, error: 'expired' };
    var from = req.from ? Number(req.from) : 0, to = req.to ? Number(req.to) : Infinity;
    var resp = rows_('responses').filter(function (r) {
      var ts = Number(r.ts);
      return ts >= from && ts < to && (s.role === 'all' || r.station === s.role);
    }).map(function (r) {
      return { ts: Number(r.ts), date: r.date, time: r.time, station: r.station, food: num_(r.food), service: num_(r.service),
        variety: num_(r.variety), clean: num_(r.clean), expect: r.expect, enjoyed: r.enjoyed, improve: r.improve, comments: r.comments, lang: r.lang };
    });
    var out = { ok: true, role: s.role, responses: resp };
    out.stations = stations_().filter(function (x) { return s.role === 'all' || x.id === s.role; }).map(function (x) {
      return s.role === 'all' ? { id: x.id, name: x.name, hasPin: !!x.managerPinHash, code: stCode_(x.name) } : { id: x.id, name: x.name };
    });
    if (s.role === 'all') {
      out.recipients = recipients_();
      out.prevDay = getSetting_('prevDay') !== 'false';
      out.defaultPin = getSetting_('masterPinHash') === hash_(DEFAULT_MASTER_PIN);
    }
    return out;
  },

  /* ---- admin (master code only) ---- */
  addStation: admin_(function (req) {
    var name = String(req.name || '').trim().slice(0, 80);
    if (!name) return { ok: false, error: 'name_required' };
    var pinErr = checkPin_(req.pin, null, true);
    if (pinErr) return { ok: false, error: pinErr };
    var id = 'st' + Date.now().toString(36);
    appendObj_('stations', { id: id, name: name, order: stations_().length + 1, managerPinHash: req.pin ? hash_(String(req.pin)) : '', partnerLogo: '', partnerName: '' });
    return { ok: true, id: id };
  }),
  renameStation: admin_(function (req) {
    var name = String(req.name || '').trim().slice(0, 80);
    if (!name) return { ok: false, error: 'name_required' };
    return updateRow_('stations', req.id, { name: name }) ? { ok: true } : { ok: false, error: 'no_station' };
  }),
  setStationPin: admin_(function (req) {
    var pinErr = checkPin_(req.pin, req.id, false);
    if (pinErr) return { ok: false, error: pinErr };
    return updateRow_('stations', req.id, { managerPinHash: hash_(String(req.pin)) }) ? { ok: true } : { ok: false, error: 'no_station' };
  }),
  setMasterPin: admin_(function (req) {
    var p = String(req.pin || '');
    if (!/^\d{4,6}$/.test(p)) return { ok: false, error: 'pin_format' };
    if (stations_().some(function (s) { return s.managerPinHash === hash_(p); })) return { ok: false, error: 'pin_taken' };
    setSetting_('masterPinHash', hash_(p));
    return { ok: true };
  }),
  saveRecipient: admin_(function (req) {
    var r = req.recipient || {};
    var email = String(r.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'email_format' };
    var time = /^\d{2}:\d{2}$/.test(r.time) ? r.time : '09:00';
    var st = Array.isArray(r.stations) && r.stations.length ? r.stations.join(',') : 'all';
    var obj = { email: email, time: time, stations: st, active: r.active !== false };
    if (r.id && updateRow_('recipients', r.id, obj)) return { ok: true, id: r.id };
    var id = 'r' + Date.now().toString(36);
    obj.id = id; obj.order = recipients_().length + 1;
    appendObj_('recipients', obj);
    return { ok: true, id: id };
  }),
  deleteRecipient: admin_(function (req) {
    return deleteRow_('recipients', req.id) ? { ok: true } : { ok: false, error: 'not_found' };
  }),
  setPrevDay: admin_(function (req) {
    setSetting_('prevDay', req.value ? 'true' : 'false');
    return { ok: true };
  }),
  sendTestReport: admin_(function (req) {
    var r = recipients_().filter(function (x) { return x.id === req.id; })[0];
    if (!r || !r.email) return { ok: false, error: 'not_found' };
    sendReport_(r, new Date(), true);
    return { ok: true };
  })
};

/* ===================== daily reports ===================== */

function hourlyReports() {
  var now = new Date();
  var hour = Utilities.formatDate(now, TZ, 'HH');
  var today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  recipients_().forEach(function (r) {
    if (!r.active || !r.email || String(r.time).slice(0, 2) !== hour) return;
    var key = 'sent_' + r.id + '_' + today;
    if (props.getProperty(key)) return;
    try { sendReport_(r, now, false); props.setProperty(key, '1'); } catch (e) { console.error(e); }
  });
  // forget old "sent" markers
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sent_') === 0 && k.slice(-10) < Utilities.formatDate(new Date(now.getTime() - 3 * 864e5), TZ, 'yyyy-MM-dd')) props.deleteProperty(k);
  });
}

function sendReport_(r, now, isTest) {
  var prevDay = getSetting_('prevDay') !== 'false';
  // A test email shows today's answers so it is never empty right after setup.
  var day = Utilities.formatDate(prevDay && !isTest ? new Date(now.getTime() - 864e5) : now, TZ, 'yyyy-MM-dd');
  var dayLabel = day.split('-').reverse().join('.');
  var ids = r.stations === 'all' ? null : r.stations;
  var sts = stations_().filter(function (s) { return !ids || ids.indexOf(s.id) >= 0; });
  var resp = rows_('responses').filter(function (x) { return x.date === day && (!ids || ids.indexOf(x.station) >= 0); });
  var title = (isTest ? '[ניסיון] ' : '') + 'דוח משוב חדר אוכל · ' + dayLabel + (sts.length === 1 ? ' · ' + sts[0].name : '');
  var html = reportHtml_(resp, sts, dayLabel);
  MailApp.sendEmail({ to: r.email, subject: title, htmlBody: html, name: 'LEE BAR משוב' });
}

function reportHtml_(resp, sts, dayLabel) {
  var color = function (v) { return v == null ? '#6b6b6b' : v >= 4.5 ? '#2C8A57' : v >= 3.5 ? '#78A646' : v >= 2.5 ? '#B8901E' : v >= 1.5 ? '#E07A35' : '#C4402B'; };
  var f = function (v) { return v == null ? '–' : v.toFixed(1); };
  var cell = 'padding:8px 10px;border-bottom:1px solid #e6e1da;';
  var h = '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;color:#12201A;max-width:680px">';
  h += '<h2 style="margin:0 0 4px;color:#5B2D12">משוב חדר האוכל · ' + dayLabel + '</h2>';
  if (!resp.length) {
    h += '<p>לא התקבלו משובים ביום הזה' + (sts.length ? ' בתחנות: ' + esc_(sts.map(function (s) { return s.name; }).join(', ')) : '') + '.</p>';
  } else {
    var ov = avg_(resp.map(overall_).filter(function (v) { return v != null; }));
    var ex = resp.filter(function (x) { return x.expect; });
    var exOk = ex.length ? Math.round(ex.filter(function (x) { return x.expect === 'exceeded' || x.expect === 'met'; }).length / ex.length * 100) : null;
    h += '<p style="font-size:15px;margin:6px 0 16px"><b>' + resp.length + '</b> משובים · ציון ממוצע <b style="color:' + color(ov) + '">' + f(ov) + '</b> מתוך 5' + (exOk != null ? ' · ' + exOk + '% עמד או עלה על הציפיות' : '') + '</p>';
    h += '<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="background:#F3E9E1">';
    h += '<th style="' + cell + 'text-align:right">תחנה</th><th style="' + cell + '">משובים</th><th style="' + cell + '">ממוצע</th>';
    METRICS.forEach(function (m) { h += '<th style="' + cell + '">' + m[1] + '</th>'; });
    h += '</tr>';
    sts.forEach(function (s) {
      var l = resp.filter(function (x) { return x.station === s.id; });
      if (!l.length && sts.length > 1) return;
      var a = avg_(l.map(overall_).filter(function (v) { return v != null; }));
      h += '<tr><td style="' + cell + '"><b>' + esc_(s.name) + '</b></td><td style="' + cell + 'text-align:center">' + l.length + '</td><td style="' + cell + 'text-align:center;color:' + color(a) + ';font-weight:bold">' + f(a) + '</td>';
      METRICS.forEach(function (m) { var v = avg_(l.map(function (x) { return num_(x[m[0]]); }).filter(function (v) { return v != null; })); h += '<td style="' + cell + 'text-align:center;color:' + color(v) + '">' + f(v) + '</td>'; });
      h += '</tr>';
    });
    h += '</table>';
    var notes = resp.filter(function (x) { return x.improve || x.comments; }).slice(0, 25);
    if (notes.length) {
      h += '<h3 style="margin:20px 0 6px">מה ביקשו לשפר</h3><ul style="padding-right:18px;margin:0">';
      notes.forEach(function (x) { h += '<li style="margin:4px 0">' + esc_([x.improve, x.comments].filter(String).join(' · ')) + ' <span style="color:#6b6b6b">(' + esc_(x.stationName) + ', ' + x.time + ')</span></li>'; });
      h += '</ul>';
    }
  }
  h += '<p style="margin-top:22px"><a href="' + DASHBOARD_URL + '" style="background:#5B2D12;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">פתיחת הדשבורד</a></p>';
  h += '<p style="color:#8a8a8a;font-size:12px">המשובים אנונימיים. הדוח נשלח אוטומטית ממערכת המשוב של LEE BAR.</p></div>';
  return h;
}

/* ===================== helpers ===================== */

function sheet_(k) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TITLES[k]); }
function rows_(k) {
  var sh = sheet_(k); if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), SHEETS[k].length).getValues();
  var head = vals.shift();
  return vals.map(function (row) { var o = {}; head.forEach(function (h, i) { o[h] = row[i] instanceof Date ? Utilities.formatDate(row[i], TZ, h === 'time' ? 'HH:mm' : 'yyyy-MM-dd') : row[i]; }); return o; });
}
function appendObj_(k, obj) {
  var sh = sheet_(k);
  var row = SHEETS[k].map(function (h) { return cellVal_(obj[h]); });
  sh.appendRow(row);
}
// Strings are written with a leading apostrophe so Sheets keeps them as text
// (otherwise "09:00", dates and codes get converted to times or numbers).
function cellVal_(v) { if (v === undefined || v === null) return ''; return typeof v === 'string' && v !== '' ? "'" + v : v; }
function updateRow_(k, id, patch) {
  var sh = sheet_(k), ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      Object.keys(patch).forEach(function (h) { var c = SHEETS[k].indexOf(h); if (c >= 0) sh.getRange(i + 2, c + 1).setValue(cellVal_(patch[h])); });
      return true;
    }
  }
  return false;
}
function deleteRow_(k, id) {
  var sh = sheet_(k), ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); return true; }
  return false;
}
function responseIdExists_(id) {
  var sh = sheet_('responses'), n = sh.getLastRow(); if (n < 2) return false;
  var col = SHEETS.responses.indexOf('id') + 1, from = Math.max(2, n - 300);
  return sh.getRange(from, col, n - from + 1, 1).getValues().some(function (r) { return String(r[0]) === String(id); });
}
function stations_() { return rows_('stations').sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); }); }
function stationById_(id) { return stations_().filter(function (s) { return s.id === id; })[0]; }
function recipients_() {
  return rows_('recipients').map(function (r) {
    return { id: String(r.id), email: String(r.email || ''), time: String(r.time || '09:00').slice(0, 5), stations: !r.stations || r.stations === 'all' ? 'all' : String(r.stations).split(',').filter(String), active: r.active !== false && String(r.active).toUpperCase() !== 'FALSE', order: Number(r.order) || 0 };
  }).sort(function (a, b) { return a.order - b.order; });
}
function getSetting_(key) {
  var r = rows_('settings').filter(function (x) { return x.key === key; })[0];
  return r ? String(r.value) : null;
}
function setSetting_(key, value) { if (!updateRow_('settings', key, { value: value })) appendObj_('settings', { key: key, value: value }); }
function stCode_(name) { return String(name || '').replace(/[^A-Za-z֐-׿À-ɏ]/g, '').slice(0, 2).toLowerCase(); }
function checkPin_(pin, stationId, optional) {
  if (!pin && optional) return null;
  var p = String(pin || '');
  if (!/^\d{4,6}$/.test(p)) return 'pin_format';
  var h = hash_(p);
  if (h === getSetting_('masterPinHash')) return 'pin_taken';
  if (stations_().some(function (s) { return s.id !== stationId && s.managerPinHash === h; })) return 'pin_taken';
  return null;
}
function hash_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'leebar:' + s, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}
function secret_() { return PropertiesService.getScriptProperties().getProperty('SECRET') || ''; }
function sign_(payload) {
  var sig = Utilities.computeHmacSha256Signature(payload, secret_());
  return Utilities.base64EncodeWebSafe(payload) + '.' + Utilities.base64EncodeWebSafe(sig);
}
function verify_(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  var parts = String(token).split('.');
  var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  if (sign_(payload) !== String(token)) return null;
  return payload.split('|');
}
function session_(token) {
  var p = verify_(token);
  if (!p || p[0] !== 'dash' || Number(p[2]) < Date.now()) return null;
  if (p[1] !== 'all' && !stationById_(p[1])) return null;
  return { role: p[1] };
}
function admin_(fn) { return function (req) { var s = session_(req.token); if (!s || s.role !== 'all') return { ok: false, error: 'not_admin' }; return fn(req); }; }
function num_(v) { v = Number(v); return v >= 1 && v <= 5 ? v : null; }
function overall_(r) { var v = METRICS.map(function (m) { return num_(r[m[0]]); }).filter(function (x) { return x != null; }); return v.length ? avg_(v) : null; }
function avg_(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
