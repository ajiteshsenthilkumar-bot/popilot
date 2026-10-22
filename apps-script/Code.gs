// POPilot sheet bridge. Paste this into a new Apps Script project (script.google.com)
// owned by the same Google account as the POPilot sheet, then Deploy -> New deployment -> Web app
// (Execute as: Me, Who has access: Anyone). Every request must carry the secret TOKEN.
// This script can only touch the two tabs below.

var TABS = ['POs', 'Updates'];
// The POPilot spreadsheet this script reads and writes (the ID from its URL, not a secret).
var SHEET_ID = '1Tiro3NnOfuCBbHASinFjKruTBg4WkhNpQx8e9ij1IdY';

function ss() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor. It creates the secret token and shows it in the log.
function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('TOKEN')) {
    p.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
  Logger.log('TOKEN=' + p.getProperty('TOKEN'));
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var req = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || req.token !== token) return out({ ok: false, error: 'unauthorized' });
    return out(handle(req));
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function sheetFor(req) {
  if (TABS.indexOf(req.tab) < 0) throw new Error('unknown tab');
  var sh = ss().getSheetByName(req.tab);
  if (!sh) throw new Error('tab missing, run seed first');
  return sh;
}

// write as plain text so dates like 2026-10-26 are not turned into Date objects
function put(sh, row, values) {
  sh.getRange(row, 1, values.length, values[0].length).setNumberFormat('@').setValues(values);
}

function findRow(sh, key) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === key) return i + 2;
  return -1;
}

function handle(req) {
  if (req.action === 'ensure') {
    var book = ss();
    TABS.forEach(function (name) {
      var sh = book.getSheetByName(name) || book.insertSheet(name);
      if (sh.getRange(1, 1).getDisplayValue() === '') {
        var h = req.headers[name];
        sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
        sh.setFrozenRows(1);
      }
      sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
    });
    return { ok: true };
  }

  var sh = sheetFor(req);

  if (req.action === 'read') {
    var last = sh.getLastRow();
    if (last < 2) return { ok: true, values: [] };
    return { ok: true, values: sh.getRange(2, 1, last - 1, sh.getLastColumn()).getDisplayValues() };
  }

  if (req.action === 'replace') {
    var l = sh.getLastRow();
    if (l >= 2) sh.getRange(2, 1, l - 1, sh.getLastColumn()).clearContent();
    if (req.rows.length) put(sh, 2, req.rows);
    return { ok: true };
  }

  if (req.action === 'append') {
    put(sh, sh.getLastRow() + 1, [req.row]);
    return { ok: true };
  }

  if (req.action === 'setCell') {
    var r = findRow(sh, req.key);
    if (r < 0) return { ok: true, found: false };
    sh.getRange(r, req.col).setNumberFormat('@').setValue(req.value);
    return { ok: true, found: true };
  }

  if (req.action === 'replaceRow') {
    var rr = findRow(sh, req.key);
    if (rr < 0) return { ok: true, found: false };
    put(sh, rr, [req.row]);
    return { ok: true, found: true };
  }

  throw new Error('unknown action');
}
