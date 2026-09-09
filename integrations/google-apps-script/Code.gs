/**
 * Dopamin Cafe Google Forms/Sheets -> Next.js signed webhook.
 * Configure Script Properties:
 * DOPAMIN_BASE_URL, DOPAMIN_INTEGRATION_SECRET, DOPAMIN_SOURCE_KEY
 * Optional: DOPAMIN_REPLAY_ROWS (default 50)
 */
function onFormSubmit(e) {
  var sheet = e.range.getSheet();
  sendRow_(sheet, e.range.getRow(), e.namedValues || null);
}

function replayRecentRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var props = PropertiesService.getScriptProperties();
  var count = Number(props.getProperty('DOPAMIN_REPLAY_ROWS') || '50');
  var last = sheet.getLastRow();
  var first = Math.max(2, last - count + 1);
  for (var row = first; row <= last; row++) sendRow_(sheet, row, null);
}

function sendRow_(sheet, row, namedValues) {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = required_(props, 'DOPAMIN_BASE_URL').replace(/\/$/, '');
  var secret = required_(props, 'DOPAMIN_INTEGRATION_SECRET');
  var sourceKey = required_(props, 'DOPAMIN_SOURCE_KEY');
  var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var payload = {};
  headers.forEach(function(header, i) {
    var value = namedValues && Object.prototype.hasOwnProperty.call(namedValues, header) ? namedValues[header] : values[i];
    if (Array.isArray(value) && value.length === 1) value = value[0];
    if (value instanceof Date) value = Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ssXXX");
    payload[header] = value;
  });
  var submitted = values[0] instanceof Date ? values[0] : new Date();
  var envelope = {
    sourceKey: sourceKey,
    spreadsheetId: sheet.getParent().getId(),
    sheetName: sheet.getName(),
    rowKey: String(row),
    submittedAt: Utilities.formatDate(submitted, Session.getScriptTimeZone() || 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    eventCreatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    payload: payload
  };
  var body = JSON.stringify(envelope);
  var timestamp = String(Math.floor(Date.now() / 1000));
  var signature = hex_(Utilities.computeHmacSha256Signature(timestamp + '.' + body, secret, Utilities.Charset.UTF_8));
  var response = UrlFetchApp.fetch(baseUrl + '/api/integrations/google-form/' + encodeURIComponent(sourceKey), {
    method: 'post',
    contentType: 'application/json',
    payload: body,
    headers: {
      'X-Dopamin-Timestamp': timestamp,
      'X-Dopamin-Signature': 'sha256=' + signature
    },
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('Dopamin webhook failed HTTP ' + status + ': ' + response.getContentText());
  return response.getContentText();
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
