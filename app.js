/**
 * 育児記録アプリ フロントエンド
 * GitHub Pages + Google Apps Script バックエンド
 *
 * GAS URL と認証トークンはコードに書かず、
 * ブラウザの localStorage に保存します。
 * 初回アクセス時に設定画面が開くので、そこで入力してください。
 */

'use strict';

/* ============================================================
   設定: localStorage から読み書きする
   ============================================================ */

const LS_KEY_GAS_URL = 'baby_gas_url';

function loadConfig() {
  return { gasUrl: localStorage.getItem(LS_KEY_GAS_URL) || '' };
}

function saveConfig(gasUrl) {
  localStorage.setItem(LS_KEY_GAS_URL, gasUrl.trim());
}

function isConfigured() {
  const { gasUrl } = loadConfig();
  return gasUrl.startsWith('https://');
}

/* ============================================================
   アプリ状態
   ============================================================ */

const state = {
  /** 表示中の日付 (YYYY-MM-DD) */
  currentDate: getTodayString(),
  /** Chart.js インスタンスキャッシュ */
  charts: {},
  /** 統計の現在選択期間 ('7' | '30' | 'month' | 'custom') */
  currentPeriod: '7',
};

/* ============================================================
   ユーティリティ
   ============================================================ */

/**
 * UUID v4 を生成する
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 今日の日付を YYYY-MM-DD 形式で返す
 */
function getTodayString() {
  const d = new Date();
  return localDateString(d);
}

/**
 * Date オブジェクトをローカル時刻の YYYY-MM-DD に変換
 */
function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Date オブジェクトを datetime-local 形式 (YYYY-MM-DDTHH:mm:ss) に変換
 */
function toDatetimeLocal(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h  = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const se = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${mi}:${se}`;
}

/**
 * 指定日付 + 現在時刻を datetime-local 形式で返す
 * 過去日を記録する際に使用する
 */
function defaultDatetimeForDate(dateStr) {
  const now = new Date();
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
  return toDatetimeLocal(dt);
}

/**
 * 秒数を "X分Y秒" 形式でフォーマット
 */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return '--';
  const total = Math.round(seconds);
  if (total < 60) return `${total}秒`;
  const h   = Math.floor(total / 3600);
  const m   = Math.floor((total % 3600) / 60);
  const s   = total % 60;
  if (h > 0) return s > 0 ? `${h}時間${m}分${s}秒` : `${h}時間${m}分`;
  return s > 0 ? `${m}分${s}秒` : `${m}分`;
}

/**
 * デバウンス: 最後の呼び出しから delay ms 後に fn を実行
 */
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/* ============================================================
   保存ステータス表示
   ============================================================ */

let _statusTimer = null;

/**
 * @param {'saving'|'saved'|'error'} type
 * @param {string} message
 */
function showSaveStatus(type, message) {
  const el = document.getElementById('save-status');
  el.className = `save-status ${type}`;
  el.textContent = message;

  clearTimeout(_statusTimer);
  if (type === 'saved' || type === 'error') {
    _statusTimer = setTimeout(() => {
      el.className = 'save-status';
      el.textContent = '';
    }, 3000);
  }
}

/* ============================================================
   ローディング / エラー表示
   ============================================================ */

function setLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

function setStatsLoading(show) {
  document.getElementById('stats-loading').classList.toggle('hidden', !show);
}

/** エラーメッセージを一定時間表示する */
function showError(message) {
  const el = document.getElementById('error-msg');
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
}

/* ============================================================
   API 通信
   ============================================================ */

/**
 * GAS GET リクエスト
 * @param {string} action
 * @param {Object} params  URLパラメータ
 * @returns {Promise<any>}
 */
async function apiGet(action, params = {}) {
  const { gasUrl } = loadConfig();
  const url = new URL(gasUrl);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'APIエラー');
  return json.data;
}

/**
 * GAS POST リクエスト
 * Content-Type: text/plain を使用してプリフライトを回避する。
 * GAS 側で e.postData.contents を JSON.parse する。
 *
 * @param {string} action
 * @param {Object} body
 * @returns {Promise<any>}
 */
async function apiPost(action, body = {}) {
  const { gasUrl } = loadConfig();
  const payload = JSON.stringify({ ...body, action });

  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: payload,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'APIエラー');
  return json.data;
}

/** 指定日付のレコードを取得 */
async function apiFetchRecords(date) {
  return apiGet('getRecords', { date });
}

/** レコードを保存(新規 or 更新) */
async function apiSaveRecord(record) {
  return apiPost('saveRecord', record);
}

/** レコードを削除 */
async function apiDeleteRecord(id) {
  return apiPost('deleteRecord', { id });
}

/** 統計を取得 */
async function apiFetchStats(from, to) {
  return apiGet('getStats', { from, to });
}

/* ============================================================
   日付ナビゲーション
   ============================================================ */

function initDateNav() {
  renderDateNav();
  document.getElementById('today-btn').addEventListener('click', () => {
    state.currentDate = getTodayString();
    renderDateNav();
    loadRecords(state.currentDate);
  });
}

/**
 * 前後 14 日 (計 29 日分) の日付ボタンを描画する
 */
function renderDateNav() {
  const container = document.getElementById('date-nav-scroll');
  container.innerHTML = '';

  const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
  const today = new Date();

  for (let offset = -14; offset <= 14; offset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    const dateStr = localDateString(d);

    const btn = document.createElement('button');
    btn.className = 'date-item';
    btn.dataset.date = dateStr;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', dateStr === state.currentDate ? 'true' : 'false');
    btn.setAttribute('aria-label', `${d.getMonth() + 1}月${d.getDate()}日`);

    btn.innerHTML = `
      <span class="date-weekday">${DAYS_JA[d.getDay()]}</span>
      <span class="date-num">${d.getDate()}</span>
    `;

    if (dateStr === state.currentDate) btn.classList.add('active');
    if (dateStr === getTodayString())  btn.classList.add('today');

    btn.addEventListener('click', () => selectDate(dateStr));
    container.appendChild(btn);
  }

  // 選択中の日付を中央にスクロール
  const activeEl = container.querySelector('.date-item.active');
  if (activeEl) {
    // requestAnimationFrame で DOM 反映後にスクロール
    requestAnimationFrame(() => {
      activeEl.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    });
  }
}

/**
 * 日付を選択して記録を再描画する
 */
async function selectDate(dateStr) {
  state.currentDate = dateStr;

  // ボタンの active 状態を更新
  document.querySelectorAll('.date-item').forEach((btn) => {
    const isActive = btn.dataset.date === dateStr;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  await loadRecords(dateStr);
}

/* ============================================================
   記録タブ: 読み込みと描画
   ============================================================ */

async function loadRecords(date) {
  setLoading(true);
  document.getElementById('error-msg').classList.add('hidden');

  try {
    const records = await apiFetchRecords(date);
    renderRecords(records);
  } catch (err) {
    console.error('loadRecords:', err);
    showError(`記録の読み込みに失敗しました。\n${err.message}`);
    // エラー時でも空カードを表示して入力できるようにする
    renderRecords([]);
  } finally {
    setLoading(false);
  }
}

/**
 * 取得したレコード配列をカードとして描画する
 * @param {Array} records
 */
function renderRecords(records) {
  const feedingRecords   = records.filter((r) => r.category === 'feeding');
  const excretionRecords = records.filter((r) => r.category === 'excretion');

  // 授乳カード
  const feedingCont = document.getElementById('feeding-cards');
  feedingCont.innerHTML = '';
  if (feedingRecords.length === 0) {
    addFeedingCard(feedingCont, null);        // データ0件時は空カード1件
  } else {
    feedingRecords.forEach((r) => addFeedingCard(feedingCont, r));
  }

  // 排泄カード
  const excretionCont = document.getElementById('excretion-cards');
  excretionCont.innerHTML = '';
  if (excretionRecords.length === 0) {
    addExcretionCard(excretionCont, null);
  } else {
    excretionRecords.forEach((r) => addExcretionCard(excretionCont, r));
  }
}

/* ============================================================
   授乳カード
   ============================================================ */

/**
 * 授乳カードを生成してコンテナに追加する
 * @param {HTMLElement} container
 * @param {Object|null}  data  null の場合は新規空カード
 * @returns {HTMLElement} 生成したカード要素
 */
function addFeedingCard(container, data) {
  const tpl  = document.getElementById('feeding-card-template');
  const card = tpl.content.cloneNode(true).querySelector('.feeding-card');

  // ID 設定 (既存レコードならそのID、新規なら UUID 生成)
  const id = data?.id || generateUUID();
  card.querySelector('.record-id').value = id;
  card.dataset.id = id;

  // フィールド値の設定
  if (data) {
    card.querySelector('.feeding-type').value   = data.type   || '母乳';
    card.querySelector('.feeding-start').value  = data.start  || '';
    card.querySelector('.feeding-end').value    = data.end    || '';
    card.querySelector('.feeding-amount').value = data.amount != null ? data.amount : '';
    card.querySelector('.feeding-memo').value   = data.memo   || '';
    updateFeedingDuration(card);
  } else {
    // 新規: 選択日の現在時刻をデフォルト開始時刻にする
    card.querySelector('.feeding-start').value = defaultDatetimeForDate(state.currentDate);
  }

  // ミルク量欄の表示制御
  syncMilkAmountVisibility(card);

  // イベント設定
  attachFeedingCardEvents(card);

  container.appendChild(card);
  return card;
}

/**
 * 授乳カードのイベントリスナーを設定する
 */
function attachFeedingCardEvents(card) {
  // デバウンス付き保存関数
  const debouncedSave = debounce(() => executeSave(card), 500);

  // 種類変更 → ミルク量欄の表示切替 + 保存
  card.querySelector('.feeding-type').addEventListener('change', () => {
    syncMilkAmountVisibility(card);
    showSaveStatus('saving', '保存中...');
    debouncedSave();
  });

  // 開始・終了時刻変更 → 所要時間再計算 + 保存
  card.querySelector('.feeding-start').addEventListener('change', () => {
    updateFeedingDuration(card);
    showSaveStatus('saving', '保存中...');
    debouncedSave();
  });
  card.querySelector('.feeding-end').addEventListener('change', () => {
    updateFeedingDuration(card);
    showSaveStatus('saving', '保存中...');
    debouncedSave();
  });

  // ミルク量・メモ変更 → 保存
  card.querySelector('.feeding-amount').addEventListener('input', () => {
    showSaveStatus('saving', '保存中...');
    debouncedSave();
  });
  card.querySelector('.feeding-memo').addEventListener('input', () => {
    showSaveStatus('saving', '保存中...');
    debouncedSave();
  });

  // NOW ボタン (即時保存)
  card.querySelector('.start-now-btn').addEventListener('click', () => {
    card.querySelector('.feeding-start').value = toDatetimeLocal(new Date());
    updateFeedingDuration(card);
    executeSave(card);
  });
  card.querySelector('.end-now-btn').addEventListener('click', () => {
    card.querySelector('.feeding-end').value = toDatetimeLocal(new Date());
    updateFeedingDuration(card);
    executeSave(card);
  });

  // 編集ボタン → カードをスクロールしてフォーカス
  card.querySelector('.edit-btn').addEventListener('click', () => {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.querySelector('.feeding-type').focus();
  });

  // 削除ボタン
  card.querySelector('.delete-btn').addEventListener('click', () => {
    handleDeleteCard(card, '授乳');
  });
}

/**
 * 所要時間を計算して表示更新する
 */
function updateFeedingDuration(card) {
  const startVal = card.querySelector('.feeding-start').value;
  const endVal   = card.querySelector('.feeding-end').value;
  let durationSec = null;

  if (startVal && endVal) {
    const diffMs = new Date(endVal) - new Date(startVal);
    if (diffMs > 0) durationSec = Math.round(diffMs / 1000);
  }

  card.querySelector('.duration-display').textContent = formatDuration(durationSec);
}

/**
 * 授乳種類に応じてミルク量欄の表示/非表示を切り替える
 */
function syncMilkAmountVisibility(card) {
  // 授乳種別に関わらず常に表示
  card.querySelector('.milk-amount-row').style.display = '';
}

/**
 * 授乳カードからデータオブジェクトを収集する
 */
function collectFeedingData(card) {
  const startVal = card.querySelector('.feeding-start').value;
  const endVal   = card.querySelector('.feeding-end').value;

  // durationMin は秒精度で小数保持 (例: 5分30秒 → 5.5)
  let durationMin = null;
  if (startVal && endVal) {
    const diffMs = new Date(endVal) - new Date(startVal);
    if (diffMs > 0) durationMin = diffMs / 60000;
  }

  const amountRaw = card.querySelector('.feeding-amount').value;

  return {
    id:          card.dataset.id,
    date:        state.currentDate,
    category:    'feeding',
    type:        card.querySelector('.feeding-type').value,
    start:       startVal,
    end:         endVal,
    durationMin: durationMin,
    amount:      amountRaw !== '' ? Number(amountRaw) : null,
    memo:        card.querySelector('.feeding-memo').value,
  };
}

/* ============================================================
   排泄カード
   ============================================================ */

/**
 * 排泄カードを生成してコンテナに追加する
 */
function addExcretionCard(container, data) {
  const tpl  = document.getElementById('excretion-card-template');
  const card = tpl.content.cloneNode(true).querySelector('.excretion-card');

  const id = data?.id || generateUUID();
  card.querySelector('.record-id').value = id;
  card.dataset.id = id;

  if (data) {
    card.querySelector('.excretion-type').value = data.type  || 'おしっこ';
    card.querySelector('.excretion-time').value = data.start || '';
    card.querySelector('.excretion-memo').value = data.memo  || '';
  } else {
    card.querySelector('.excretion-time').value = defaultDatetimeForDate(state.currentDate);
  }

  attachExcretionCardEvents(card);
  container.appendChild(card);
  return card;
}

/**
 * 排泄カードのイベントリスナーを設定する
 */
function attachExcretionCardEvents(card) {
  const debouncedSave = debounce(() => executeSave(card), 500);

  card.querySelector('.excretion-type').addEventListener('change', () => {
    showSaveStatus('saving', '保存中...');
    debouncedSave();
  });
  card.querySelector('.excretion-time').addEventListener('change', () => {
    showSaveStatus('saving', '保存中...');
    debouncedSave();
  });
  card.querySelector('.excretion-memo').addEventListener('input', () => {
    showSaveStatus('saving', '保存中...');
    debouncedSave();
  });

  card.querySelector('.excretion-now-btn').addEventListener('click', () => {
    card.querySelector('.excretion-time').value = toDatetimeLocal(new Date());
    executeSave(card);
  });

  card.querySelector('.edit-btn').addEventListener('click', () => {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.querySelector('.excretion-type').focus();
  });

  card.querySelector('.delete-btn').addEventListener('click', () => {
    handleDeleteCard(card, '排泄');
  });
}

/**
 * 排泄カードからデータオブジェクトを収集する
 */
function collectExcretionData(card) {
  return {
    id:          card.dataset.id,
    date:        state.currentDate,
    category:    'excretion',
    type:        card.querySelector('.excretion-type').value,
    start:       card.querySelector('.excretion-time').value,
    end:         null,
    durationMin: null,
    amount:      null,
    memo:        card.querySelector('.excretion-memo').value,
  };
}

/* ============================================================
   保存処理
   ============================================================ */

/**
 * カードのデータを収集して GAS に保存する
 * NOW ボタンや debounce から呼ばれる
 */
async function executeSave(card) {
  const data = card.classList.contains('feeding-card')
    ? collectFeedingData(card)
    : collectExcretionData(card);

  try {
    showSaveStatus('saving', '保存中...');
    await apiSaveRecord(data);
    showSaveStatus('saved', '✓ 保存しました');
  } catch (err) {
    console.error('executeSave:', err);
    showSaveStatus('error', `保存エラー: ${err.message}`);
  }
}

/* ============================================================
   削除処理
   ============================================================ */

async function handleDeleteCard(card, categoryLabel) {
  if (!confirm(`この${categoryLabel}記録を削除しますか？`)) return;

  const id = card.dataset.id;
  const container = card.parentElement;

  try {
    showSaveStatus('saving', '削除中...');
    await apiDeleteRecord(id);
    card.remove();
    showSaveStatus('saved', '削除しました');

    // 削除でカードが0件になった場合は空カードを補充
    if (container.children.length === 0) {
      if (categoryLabel === '授乳') {
        addFeedingCard(container, null);
      } else {
        addExcretionCard(container, null);
      }
    }
  } catch (err) {
    console.error('handleDeleteCard:', err);
    showSaveStatus('error', `削除エラー: ${err.message}`);
  }
}

/* ============================================================
   追加ボタン
   ============================================================ */

function initAddButtons() {
  document.getElementById('add-feeding-btn').addEventListener('click', () => {
    const cont = document.getElementById('feeding-cards');
    const card = addFeedingCard(cont, null);
    // 追加後はカードにスクロール
    requestAnimationFrame(() =>
      card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    );
  });

  document.getElementById('add-excretion-btn').addEventListener('click', () => {
    const cont = document.getElementById('excretion-cards');
    const card = addExcretionCard(cont, null);
    requestAnimationFrame(() =>
      card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    );
  });
}

/* ============================================================
   統計タブ
   ============================================================ */

function initStatsTab() {
  // 期間ボタンのクリック
  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentPeriod = btn.dataset.period;

      const customDiv = document.getElementById('custom-period');
      if (state.currentPeriod === 'custom') {
        customDiv.classList.remove('hidden');
      } else {
        customDiv.classList.add('hidden');
        loadStats();
      }
    });
  });

  // 任意期間: 表示ボタン
  document.getElementById('stats-search-btn').addEventListener('click', loadStats);
}

/**
 * 現在の期間設定から from / to を計算して返す
 * @returns {{from:string, to:string}|null}
 */
function resolveStatsPeriod() {
  const today = new Date();
  const todayStr = localDateString(today);

  switch (state.currentPeriod) {
    case '7': {
      const from = new Date(today);
      from.setDate(today.getDate() - 6);
      return { from: localDateString(from), to: todayStr };
    }
    case '30': {
      const from = new Date(today);
      from.setDate(today.getDate() - 29);
      return { from: localDateString(from), to: todayStr };
    }
    case 'month': {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: localDateString(from), to: todayStr };
    }
    case 'custom': {
      const from = document.getElementById('stats-from').value;
      const to   = document.getElementById('stats-to').value;
      if (!from || !to) {
        alert('開始日と終了日を入力してください');
        return null;
      }
      if (from > to) {
        alert('開始日は終了日より前に設定してください');
        return null;
      }
      return { from, to };
    }
    default:
      return null;
  }
}

/**
 * 統計を取得して描画する
 */
async function loadStats() {
  const period = resolveStatsPeriod();
  if (!period) return;

  setStatsLoading(true);
  try {
    const stats = await apiFetchStats(period.from, period.to);
    renderStatsNumbers(stats);
    renderCharts(stats);
  } catch (err) {
    console.error('loadStats:', err);
    showError(`統計の取得に失敗しました。\n${err.message}`);
  } finally {
    setStatsLoading(false);
  }
}

/**
 * 統計数値カードを描画する
 */
function renderStatsNumbers(stats) {
  const f = stats.feeding;
  const e = stats.excretion;

  document.getElementById('feeding-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${f.totalCount}</div>
      <div class="stat-label">総授乳回数</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.avgPerDay}</div>
      <div class="stat-label">平均回数/日</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.totalMilk}<small>ml</small></div>
      <div class="stat-label">総ミルク量</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.avgMilk}<small>ml</small></div>
      <div class="stat-label">平均ミルク量/回</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.avgDuration}<small>分</small></div>
      <div class="stat-label">平均授乳時間</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.maxDuration}<small>分</small></div>
      <div class="stat-label">最長授乳時間</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.minDuration}<small>分</small></div>
      <div class="stat-label">最短授乳時間</div>
    </div>
  `;

  document.getElementById('excretion-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${e.urineCount}</div>
      <div class="stat-label">おしっこ回数</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${e.stoolCount}</div>
      <div class="stat-label">うんち回数</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${e.bothCount}</div>
      <div class="stat-label">両方回数</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${e.avgPerDay}</div>
      <div class="stat-label">1日平均排泄回数</div>
    </div>
  `;
}

/**
 * Chart.js グラフを描画する
 */
function renderCharts(stats) {
  const daily = stats.daily;

  // X軸ラベル (M/D 形式)
  const labels = daily.dates.map((d) => {
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  });

  const barDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
  };

  // 日別授乳回数 (棒グラフ)
  drawChart('chart-feeding-count', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: daily.feedingCounts,
        backgroundColor: 'rgba(255, 154, 162, 0.65)',
        borderColor: '#FF9AA2',
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: barDefaults,
  });

  // 日別ミルク量 (折れ線グラフ)
  drawChart('chart-milk-amount', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: daily.milkAmounts,
        borderColor: '#FFDAC1',
        backgroundColor: 'rgba(255, 218, 193, 0.3)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#FFDAC1',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });

  // 日別排泄回数 (棒グラフ)
  drawChart('chart-excretion-count', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: daily.excretionCounts,
        backgroundColor: 'rgba(181, 234, 215, 0.7)',
        borderColor: '#B5EAD7',
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: barDefaults,
  });
}

/**
 * 指定 canvas に Chart.js グラフを描画する
 * 既存チャートがあれば破棄して再生成する
 */
function drawChart(canvasId, config) {
  if (state.charts[canvasId]) {
    state.charts[canvasId].destroy();
    delete state.charts[canvasId];
  }
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  state.charts[canvasId] = new Chart(canvas, config);
}

/* ============================================================
   タブ切替
   ============================================================ */

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // ボタン状態
      document.querySelectorAll('.tab-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });

      // コンテンツ表示切替
      document.querySelectorAll('.tab-content').forEach((el) => {
        el.classList.toggle('active', el.id === `tab-${tab}`);
      });

      // 統計タブに切り替えたときに自動ロード
      if (tab === 'stats') {
        loadStats();
      }
    });
  });
}

/* ============================================================
   設定モーダル
   ============================================================ */

/**
 * 設定モーダルを開く
 * @param {boolean} required  true = 閉じるボタンを非表示（初回設定時）
 */
function openSettingsModal(required = false) {
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.remove('hidden');
  overlay.classList.toggle('required', required);

  // 保存済みの値があれば入力欄に反映
  const { gasUrl } = loadConfig();
  document.getElementById('input-gas-url').value = gasUrl;

  document.getElementById('settings-error').classList.add('hidden');
  document.getElementById('input-gas-url').focus();
}

function closeSettingsModal() {
  document.getElementById('settings-overlay').classList.add('hidden');
}

function initSettingsModal() {
  // ⚙️ ヘッダーボタン
  document.getElementById('settings-btn').addEventListener('click', () => {
    openSettingsModal(false);
  });

  // 閉じるボタン
  document.getElementById('settings-close-btn').addEventListener('click', closeSettingsModal);

  // オーバーレイ外クリックで閉じる (required モード以外)
  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget &&
        !e.currentTarget.classList.contains('required')) {
      closeSettingsModal();
    }
  });

  // 保存ボタン
  document.getElementById('settings-save-btn').addEventListener('click', handleSettingsSave);

  // Enter キーでも保存
  document.getElementById('settings-overlay').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSettingsSave();
  });
}

async function handleSettingsSave() {
  const gasUrl = document.getElementById('input-gas-url').value.trim();
  const errEl  = document.getElementById('settings-error');

  if (!gasUrl) {
    errEl.textContent = 'GAS ウェブアプリ URL を入力してください';
    errEl.classList.remove('hidden');
    return;
  }
  if (!gasUrl.startsWith('https://')) {
    errEl.textContent = 'URL は https:// から始まる必要があります';
    errEl.classList.remove('hidden');
    return;
  }

  errEl.classList.add('hidden');
  saveConfig(gasUrl);

  // モーダルを閉じてアプリを起動
  closeSettingsModal();
  await startApp();
}

/* ============================================================
   アプリ初期化
   ============================================================ */

/** 設定完了後にアプリ本体を起動する */
async function startApp() {
  initTabs();
  initDateNav();
  initAddButtons();
  initStatsTab();
  await loadRecords(state.currentDate);
}

async function init() {
  initSettingsModal();

  if (!isConfigured()) {
    // 未設定: 設定モーダルを強制表示（閉じられない）
    openSettingsModal(true);
  } else {
    await startApp();
  }
}

document.addEventListener('DOMContentLoaded', init);
