/**
 * 育児記録アプリ バックエンド (Google Apps Script)
 *
 * セットアップ手順:
 *   1. Google スプレッドシートを新規作成し、シート名を "records" に変更
 *   2. GASエディタ「プロジェクトの設定」→「スクリプトプロパティ」に以下を追加:
 *        SPREADSHEET_ID  ← スプレッドシートのID
 *   3. 「プロジェクトの設定」→「Chrome V8 ランタイムを有効にする」にチェック
 *   4. 「デプロイ」→「新しいデプロイ」→ 種類: ウェブアプリ
 *      - 次のユーザーとして実行: 自分
 *      - アクセスできるユーザー: 全員
 *   5. デプロイ後の URL をアプリの起動画面に貼り付ける
 */

/* ============================================================
   設定はスクリプトプロパティから読み込む
   GASエディタ → プロジェクトの設定 → スクリプトプロパティ で設定すること
   ============================================================ */

function getProp(key) {
  const val = PropertiesService.getScriptProperties().getProperty(key);
  if (!val) throw new Error('スクリプトプロパティ "' + key + '" が設定されていません');
  return val;
}

const SHEET_NAME = 'records';

const COL = {
  ID:          0,
  DATE:        1,
  CATEGORY:    2,
  TYPE:        3,
  START:       4,
  END:         5,
  DURATION:    6,
  AMOUNT:      7,
  MEMO:        8,
  CREATED_AT:  9,
  UPDATED_AT: 10,
  COUNT:      11,
};

/* ============================================================
   エントリポイント
   ============================================================ */

function doGet(e) {
  try {
    const action = e.parameter.action;
    switch (action) {
      case 'getRecords':
        return jsonResponse({ success: true, data: getRecords(e.parameter.date) });
      case 'getStats':
        return jsonResponse({ success: true, data: getStats(e.parameter.from, e.parameter.to) });
      default:
        return jsonResponse({ success: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('doGet error:', err.message);
    return jsonResponse({ success: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    switch (action) {
      case 'saveRecord':
        return jsonResponse({ success: true, data: saveRecord(body) });
      case 'deleteRecord':
        return jsonResponse({ success: true, data: deleteRecord(body.id) });
      default:
        return jsonResponse({ success: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('doPost error:', err.message);
    return jsonResponse({ success: false, error: err.message });
  }
}

/* ============================================================
   ヘルパー
   ============================================================ */

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const ss    = SpreadsheetApp.openById(getProp('SPREADSHEET_ID'));
  let sheet   = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ['ID', 'Date', 'Category', 'Type', 'Start', 'End',
                     'DurationMin', 'Amount', 'Memo', 'CreatedAt', 'UpdatedAt'];
    sheet.appendRow(headers);

    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#FFE8EA');
    headerRange.setFontColor('#4A4A4A');

    sheet.getRange(2, COL.DATE  + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@STRING@');
    sheet.getRange(2, COL.START + 1, sheet.getMaxRows() - 1, 2).setNumberFormat('@STRING@');
  }

  return sheet;
}

function getAllRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, COL.COUNT).getValues();
}

function cellToStr(val) {
  if (val instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(val, tz, "yyyy-MM-dd'T'HH:mm");
  }
  if (val === null || val === undefined) return '';
  return String(val);
}

function rowToRecord(row) {
  const dur = row[COL.DURATION];
  const amt = row[COL.AMOUNT];
  return {
    id:          cellToStr(row[COL.ID]),
    date:        cellToStr(row[COL.DATE]).substring(0, 10),
    category:    cellToStr(row[COL.CATEGORY]),
    type:        cellToStr(row[COL.TYPE]),
    start:       cellToStr(row[COL.START]),
    end:         cellToStr(row[COL.END]),
    durationMin: (dur !== '' && dur !== null && !isNaN(Number(dur))) ? Number(dur) : null,
    amount:      (amt !== '' && amt !== null && !isNaN(Number(amt))) ? Number(amt) : null,
    memo:        cellToStr(row[COL.MEMO]),
    createdAt:   cellToStr(row[COL.CREATED_AT]),
    updatedAt:   cellToStr(row[COL.UPDATED_AT]),
  };
}

/* ============================================================
   CRUD
   ============================================================ */

function getRecords(date) {
  if (!date) throw new Error('date パラメータが必要です');
  const sheet = getSheet();
  const rows  = getAllRows(sheet);
  return rows
    .filter(function(row) {
      return cellToStr(row[COL.ID]) !== '' &&
             cellToStr(row[COL.DATE]).substring(0, 10) === date;
    })
    .map(rowToRecord);
}

function saveRecord(data) {
  if (!data.id)       throw new Error('id が必要です');
  if (!data.date)     throw new Error('date が必要です');
  if (!data.category) throw new Error('category が必要です');

  const sheet = getSheet();
  const rows  = getAllRows(sheet);
  const now   = new Date().toISOString();

  let durationMin = data.durationMin != null ? data.durationMin : '';
  if (durationMin === '' && data.start && data.end) {
    const diffMs = new Date(data.end) - new Date(data.start);
    if (diffMs > 0) durationMin = Math.round(diffMs / 60000);
  }

  const rowData = [
    data.id,
    data.date,
    data.category,
    data.type    || '',
    data.start   || '',
    data.end     || '',
    durationMin !== null && durationMin !== undefined ? durationMin : '',
    data.amount  != null ? data.amount : '',
    data.memo    || '',
    '',
    now,
  ];

  const existingIdx = rows.findIndex(function(row) {
    return cellToStr(row[COL.ID]) === data.id;
  });

  if (existingIdx >= 0) {
    rowData[COL.CREATED_AT] = cellToStr(rows[existingIdx][COL.CREATED_AT]) || now;
    sheet.getRange(existingIdx + 2, 1, 1, COL.COUNT).setValues([rowData]);
  } else {
    rowData[COL.CREATED_AT] = now;
    sheet.appendRow(rowData);
  }

  return { id: data.id };
}

function deleteRecord(id) {
  if (!id) throw new Error('id が必要です');
  const sheet = getSheet();
  const rows  = getAllRows(sheet);
  const idx   = rows.findIndex(function(row) {
    return cellToStr(row[COL.ID]) === id;
  });
  if (idx < 0) throw new Error('レコードが見つかりません: ' + id);
  sheet.deleteRow(idx + 2);
  return { deleted: true };
}

/* ============================================================
   統計
   ============================================================ */

function getStats(fromDate, toDate) {
  if (!fromDate || !toDate) throw new Error('from と to パラメータが必要です');
  if (fromDate > toDate)    throw new Error('from は to 以前の日付にしてください');

  const sheet   = getSheet();
  const rows    = getAllRows(sheet);
  const records = rows
    .filter(function(row) {
      if (!cellToStr(row[COL.ID])) return false;
      const date = cellToStr(row[COL.DATE]).substring(0, 10);
      return date >= fromDate && date <= toDate;
    })
    .map(rowToRecord);

  const feeding   = records.filter(function(r) { return r.category === 'feeding'; });
  const excretion = records.filter(function(r) { return r.category === 'excretion'; });

  const numDays = Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1;

  const milkFeedings  = feeding.filter(function(r) { return r.type === 'ミルク' && r.amount != null; });
  const timedFeedings = feeding.filter(function(r) { return r.durationMin != null; });
  const totalMilk     = milkFeedings.reduce(function(s, r) { return s + r.amount; }, 0);
  const totalDuration = timedFeedings.reduce(function(s, r) { return s + r.durationMin; }, 0);
  const durations     = timedFeedings.map(function(r) { return r.durationMin; });

  const feedingStats = {
    totalCount:  feeding.length,
    avgPerDay:   numDays > 0 ? round1(feeding.length / numDays) : 0,
    totalMilk:   totalMilk,
    avgMilk:     milkFeedings.length  > 0 ? Math.round(totalMilk / milkFeedings.length) : 0,
    avgDuration: timedFeedings.length > 0 ? Math.round(totalDuration / timedFeedings.length) : 0,
    maxDuration: durations.length > 0 ? Math.max.apply(null, durations) : 0,
    minDuration: durations.length > 0 ? Math.min.apply(null, durations) : 0,
  };

  const excretionStats = {
    urineCount: excretion.filter(function(r) { return r.type === 'おしっこ'; }).length,
    stoolCount: excretion.filter(function(r) { return r.type === 'うんち'; }).length,
    bothCount:  excretion.filter(function(r) { return r.type === '両方'; }).length,
    avgPerDay:  numDays > 0 ? round1(excretion.length / numDays) : 0,
  };

  const dates           = [];
  const feedingCounts   = [];
  const milkAmounts     = [];
  const excretionCounts = [];

  const cursor = new Date(fromDate + 'T00:00:00');
  const endDt  = new Date(toDate   + 'T00:00:00');

  while (cursor <= endDt) {
    const dateStr = Utilities.formatDate(cursor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    dates.push(dateStr);

    const dayFeeding   = feeding.filter(function(r) { return r.date === dateStr; });
    const dayExcretion = excretion.filter(function(r) { return r.date === dateStr; });

    feedingCounts.push(dayFeeding.length);
    milkAmounts.push(
      dayFeeding
        .filter(function(r) { return r.type === 'ミルク' && r.amount != null; })
        .reduce(function(s, r) { return s + r.amount; }, 0)
    );
    excretionCounts.push(dayExcretion.length);
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    feeding:   feedingStats,
    excretion: excretionStats,
    daily: { dates: dates, feedingCounts: feedingCounts, milkAmounts: milkAmounts, excretionCounts: excretionCounts },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
