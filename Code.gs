/**
 * 育児記録アプリ バックエンド (Google Apps Script)
 *
 * セットアップ手順:
 *   1. Google スプレッドシートを新規作成し、シート名を "records" に変更
 *   2. GASエディタ上部「プロジェクトの設定」→「スクリプトプロパティ」に以下を追加:
 *        SPREADSHEET_ID  ← スプレッドシートのID
 *        SECRET_TOKEN    ← 任意の文字列（app.js と同じ値）
 *   3. 「プロジェクトの設定」→「Chrome V8 ランタイムを有効にする」にチェック
 *   4. 「デプロイ」→「新しいデプロイ」→ 種類: ウェブアプリ
 *      - 次のユーザーとして実行: 自分
 *      - アクセスできるユーザー: 全員
 *   5. デプロイ後のウェブアプリ URL を app.js の GAS_URL に設定する
 */

/* ============================================================
   設定はスクリプトプロパティから読み込む (コードに書かない)
   GASエディタ → プロジェクトの設定 → スクリプトプロパティ で設定すること
   ============================================================ */

/**
 * スクリプトプロパティを取得するヘルパー
 * 未設定の場合はデプロイ前に気づけるよう例外を投げる
 */
function getProp(key) {
  const val = PropertiesService.getScriptProperties().getProperty(key);
  if (!val) throw new Error(`スクリプトプロパティ "${key}" が設定されていません`);
  return val;
}

/** レコードシート名 */
const SHEET_NAME = 'records';

/* ============================================================
   スプレッドシート列インデックス (0始まり)
   A:ID  B:Date  C:Category  D:Type  E:Start  F:End
   G:DurationMin  H:Amount  I:Memo  J:CreatedAt  K:UpdatedAt
   ============================================================ */
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
  COUNT: 11,  // 列数
};

/* ============================================================
   エントリポイント
   ============================================================ */

/**
 * GET リクエストハンドラ
 * action=getRecords  ?date=YYYY-MM-DD
 * action=getStats    ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
function doGet(e) {
  try {
    const token = e.parameter.token;
    if (!validateToken(token)) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }

    const action = e.parameter.action;

    switch (action) {
      case 'getRecords':
        return jsonResponse({ success: true, data: getRecords(e.parameter.date) });
      case 'getStats':
        return jsonResponse({ success: true, data: getStats(e.parameter.from, e.parameter.to) });
      default:
        return jsonResponse({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('doGet error:', err.message, err.stack);
    return jsonResponse({ success: false, error: err.message });
  }
}

/**
 * POST リクエストハンドラ
 * Body (text/plain, JSON stringified):
 *   action=saveRecord   : レコード保存
 *   action=deleteRecord : レコード削除
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (!validateToken(body.token)) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }

    const action = body.action;

    switch (action) {
      case 'saveRecord':
        return jsonResponse({ success: true, data: saveRecord(body) });
      case 'deleteRecord':
        return jsonResponse({ success: true, data: deleteRecord(body.id) });
      default:
        return jsonResponse({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('doPost error:', err.message, err.stack);
    return jsonResponse({ success: false, error: err.message });
  }
}

/* ============================================================
   ヘルパー
   ============================================================ */

function validateToken(token) {
  return token === getProp('SECRET_TOKEN');
}

/** JSON レスポンスを返す */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * シートを取得する。存在しない場合は作成してヘッダ行を追加する。
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet() {
  const ss = SpreadsheetApp.openById(getProp('SPREADSHEET_ID'));
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ['ID', 'Date', 'Category', 'Type', 'Start', 'End',
                     'DurationMin', 'Amount', 'Memo', 'CreatedAt', 'UpdatedAt'];
    sheet.appendRow(headers);

    // ヘッダー行をスタイリング
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#FFE8EA');
    headerRange.setFontColor('#4A4A4A');

    // 日付列・日時列をテキスト形式に固定して自動変換を防ぐ
    sheet.getRange(2, COL.DATE + 1, sheet.getMaxRows() - 1, 1)
         .setNumberFormat('@STRING@');
    sheet.getRange(2, COL.START + 1, sheet.getMaxRows() - 1, 2)
         .setNumberFormat('@STRING@');
  }

  return sheet;
}

/**
 * データ行をすべて取得する (ヘッダ行を除く)
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {any[][]}
 */
function getAllRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];   // ヘッダのみ、またはシートが空
  return sheet.getRange(2, 1, lastRow - 1, COL.COUNT).getValues();
}

/**
 * スプレッドシートのセル値を文字列に変換する。
 * GAS はセルの書式によって Date オブジェクトを返すことがあるため正規化する。
 * @param {any} val
 * @returns {string}
 */
function cellToStr(val) {
  if (val instanceof Date) {
    // ローカルタイムゾーンで "YYYY-MM-DDTHH:mm" に変換
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(val, tz, "yyyy-MM-dd'T'HH:mm");
  }
  if (val === null || val === undefined) return '';
  return String(val);
}

/**
 * 行配列をレコードオブジェクトに変換する
 * @param {any[]} row
 * @returns {Object}
 */
function rowToRecord(row) {
  const dur = row[COL.DURATION];
  const amt = row[COL.AMOUNT];

  return {
    id:          cellToStr(row[COL.ID]),
    date:        cellToStr(row[COL.DATE]).substring(0, 10),  // YYYY-MM-DD に正規化
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
   CRUD 操作
   ============================================================ */

/**
 * 指定日付のレコードを取得する
 * @param {string} date  YYYY-MM-DD
 * @returns {Object[]}
 */
function getRecords(date) {
  if (!date) throw new Error('date パラメータが必要です');

  const sheet = getSheet();
  const rows  = getAllRows(sheet);

  return rows
    .filter((row) => {
      const id  = cellToStr(row[COL.ID]);
      const d   = cellToStr(row[COL.DATE]).substring(0, 10);
      return id !== '' && d === date;
    })
    .map(rowToRecord);
}

/**
 * レコードを保存する (ID が存在すれば更新、なければ追加)
 * @param {Object} data  フロントエンドから受け取ったデータ
 * @returns {{id: string}}
 */
function saveRecord(data) {
  if (!data.id)       throw new Error('id が必要です');
  if (!data.date)     throw new Error('date が必要です');
  if (!data.category) throw new Error('category が必要です');

  const sheet = getSheet();
  const rows  = getAllRows(sheet);
  const now   = new Date().toISOString();

  // 所要時間の計算 (フロント計算値を優先し、なければここで算出)
  let durationMin = data.durationMin != null ? data.durationMin : '';
  if (durationMin === '' && data.start && data.end) {
    const diffMs = new Date(data.end) - new Date(data.start);
    if (diffMs > 0) durationMin = Math.round(diffMs / 60000);
  }

  const rowData = [
    data.id,
    data.date,
    data.category,
    data.type        || '',
    data.start       || '',
    data.end         || '',
    durationMin !== null && durationMin !== undefined ? durationMin : '',
    data.amount != null ? data.amount : '',
    data.memo        || '',
    '',   // CreatedAt (既存レコードの場合は後で置換)
    now,  // UpdatedAt
  ];

  // 既存レコードを検索
  const existingIdx = rows.findIndex((row) => cellToStr(row[COL.ID]) === data.id);

  if (existingIdx >= 0) {
    // 更新: CreatedAt は元の値を維持
    rowData[COL.CREATED_AT] = cellToStr(rows[existingIdx][COL.CREATED_AT]) || now;
    // スプレッドシートの行番号は 1 始まりで、ヘッダが1行目なのでデータは existingIdx+2
    sheet.getRange(existingIdx + 2, 1, 1, COL.COUNT).setValues([rowData]);
  } else {
    // 新規追加
    rowData[COL.CREATED_AT] = now;
    sheet.appendRow(rowData);
  }

  return { id: data.id };
}

/**
 * レコードを削除する
 * @param {string} id
 * @returns {{deleted: boolean}}
 */
function deleteRecord(id) {
  if (!id) throw new Error('id が必要です');

  const sheet = getSheet();
  const rows  = getAllRows(sheet);

  const idx = rows.findIndex((row) => cellToStr(row[COL.ID]) === id);
  if (idx < 0) throw new Error(`レコードが見つかりません: ${id}`);

  sheet.deleteRow(idx + 2);  // ヘッダ行 (+1) と 0始まり (+1) で +2
  return { deleted: true };
}

/* ============================================================
   統計集計
   ============================================================ */

/**
 * 指定期間の統計を計算して返す
 * @param {string} fromDate  YYYY-MM-DD
 * @param {string} toDate    YYYY-MM-DD
 * @returns {Object}
 */
function getStats(fromDate, toDate) {
  if (!fromDate || !toDate) throw new Error('from と to パラメータが必要です');
  if (fromDate > toDate)    throw new Error('from は to 以前の日付にしてください');

  const sheet = getSheet();
  const rows  = getAllRows(sheet);

  // 期間内のレコードを抽出
  const records = rows
    .filter((row) => {
      const id = cellToStr(row[COL.ID]);
      if (!id) return false;
      const date = cellToStr(row[COL.DATE]).substring(0, 10);
      return date >= fromDate && date <= toDate;
    })
    .map(rowToRecord);

  const feeding   = records.filter((r) => r.category === 'feeding');
  const excretion = records.filter((r) => r.category === 'excretion');

  // 日数
  const msPerDay = 86400000;
  const numDays = Math.round((new Date(toDate) - new Date(fromDate)) / msPerDay) + 1;

  /* ---- 授乳統計 ---- */
  const milkFeedings      = feeding.filter((r) => r.type === 'ミルク' && r.amount != null);
  const timedFeedings     = feeding.filter((r) => r.durationMin != null);
  const totalMilk         = milkFeedings.reduce((s, r) => s + r.amount, 0);
  const totalDuration     = timedFeedings.reduce((s, r) => s + r.durationMin, 0);
  const durations         = timedFeedings.map((r) => r.durationMin);

  const feedingStats = {
    totalCount:  feeding.length,
    avgPerDay:   numDays > 0 ? round1(feeding.length / numDays) : 0,
    totalMilk:   totalMilk,
    avgMilk:     milkFeedings.length > 0 ? Math.round(totalMilk / milkFeedings.length) : 0,
    avgDuration: timedFeedings.length > 0 ? Math.round(totalDuration / timedFeedings.length) : 0,
    maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
    minDuration: durations.length > 0 ? Math.min(...durations) : 0,
  };

  /* ---- 排泄統計 ---- */
  const excretionStats = {
    urineCount: excretion.filter((r) => r.type === 'おしっこ').length,
    stoolCount: excretion.filter((r) => r.type === 'うんち').length,
    bothCount:  excretion.filter((r) => r.type === '両方').length,
    avgPerDay:  numDays > 0 ? round1(excretion.length / numDays) : 0,
  };

  /* ---- 日別データ (グラフ用) ---- */
  const dates            = [];
  const feedingCounts    = [];
  const milkAmounts      = [];
  const excretionCounts  = [];

  // from 〜 to の全日付をループ (データがない日は 0)
  const cursor = new Date(fromDate + 'T00:00:00');
  const endDt  = new Date(toDate  + 'T00:00:00');

  while (cursor <= endDt) {
    const dateStr = Utilities.formatDate(cursor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    dates.push(dateStr);

    const dayFeeding   = feeding.filter((r) => r.date === dateStr);
    const dayExcretion = excretion.filter((r) => r.date === dateStr);

    feedingCounts.push(dayFeeding.length);
    milkAmounts.push(
      dayFeeding
        .filter((r) => r.type === 'ミルク' && r.amount != null)
        .reduce((s, r) => s + r.amount, 0)
    );
    excretionCounts.push(dayExcretion.length);

    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    feeding:   feedingStats,
    excretion: excretionStats,
    daily: {
      dates,
      feedingCounts,
      milkAmounts,
      excretionCounts,
    },
  };
}

/**
 * 小数第1位で四捨五入する
 */
function round1(n) {
  return Math.round(n * 10) / 10;
}
