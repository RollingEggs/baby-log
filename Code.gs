/**
 * 双子育児記録アプリ バックエンド (Google Apps Script)
 *
 * セットアップ手順:
 *   1. Google スプレッドシートを開く
 *   2. メニュー「拡張機能」→「Apps Script」でこのファイルの内容を貼り付けて保存
 *   3. 「プロジェクトの設定」→「Chrome V8 ランタイムを有効にする」にチェック
 *   4. 「デプロイ」→「新しいデプロイ」→ 種類: ウェブアプリ
 *      - 次のユーザーとして実行: 自分
 *      - アクセスできるユーザー: 全員
 *   5. デプロイ後の URL をアプリの起動画面に貼り付ける
 *
 * ※ スプレッドシートの「拡張機能」から作成するコンテナバインド型スクリプトのため
 *    SPREADSHEET_ID の設定は不要です。
 */

const SHEET_NAME = 'records';

const COL = {
  ID:         0,
  DATE:       1,
  CHILD:      2,
  CATEGORY:   3,
  TYPE:       4,
  TIME:       5,
  LEFT_MIN:   6,
  RIGHT_MIN:  7,
  AMOUNT:     8,
  MEMO:       9,
  CREATED_AT: 10,
  UPDATED_AT: 11,
  COUNT:      12,
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
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ['ID', 'Date', 'Child', 'Category', 'Type', 'Time',
                     'LeftMin', 'RightMin', 'Amount', 'Memo', 'CreatedAt', 'UpdatedAt'];
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#FFE8EA');
    headerRange.setFontColor('#4A4A4A');
    sheet.getRange(2, COL.DATE + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@STRING@');
    sheet.getRange(2, COL.TIME + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@STRING@');
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
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
  }
  if (val === null || val === undefined) return '';
  return String(val);
}

function rowToRecord(row) {
  const leftMin  = row[COL.LEFT_MIN];
  const rightMin = row[COL.RIGHT_MIN];
  const amount   = row[COL.AMOUNT];
  return {
    id:       cellToStr(row[COL.ID]),
    date:     cellToStr(row[COL.DATE]).substring(0, 10),
    child:    Number(row[COL.CHILD]) || 1,
    category: cellToStr(row[COL.CATEGORY]),
    type:     cellToStr(row[COL.TYPE]),
    time:     cellToStr(row[COL.TIME]),
    leftMin:  (leftMin  !== '' && leftMin  !== null && !isNaN(Number(leftMin)))  ? Number(leftMin)  : null,
    rightMin: (rightMin !== '' && rightMin !== null && !isNaN(Number(rightMin))) ? Number(rightMin) : null,
    amount:   (amount   !== '' && amount   !== null && !isNaN(Number(amount)))   ? Number(amount)   : null,
    memo:     cellToStr(row[COL.MEMO]),
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

  const rowData = [
    data.id,
    data.date,
    data.child    != null ? data.child    : 1,
    data.category,
    data.type     || '',
    data.time     || '',
    data.leftMin  != null ? data.leftMin  : '',
    data.rightMin != null ? data.rightMin : '',
    data.amount   != null ? data.amount   : '',
    data.memo     || '',
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

  const numDays = Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1;

  function calcChildStats(child) {
    const feeding   = records.filter(function(r) { return r.child === child && r.category === 'feeding'; });
    const excretion = records.filter(function(r) { return r.child === child && r.category === 'excretion'; });

    const milkFeedings = feeding.filter(function(r) { return r.type === 'ミルク' && r.amount != null; });
    const totalMilk    = milkFeedings.reduce(function(s, r) { return s + r.amount; }, 0);
    const totalLeft    = feeding.reduce(function(s, r) { return s + (r.leftMin  || 0); }, 0);
    const totalRight   = feeding.reduce(function(s, r) { return s + (r.rightMin || 0); }, 0);

    return {
      feeding: {
        totalCount:    feeding.length,
        avgPerDay:     numDays > 0 ? round1(feeding.length / numDays) : 0,
        totalMilk:     totalMilk,
        avgMilk:       milkFeedings.length > 0 ? Math.round(totalMilk / milkFeedings.length) : 0,
        totalLeftMin:  totalLeft,
        totalRightMin: totalRight,
      },
      excretion: {
        urineCount: excretion.filter(function(r) { return r.type === 'おしっこ'; }).length,
        stoolCount: excretion.filter(function(r) { return r.type === 'うんち'; }).length,
        bothCount:  excretion.filter(function(r) { return r.type === '両方'; }).length,
        avgPerDay:  numDays > 0 ? round1(excretion.length / numDays) : 0,
      },
    };
  }

  const dates             = [];
  const c1FeedingCounts   = [];
  const c2FeedingCounts   = [];
  const c1ExcretionCounts = [];
  const c2ExcretionCounts = [];

  const cursor = new Date(fromDate + 'T00:00:00');
  const endDt  = new Date(toDate   + 'T00:00:00');

  while (cursor <= endDt) {
    const dateStr = Utilities.formatDate(cursor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    dates.push(dateStr);
    c1FeedingCounts.push(records.filter(function(r) {
      return r.date === dateStr && r.child === 1 && r.category === 'feeding';
    }).length);
    c2FeedingCounts.push(records.filter(function(r) {
      return r.date === dateStr && r.child === 2 && r.category === 'feeding';
    }).length);
    c1ExcretionCounts.push(records.filter(function(r) {
      return r.date === dateStr && r.child === 1 && r.category === 'excretion';
    }).length);
    c2ExcretionCounts.push(records.filter(function(r) {
      return r.date === dateStr && r.child === 2 && r.category === 'excretion';
    }).length);
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    child1: calcChildStats(1),
    child2: calcChildStats(2),
    daily: {
      dates:            dates,
      c1FeedingCounts:   c1FeedingCounts,
      c2FeedingCounts:   c2FeedingCounts,
      c1ExcretionCounts: c1ExcretionCounts,
      c2ExcretionCounts: c2ExcretionCounts,
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
