/** Google Forms/Sheets -> signed webhook. One project/configuration per source. */
var DOPAMIN_ROW_KEY_HEADER_ = '__DOPAMIN_ROW_KEY';

function sourceKey_(props) {
  var key = required_(props, 'DOPAMIN_SOURCE_KEY').trim().toUpperCase();
  if (['CASHIER', 'KITCHEN', 'BEVERAGE'].indexOf(key) < 0) throw new Error('DOPAMIN_SOURCE_KEY must be CASHIER, KITCHEN, or BEVERAGE');
  return key;
}

function findRowKeyColumn_(sheet) {
  var last = sheet.getLastColumn();
  if (last < 1) return 0;
  var found = 0;
  sheet.getRange(1, 1, 1, last).getDisplayValues()[0].forEach(function(header, index) {
    if (header === DOPAMIN_ROW_KEY_HEADER_) {
      if (found) throw new Error('Duplicate Dopamin row key column');
      found = index + 1;
    }
  });
  return found;
}

/** Run once manually before triggers/backfill. Only integration metadata is written. */
function initializeConfiguredSource() {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    sourceKey_(PropertiesService.getScriptProperties());
    var sheet = configuredSheet_();
    var column = findRowKeyColumn_(sheet);
    if (!column) {
      column = sheet.getLastColumn() + 1;
      if (column > sheet.getMaxColumns()) sheet.insertColumnAfter(sheet.getMaxColumns());
      sheet.getRange(1, column).setValue(DOPAMIN_ROW_KEY_HEADER_);
    }
    sheet.hideColumns(column);
    SpreadsheetApp.flush();
    return { spreadsheetId: sheet.getParent().getId(), gid: sheet.getSheetId(), sheetName: sheet.getName(), rowKeyColumn: column };
  } finally { lock.releaseLock(); }
}

function stableRowKey_(sheet, row, lockAlreadyHeld) {
  // Backfill already owns this lock; live/replay must acquire it before assigning a key.
  var lock = lockAlreadyHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(5000);
  try {
    var column = findRowKeyColumn_(sheet);
    if (!column) throw new Error('Dopamin row key column is missing. Run initializeConfiguredSource() first.');
    var cell = sheet.getRange(row, column);
    var existing = String(cell.getDisplayValue() || '').trim();
    if (existing) return existing;
    var key = Utilities.getUuid();
    cell.setValue(key);
    SpreadsheetApp.flush();
    return key;
  } finally { if (lock) lock.releaseLock(); }
}

function configuredSheet_() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheet = SpreadsheetApp.openById(required_(props, 'DOPAMIN_SPREADSHEET_ID'));
  var gid = required_(props, 'DOPAMIN_SHEET_ID');
  var sheet = spreadsheet.getSheets().filter(function(candidate) { return String(candidate.getSheetId()) === gid; })[0];
  if (!sheet) throw new Error('Configured sheet gid was not found');
  return sheet;
}

/** Run manually to obtain exact configuration metadata; returns no response values/secrets. */
function describeConfiguredSource() {
  var sheet = configuredSheet_();

  var headers = sheet
    .getRange(
      1,
      1,
      1,
      sheet.getLastColumn()
    )
    .getDisplayValues()[0];

  var result = {
    sourceKey: sourceKey_(
      PropertiesService.getScriptProperties()
    ),

    spreadsheetId: sheet
      .getParent()
      .getId(),

    gid: sheet.getSheetId(),

    sheetName: sheet.getName(),

    rowKeyColumn:
      findRowKeyColumn_(sheet),

    headers: headers.filter(
      function(header) {
        return (
          header !==
          DOPAMIN_ROW_KEY_HEADER_
        );
      }
    )
  };

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}

function onFormSubmit(e) {
  if (!e || !e.range) throw new Error('Install a spreadsheet On form submit trigger');
  var sheet = configuredSheet_();
  if (e.range.getSheet().getParent().getId() !== sheet.getParent().getId() || e.range.getSheet().getSheetId() !== sheet.getSheetId()) return;
  sendRow_(sheet, e.range.getRow());
}

function batchSize_(props) {
  var count = Number(props.getProperty('DOPAMIN_REPLAY_ROWS') || '50');
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('DOPAMIN_REPLAY_ROWS must be 1..100');
  return count;
}

function sendLastRowForTest() {
  var sheet =
    configuredSheet_();

  var row =
    sheet.getLastRow();

  if (row < 2) {
    throw new Error(
      'Tidak ada data untuk diuji.'
    );
  }

  var result =
    sendRow_(
      sheet,
      row
    );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}

function replayRecentRows() {
  var sheet = configuredSheet_();
  var props = PropertiesService.getScriptProperties();
  var last = sheet.getLastRow();
  for (var row = Math.max(2, last - batchSize_(props) + 1); row <= last; row++) sendRow_(sheet, row);
}

/** Repeat manually or by timer until done. Cursor advances only after accepted delivery. */
function backfillRows() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var sheet = configuredSheet_();
    var cursorKey = 'DOPAMIN_BACKFILL_NEXT_ROW_' + sourceKey_(props) + '_' + sheet.getParent().getId() + '_' + sheet.getSheetId();
    var next = Number(props.getProperty(cursorKey) || '2');
    if (!Number.isInteger(next) || next < 2) throw new Error('Invalid backfill cursor');
    var last = Math.min(sheet.getLastRow(), next + batchSize_(props) - 1);
    var started = Date.now();
    for (; next <= last && Date.now() - started < 240000; next++) {
      sendRow_(sheet, next, true);
      props.setProperty(cursorKey, String(next + 1));
      Utilities.sleep(200);
    }
    return { nextRow: next, done: next > sheet.getLastRow() };
  } finally { lock.releaseLock(); }
}

function envelopeForRow_(sheet, row, lockAlreadyHeld) {
  if (row < 2) throw new Error('Header row cannot be delivered');
  var props = PropertiesService.getScriptProperties();
  var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var businessValues = values.filter(function(value, index) { return headers[index] !== DOPAMIN_ROW_KEY_HEADER_; });
  if (businessValues.every(function(value) { return value === ''; })) return null;
  var sourceKey = sourceKey_(props);
  var payload = Object.create(null);
  headers.forEach(function(header, i) {
    if (header === DOPAMIN_ROW_KEY_HEADER_) return;
    if (!header.trim() || Object.prototype.hasOwnProperty.call(payload, header)) throw new Error('Blank or duplicate source header; resolve before ingestion');
    var value = values[i];
    // Both live and replay read the same typed cells. Business dates remain date-only.
    if (value instanceof Date) value = Utilities.formatDate(value, 'Asia/Jakarta', i === 0 ? "yyyy-MM-dd'T'HH:mm:ssXXX" : 'yyyy-MM-dd');
    payload[header] = value;
  });
  if (!(values[0] instanceof Date) || isNaN(values[0].getTime())) throw new Error('Source timestamp in column 1 must be a valid date');
  return {
    sourceKey: sourceKey,
    spreadsheetId: sheet.getParent().getId(), sheetName: sheet.getName(),
    // UUID moves with the complete row, including this hidden metadata column.
    rowKey: stableRowKey_(sheet, row, lockAlreadyHeld),
    submittedAt: Utilities.formatDate(values[0], 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    eventCreatedAt: new Date().toISOString(), payload: payload
  };
}

function sendRow_(sheet, row, lockAlreadyHeld) {
  var envelope = envelopeForRow_(sheet, row, lockAlreadyHeld);
  if (!envelope) return;
  var props = PropertiesService.getScriptProperties();
  var baseUrl = required_(props, 'DOPAMIN_BASE_URL').replace(/\/$/, '');
  if (!/^https:\/\//.test(baseUrl)) throw new Error('DOPAMIN_BASE_URL must use HTTPS');
  var secret = required_(props, 'DOPAMIN_INTEGRATION_SECRET');
  var body = JSON.stringify(envelope);
  for (var attempt = 0; attempt < 3; attempt++) {
    var timestamp = String(Math.floor(Date.now() / 1000));
    var signature = hex_(Utilities.computeHmacSha256Signature(timestamp + '.' + body, secret, Utilities.Charset.UTF_8));
    var response;
    try {
      response = UrlFetchApp.fetch(baseUrl + '/api/integrations/google-form/' + encodeURIComponent(envelope.sourceKey), {
        method: 'post', contentType: 'application/json', payload: body,
        headers: { 'X-Dopamin-Timestamp': timestamp, 'X-Dopamin-Signature': 'sha256=' + signature },
        muteHttpExceptions: true, followRedirects: false
      });
    } catch (error) {
      if (attempt === 2) throw new Error('Dopamin webhook network failure; cursor retained');
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) {
      var parsed = JSON.parse(response.getContentText());
      if (!parsed.ok || !parsed.data || ['VALID', 'NEEDS_REVIEW', 'SUPERSEDED'].indexOf(parsed.data.status) < 0) throw new Error('Submission requires backend review/reprocess; cursor retained');
      return parsed.data;
    }
    if ((status !== 429 && status < 500) || attempt === 2) throw new Error('Dopamin webhook failed HTTP ' + status);
    Utilities.sleep(1000 * Math.pow(2, attempt));
  }
}

function required_(props, key) {
  var value = props.getProperty(key);
  if (!value) throw new Error('Missing Script Property: ' + key);
  return value;
}
function hex_(bytes) { return bytes.map(function(b){ var n=(b<0?b+256:b).toString(16); return n.length===1?'0'+n:n; }).join(''); }

/**
 * Scheduler heartbeat for Dopamin daily report.
 * Script Property required: DOPAMIN_REPORT_JOB_SECRET.
 * Create a time-driven trigger every ~15 minutes for dailyReportHeartbeat.
 */
function dailyReportHeartbeat() {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = required_(props, 'DOPAMIN_BASE_URL').replace(/\/$/, '');
  var secret = required_(props, 'DOPAMIN_REPORT_JOB_SECRET');
  var requestBody = JSON.stringify({ requestedAt: new Date().toISOString() });
  var result = signedJsonPost_(baseUrl + '/api/jobs/daily-report/heartbeat', requestBody, secret);
  var parsed = JSON.parse(result);
  if (!parsed.ok || !parsed.data || parsed.data.action !== 'SEND') return result;

  var job = parsed.data;
  job.recipients.forEach(function(recipient) {
    var status = 'SENT';
    var errorMessage = null;
    try {
      MailApp.sendEmail({ to: recipient, subject: job.subject, htmlBody: job.htmlBody, body: job.textBody || job.subject });
    } catch (err) {
      status = 'FAILED';
      errorMessage = String(err && err.message ? err.message : err);
    }
    var callbackBody = JSON.stringify({ runId: job.runId, recipientEmail: recipient, status: status, errorMessage: errorMessage || undefined });
    signedJsonPost_(baseUrl + '/api/jobs/daily-report/delivery', callbackBody, secret);
  });
  return result;
}

function signedJsonPost_(url, body, secret) {
  var timestamp = String(Math.floor(Date.now() / 1000));
  var signature = hex_(Utilities.computeHmacSha256Signature(timestamp + '.' + body, secret, Utilities.Charset.UTF_8));
  var response = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload: body,
    headers: { 'X-Dopamin-Timestamp': timestamp, 'X-Dopamin-Signature': 'sha256=' + signature },
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Dopamin job failed HTTP ' + code + ': ' + response.getContentText());
  return response.getContentText();
}
