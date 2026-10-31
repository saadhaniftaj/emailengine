/**
 * Zoho-only cold-outreach automation (Google Sheets + Apps Script + Zoho Mail API).
 * No Gmail involved. Tabs: Leads | Templates | Settings | Log
 *
 * - Sends initial email + follow-ups from your Zoho mailbox via the Zoho Mail API.
 * - Humanised pacing: random gaps, random pauses, daily cap (default 150 incl. follow-ups).
 * - Time-zone aware: each lead is only emailed during its LOCAL morning window
 *   (default 08:00-11:00) on a local working day, so mail is near the top of the inbox.
 * - Follow-ups are replies in the same thread. Delays are adjustable in Settings.
 * - Real replies -> GREEN "Reply Status" cell, sequence stops for that lead.
 *   NO automated replies are ever sent. Out-of-office = yellow (ignored), bounce = red.
 */

var TICK_MINUTES = 5;

/* ================= menu / setup ================= */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Outreach')
    .addItem('1. Connect Zoho (one time)', 'connectZoho')
    .addItem('2. Start automation (create trigger)', 'setup')
    .addItem('Send preview of all templates to me', 'sendPreview')
    .addItem('Run one cycle now', 'tick')
    .addSeparator()
    .addItem('Pause / Resume', 'togglePause')
    .addItem('Stop automation', 'removeTriggers')
    .addToUi();
}

/** One-time: paste Client ID, Client Secret and the Self-Client grant code. */
function connectZoho() {
  var ui = SpreadsheetApp.getUi();
  function ask(t) { var r = ui.prompt('Connect Zoho', t, ui.ButtonSet.OK_CANCEL); if (r.getSelectedButton() !== ui.Button.OK) throw new Error('Cancelled'); return r.getResponseText().trim(); }
  var id = ask('Client ID (from api-console.zoho.* > Self Client):');
  var secret = ask('Client Secret:');
  var code = ask('Grant code (generated with scope ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.READ). It expires in a few minutes:');
  var dc = dc_();
  var res = UrlFetchApp.fetch('https://accounts.zoho.' + dc + '/oauth/v2/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'authorization_code', client_id: id, client_secret: secret, code: code }
  });
  var j = JSON.parse(res.getContentText());
  if (!j.refresh_token) throw new Error('Zoho said: ' + res.getContentText());
  var p = PropertiesService.getScriptProperties();
  p.setProperties({ zClientId: id, zSecret: secret, zRefresh: j.refresh_token });
  CacheService.getScriptCache().removeAll(['zAccess']);
  var aid = accountId_();
  ui.alert('Connected. Zoho account id: ' + aid + '\nNext: Outreach > Start automation.');
}

function setup() {
  removeTriggers();
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(TICK_MINUTES).create();
  zoho_('get', '/accounts');   // verifies the connection
  scanReplies_(14);
  SpreadsheetApp.getUi().alert('Automation started (checks every ' + TICK_MINUTES + ' min).\nSystem is ' +
    (isPaused_() ? 'PAUSED - set Paused to FALSE in Settings (or Outreach > Pause / Resume) to begin sending.' : 'RUNNING.'));
}

function removeTriggers() { ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); }); }

function togglePause() {
  var sh = sheet_('Settings'), rows = sh.getDataRange().getValues();
  for (var i = 0; i < rows.length; i++) if (rows[i][0] === 'Paused') {
    var v = String(rows[i][1]).toUpperCase() === 'TRUE';
    sh.getRange(i + 1, 2).setValue(!v);
    SpreadsheetApp.getUi().alert(v ? 'Resumed.' : 'Paused.');
    return;
  }
}

/* ================= main loop ================= */
function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    scanReplies_(2);              // reply tracking always runs, even when paused
    if (isPaused_()) return;
    scheduleNew_();
    sendOne_();
  } catch (e) {
    log_('ERROR', '', e.message);
    var a = settings_()['Alert Email'];
    var p = PropertiesService.getScriptProperties();
    if (a && String(a).indexOf('FILL_ME') < 0 && Date.now() - Number(p.getProperty('lastAlert') || 0) > 3600000) {
      p.setProperty('lastAlert', String(Date.now()));
      MailApp.sendEmail(a, 'Outreach script error', e.message + '\n' + e.stack);
    }
  } finally { lock.releaseLock(); }
}

/* ================= sheet helpers ================= */
function sheet_(n) { return SpreadsheetApp.getActive().getSheetByName(n); }
function settings_() {
  var o = {};
  sheet_('Settings').getDataRange().getValues().forEach(function (r) { if (r[0]) o[String(r[0]).trim()] = r[1]; });
  return o;
}
function isPaused_() { return String(settings_()['Paused']).toUpperCase() === 'TRUE'; }
function dc_() { return String(settings_()['Zoho Data Center'] || 'com').trim().replace(/^\./, ''); }
function templates_() {
  var t = {};
  sheet_('Templates').getDataRange().getValues().slice(1).forEach(function (r) {
    if (r[0] !== '') t[Number(r[0])] = { subject: String(r[1]), body: String(r[2]) };
  });
  return t;
}
function readLeads_() {
  var sh = sheet_('Leads'), data = sh.getDataRange().getValues();
  var head = data[0].map(function (h) { return String(h).trim(); }), col = {};
  head.forEach(function (h, i) { col[h] = i; });
  return { sh: sh, data: data, head: head, col: col };
}
function set_(L, row, name, val) { L.sh.getRange(row + 1, L.col[name] + 1).setValue(val); L.data[row][L.col[name]] = val; }
function log_(type, email, msg) { sheet_('Log').appendRow([new Date(), type, email, msg]); }
function delays_() {
  return String(settings_()['Follow-up Delays (hours)']).split(',')
    .map(function (x) { return Number(x.trim()); }).filter(function (x) { return x > 0; });
}
function leadVars_(L, row) {
  var v = {};
  L.head.forEach(function (h, i) { v[h] = row[i] === undefined || row[i] === null ? '' : String(row[i]); });
  v['FirstName'] = firstName_(row[L.col['Name']]);
  v['CompanyName'] = v['Company'];
  return v;
}

/* ================= Zoho API ================= */
function accessToken_() {
  var cache = CacheService.getScriptCache(), t = cache.get('zAccess');
  if (t) return t;
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('zRefresh')) throw new Error('Zoho not connected. Run Outreach > Connect Zoho.');
  var res = UrlFetchApp.fetch('https://accounts.zoho.' + dc_() + '/oauth/v2/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'refresh_token', client_id: p.getProperty('zClientId'), client_secret: p.getProperty('zSecret'), refresh_token: p.getProperty('zRefresh') }
  });
  var j = JSON.parse(res.getContentText());
  if (!j.access_token) throw new Error('Zoho token error: ' + res.getContentText());
  cache.put('zAccess', j.access_token, 3000);
  return j.access_token;
}

function zoho_(method, path, body) {
  var opts = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Zoho-oauthtoken ' + accessToken_(), Accept: 'application/json' } };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch('https://mail.zoho.' + dc_() + '/api' + path, opts);
  var code = res.getResponseCode(), txt = res.getContentText();
  if (code >= 300) throw new Error('Zoho API ' + code + ' ' + path + ': ' + txt.slice(0, 300));
  return JSON.parse(txt);
}

function accountId_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('zAccountId');
  if (id) return id;
  var r = zoho_('get', '/accounts');
  id = String(r.data[0].accountId);
  p.setProperty('zAccountId', id);
  return id;
}

function inboxId_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('zInbox');
  if (id) return id;
  var r = zoho_('get', '/accounts/' + accountId_() + '/folders');
  r.data.forEach(function (f) { if (String(f.folderType).toLowerCase() === 'inbox') id = String(f.folderId); });
  p.setProperty('zInbox', id);
  return id;
}

/** Send a new mail; returns Zoho messageId. */
function sendNew_(to, subject, body, from, name) {
  var r = zoho_('post', '/accounts/' + accountId_() + '/messages', {
    fromAddress: name ? '"' + name + '" <' + from + '>' : from, toAddress: to, subject: subject, content: body.replace(/\n/g, '<br>'), mailFormat: 'html', askReceipt: 'no'
  });
  return String(r.data.messageId);
}

/** Send as a threaded reply to the earlier message; falls back to a fresh mail. */
function sendReply_(msgId, to, subject, body, from, name) {
  try {
    var r = zoho_('post', '/accounts/' + accountId_() + '/messages/' + msgId, {
      action: 'reply', fromAddress: name ? '"' + name + '" <' + from + '>' : from, toAddress: to, subject: subject, content: body.replace(/\n/g, '<br>'), mailFormat: 'html'
    });
    return String(r.data.messageId || msgId);
  } catch (e) {
    log_('WARN', to, 'reply failed, sent as new mail: ' + e.message);
    return sendNew_(to, subject, body, from, name);
  }
}

/* ================= scheduling ================= */
function scheduleNew_() {
  var L = readLeads_(), dl = delays_(), seen = {};
  for (var r = 1; r < L.data.length; r++) {
    var row = L.data[r], email = String(row[L.col['Email']]).trim().toLowerCase();
    if (!email) continue;
    var status = String(row[L.col['Status']] || '');
    if (['Needs Review', 'Duplicate', 'Responded', 'Bounced', 'No Response'].indexOf(status) >= 0) { seen[email] = 1; continue; }
    if (seen[email]) { set_(L, r, 'Status', 'Duplicate'); continue; }
    seen[email] = 1;
    if (row[L.col['Due At']]) continue;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !firstName_(row[L.col['Name']])) {
      set_(L, r, 'Status', 'Needs Review'); set_(L, r, 'Notes', 'Invalid email or missing name'); continue;
    }
    set_(L, r, 'Time Zone', tzFor_(row[L.col['Location']]).tz);
    if (status === '' || status === 'Not Sent') {
      set_(L, r, 'Status', 'Not Sent'); set_(L, r, 'Due At', new Date());
    } else if (status === 'Awaiting Reply') {
      var sent = Number(row[L.col['Follow-ups Sent']] || 0);
      if (sent >= dl.length) { set_(L, r, 'Status', 'No Response'); continue; }
      set_(L, r, 'Due At', new Date(new Date(row[L.col['Last Sent At']]).getTime() + dl[sent] * 3600000));
    }
  }
}

function firstName_(n) {
  n = String(n || '').trim().replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '');
  var f = n.split(/\s+/)[0];
  return f ? f.charAt(0).toUpperCase() + f.slice(1) : '';
}

function tzFor_(loc) {
  var l = String(loc).toLowerCase().trim();
  var gulf = /uae|dubai|sharjah|abu dhabi|ksa|saudi|riyadh|egypt|qatar|kuwait|bahrain|oman/.test(l);
  var map = [
    [/uae|dubai|sharjah|abu dhabi/, 'Asia/Dubai'], [/ksa|saudi|riyadh|kuwait/, 'Asia/Riyadh'],
    [/qatar/, 'Asia/Qatar'], [/bahrain/, 'Asia/Bahrain'], [/oman/, 'Asia/Muscat'], [/egypt/, 'Africa/Cairo'],
    [/uk|london|england|britain|scotland|ireland/, 'Europe/London'], [/germany|austria/, 'Europe/Berlin'],
    [/france/, 'Europe/Paris'], [/netherlands|belgium/, 'Europe/Amsterdam'], [/spain/, 'Europe/Madrid'],
    [/italy/, 'Europe/Rome'], [/switzerland/, 'Europe/Zurich'], [/bulgaria/, 'Europe/Sofia'], [/turkey/, 'Europe/Istanbul'],
    [/singapore/, 'Asia/Singapore'], [/indonesia/, 'Asia/Jakarta'], [/phil/, 'Asia/Manila'], [/malaysia/, 'Asia/Kuala_Lumpur'],
    [/china/, 'Asia/Shanghai'], [/india/, 'Asia/Kolkata'], [/pakistan/, 'Asia/Karachi'], [/japan/, 'Asia/Tokyo'],
    [/australia|sydney|melbourne/, 'Australia/Sydney'], [/canada|toronto/, 'America/Toronto'],
    [/california|san francisco|los angeles|seattle|oregon|washington state|nevada/, 'America/Los_Angeles'],
    [/texas|chicago|illinois|minnesota|dallas|houston/, 'America/Chicago'],
    [/colorado|denver|arizona|utah/, 'America/Denver'],
    [/usa|^us$|united states|new york|boston|florida|miami|atlanta/, 'America/New_York']
  ];
  for (var i = 0; i < map.length; i++) if (map[i][0].test(l)) return { tz: map[i][1], gulf: gulf };
  return { tz: 'Europe/London', gulf: false };
}

/** Is it currently inside this lead's local morning window on a local working day? */
function inWindow_(now, tzo, s) {
  var startH = Number(s['Send Window Start (local hour)'] || 8), endH = Number(s['Send Window End (local hour)'] || 11);
  var hh = Number(Utilities.formatDate(now, tzo.tz, 'H')), mm = Number(Utilities.formatDate(now, tzo.tz, 'm'));
  var h = hh + mm / 60;
  var wd = Number(Utilities.formatDate(now, tzo.tz, 'u')) % 7;   // 0 Sun .. 6 Sat
  var weekend = tzo.gulf ? (wd === 5 || wd === 6) : (wd === 0 || wd === 6);
  return !weekend && h >= startH && h < endH;
}

/* ================= sending ================= */
function sendOne_() {
  var s = settings_(), props = PropertiesService.getScriptProperties(), now = new Date();
  if (now.getTime() < Number(props.getProperty('nextAllowed') || 0)) return;

  // rolling 24h cap
  var stamps = JSON.parse(props.getProperty('stamps') || '[]').filter(function (t) { return now.getTime() - t < 86400000; });
  if (stamps.length >= Number(s['Daily Send Cap (rolling 24h)'] || 150)) return;

  var L = readLeads_(), tpl = templates_(), dl = delays_(), elig = [];
  for (var r = 1; r < L.data.length; r++) {
    var st = String(L.data[r][L.col['Status']]), due = L.data[r][L.col['Due At']];
    if (!due || (st !== 'Not Sent' && st !== 'Awaiting Reply')) continue;
    if (new Date(due).getTime() > now.getTime()) continue;
    if (inWindow_(now, tzFor_(L.data[r][L.col['Location']]), s)) elig.push(r);
  }
  if (!elig.length) return;
  var best = elig[Math.floor(Math.random() * elig.length)];   // random pick = natural ordering

  var row = L.data[best], email = String(row[L.col['Email']]).trim();
  var step = String(row[L.col['Status']]) === 'Not Sent' ? 0 : Number(row[L.col['Follow-ups Sent']] || 0) + 1;
  if (!tpl[step]) { set_(L, best, 'Status', 'No Response'); set_(L, best, 'Due At', ''); return; }

  var vars = leadVars_(L, row);
  var subject = render_(tpl[step].subject, vars), body = render_(tpl[step].body, vars);
  if (/\{\{.*?\}\}/.test(subject + body)) {
    set_(L, best, 'Status', 'Needs Review'); set_(L, best, 'Notes', 'Unfilled placeholder'); return;
  }

  var from = s['Zoho Address'], name = s['Sender Name'], msgId = String(row[L.col['Message ID']] || '');
  var newId = (step === 0 || !msgId) ? sendNew_(email, subject, body, from, name) : sendReply_(msgId, email, subject, body, from, name);

  var sentAt = new Date();
  if (step === 0 || !msgId) set_(L, best, 'Message ID', newId);
  set_(L, best, 'Last Sent At', sentAt);
  set_(L, best, 'Status', 'Awaiting Reply');
  if (step === 0) set_(L, best, 'Date Sent', sentAt);
  set_(L, best, 'Follow-ups Sent', step);
  set_(L, best, 'Last Step', step === 0 ? 'Initial' : 'Follow-up ' + step);
  if (step >= dl.length) { set_(L, best, 'Due At', ''); set_(L, best, 'Status', 'No Response'); }
  else set_(L, best, 'Due At', new Date(sentAt.getTime() + dl[step] * 3600000));
  log_('SENT', email, 'step ' + step);

  // humanised pacing: random gap, plus an occasional longer "coffee break"
  var mn = Number(s['Min Gap (minutes)'] || 3), mx = Number(s['Max Gap (minutes)'] || 14);
  var gap = (mn + Math.random() * (mx - mn)) * 60000;
  if (Math.random() < 0.1) gap += (10 + Math.random() * 25) * 60000;
  stamps.push(Date.now());
  props.setProperty('stamps', JSON.stringify(stamps));
  props.setProperty('nextAllowed', String(Date.now() + gap));
}

/** {{Placeholders}} first, then spintax {option a|option b}. */
function render_(text, vars) {
  text = text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (m, k) { return vars[k] ? vars[k] : m; });
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, function (m, o) { var a = o.split('|'); return a[Math.floor(Math.random() * a.length)]; });
}

function sendPreview() {
  var s = settings_(), tpl = templates_(), L = readLeads_();
  var vars = { Name: 'Alex Sample', FirstName: 'Alex', Company: 'Sample Research Ltd', CompanyName: 'Sample Research Ltd', Location: 'UK', Title: 'Director' };
  if (L.data.length > 1 && L.data[1][L.col['Email']]) vars = leadVars_(L, L.data[1]);
  Object.keys(tpl).forEach(function (k) {
    sendNew_(s['Test Email'], '[PREVIEW step ' + k + '] ' + render_(tpl[k].subject, vars), render_(tpl[k].body, vars), s['Zoho Address'], s['Sender Name']);
  });
  SpreadsheetApp.getUi().alert('Previews sent to ' + s['Test Email']);
}

/* ================= reply tracking ================= */
var AUTO_SUBJ = /auto(matic)?[\s-]?(reply|response)|out of office|away from|vacation|\booo\b|automatische antwort|abwesenheit|r[ée]ponse automatique|absence|respuesta autom|fuera de la oficina|afwezig/i;

function scanReplies_(days) {
  var L = readLeads_(), map = {};
  for (var r = 1; r < L.data.length; r++) {
    var e = String(L.data[r][L.col['Email']]).trim().toLowerCase();
    if (e && String(L.data[r][L.col['Status']]) === 'Awaiting Reply') map[e] = r;
  }
  if (!Object.keys(map).length) return;

  var aid = accountId_(), fid = inboxId_(), cutoff = Date.now() - days * 86400000;
  var props = PropertiesService.getScriptProperties();
  var seenIds = JSON.parse(props.getProperty('seenMsgs') || '[]');
  var msgs = [];
  for (var page = 0; page < 6; page++) {
    var res = zoho_('get', '/accounts/' + aid + '/messages/view?folderId=' + fid + '&start=' + (page * 200 + 1) + '&limit=200&sortBy=date&sortorder=false');
    var batch = res.data || [];
    msgs = msgs.concat(batch);
    if (batch.length < 200 || Number(batch[batch.length - 1].receivedTime) < cutoff) break;
  }
  var me = String(settings_()['Zoho Address']).toLowerCase();

  msgs.forEach(function (m) {
    var mid = String(m.messageId);
    if (Number(m.receivedTime) < cutoff || seenIds.indexOf(mid) >= 0) return;
    var from = String(m.fromAddress || m.sender || '').replace(/&lt;|&gt;/g, ' ').toLowerCase();
    var fe = (from.match(/[^\s<>"']+@[^\s<>"']+\.[a-z]{2,}/) || [''])[0];
    var subj = String(m.subject || ''), summary = String(m.summary || '');
    if (!fe || fe === me) return;

    if (/mailer-daemon|postmaster/.test(fe) || /undeliver|delivery status|failure notice|returned mail|delivery has failed|couldn.t be delivered/i.test(subj)) {
      var text = (subj + ' ' + summary + ' ' + safeContent_(aid, fid, mid)).toLowerCase();
      (text.match(/[^\s<>"'()]+@[^\s<>"'()]+\.[a-z]{2,}/g) || []).forEach(function (x) {
        x = x.replace(/[.,;:]+$/, '');
        if (map[x] !== undefined) { mark_(L, map[x], 'Bounced', 'BOUNCED', '#f4c7c3', m); delete map[x]; }
      });
      seenIds.push(mid); return;
    }
    var r = map[fe];
    if (r === undefined) return;
    seenIds.push(mid);
    var sentAt = L.data[r][L.col['Date Sent']];
    if (sentAt && Number(m.receivedTime) < new Date(sentAt).getTime()) return;
    var hdr = safeHeader_(aid, fid, mid);
    var auto = AUTO_SUBJ.test(subj) || /auto-submitted:\s*auto-(replied|generated)|x-autoreply|x-autorespond|precedence:\s*(auto_reply|bulk|junk)/i.test(hdr);
    if (auto) {
      L.sh.getRange(r + 1, L.col['Reply Status'] + 1).setValue('Auto-reply (ignored)').setBackground('#fff2cc');
      log_('AUTO', fe, subj);
    } else {
      mark_(L, r, 'Responded', 'REPLIED - ACTION NEEDED', '#34a853', m);
      delete map[fe];
    }
  });
  props.setProperty('seenMsgs', JSON.stringify(seenIds.slice(-600)));
}

function safeHeader_(aid, fid, mid) {
  try { return JSON.stringify(zoho_('get', '/accounts/' + aid + '/folders/' + fid + '/messages/' + mid + '/header')); } catch (e) { return ''; }
}
function safeContent_(aid, fid, mid) {
  try { return String(zoho_('get', '/accounts/' + aid + '/folders/' + fid + '/messages/' + mid + '/content').data.content || ''); } catch (e) { return ''; }
}

function mark_(L, r, status, label, color, m) {
  set_(L, r, 'Status', status);
  set_(L, r, 'Due At', '');
  set_(L, r, 'Replied At', new Date(Number(m.receivedTime)));
  set_(L, r, 'Reply Snippet', String(m.summary || '').replace(/\s+/g, ' ').slice(0, 200));
  L.sh.getRange(r + 1, L.col['Reply Status'] + 1).setValue(label).setBackground(color).setFontWeight('bold');
  log_(label, L.data[r][L.col['Email']], m.subject);
}
