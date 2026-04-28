'use strict';

/* ============================================================
   設定: localStorage
   ============================================================ */

const LS_KEY_GAS_URL = 'baby_gas_url';

function loadConfig() {
  return { gasUrl: localStorage.getItem(LS_KEY_GAS_URL) || '' };
}

function saveConfig(gasUrl) {
  localStorage.setItem(LS_KEY_GAS_URL, gasUrl.trim());
}

function isConfigured() {
  return loadConfig().gasUrl.startsWith('https://');
}

/* ============================================================
   アプリ状態
   ============================================================ */

const state = {
  currentDate: getTodayString(),
  charts: {},
  currentPeriod: '7',
};

/* ============================================================
   ユーティリティ
   ============================================================ */

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getTodayString() {
  return localDateString(new Date());
}

function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function currentTimeString() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/* ============================================================
   保存ステータス / エラー表示
   ============================================================ */

let _statusTimer = null;

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

function setLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

function setStatsLoading(show) {
  document.getElementById('stats-loading').classList.toggle('hidden', !show);
}

function showError(message) {
  const el = document.getElementById('error-msg');
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
}

/* ============================================================
   API通信
   ============================================================ */

async function apiGet(action, params = {}) {
  const { gasUrl } = loadConfig();
  const url = new URL(gasUrl);
  url.searchParams.set('action', action);
  url.searchParams.set('_t', Date.now());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'APIエラー');
  return json.data;
}

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

async function apiFetchRecords(date) {
  return apiPost('getRecords', { date });
}

async function apiSaveRecord(record) {
  return apiPost('saveRecord', record);
}

async function apiDeleteRecord(id) {
  return apiPost('deleteRecord', { id });
}

async function apiFetchStats(from, to) {
  return apiPost('getStats', { from, to });
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
    btn.innerHTML = `
      <span class="date-weekday">${DAYS_JA[d.getDay()]}</span>
      <span class="date-num">${d.getDate()}</span>
    `;
    if (dateStr === state.currentDate) btn.classList.add('active');
    if (dateStr === getTodayString()) btn.classList.add('today');
    btn.addEventListener('click', () => selectDate(dateStr));
    container.appendChild(btn);
  }

  const activeEl = container.querySelector('.date-item.active');
  if (activeEl) {
    requestAnimationFrame(() => {
      activeEl.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    });
  }
}

async function selectDate(dateStr) {
  state.currentDate = dateStr;
  document.querySelectorAll('.date-item').forEach((btn) => {
    const isActive = btn.dataset.date === dateStr;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  await loadRecords(dateStr);
}

/* ============================================================
   記録読み込みと描画
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
    renderRecords([]);
  } finally {
    setLoading(false);
  }
}

function renderRecords(records) {
  const c1Feeding   = records.filter((r) => r.child == 1 && r.category === 'feeding');
  const c2Feeding   = records.filter((r) => r.child == 2 && r.category === 'feeding');
  const c1Excretion = records.filter((r) => r.child == 1 && r.category === 'excretion');
  const c2Excretion = records.filter((r) => r.child == 2 && r.category === 'excretion');

  function fillContainer(contId, child, arr, addFn) {
    const cont = document.getElementById(contId);
    cont.innerHTML = '';
    arr.forEach((r) => addFn(cont, child, r));
  }

  fillContainer('child1-feeding-cards',   1, c1Feeding,   addFeedingCard);
  fillContainer('child2-feeding-cards',   2, c2Feeding,   addFeedingCard);
  fillContainer('child1-excretion-cards', 1, c1Excretion, addExcretionCard);
  fillContainer('child2-excretion-cards', 2, c2Excretion, addExcretionCard);
}

/* ============================================================
   授乳カード
   ============================================================ */

function addFeedingCard(container, child, data) {
  const tpl  = document.getElementById('feeding-card-template');
  const card = tpl.content.cloneNode(true).querySelector('.feeding-card');

  const id = (data && data.id) ? data.id : generateUUID();
  card.querySelector('.record-id').value = id;
  card.dataset.id    = id;
  card.dataset.child = child;

  if (data) {
    card.querySelector('.feeding-type').value = data.type || '母乳';
    const isMilk = data.type === 'ミルク';
    if (isMilk) {
      card.querySelector('.feeding-milk-start').value = data.start  || '';
      card.querySelector('.feeding-milk-end').value   = data.end    || '';
      card.querySelector('.feeding-amount').value     = data.amount != null ? data.amount : '';
    } else {
      card.querySelector('.feeding-left-start').value  = data.start      || '';
      card.querySelector('.feeding-left-end').value    = data.end        || '';
      card.querySelector('.feeding-right-start').value = data.rightStart || '';
      card.querySelector('.feeding-right-end').value   = data.rightEnd   || '';
    }
    card.querySelector('.feeding-memo').value = data.memo || '';
  } else {
    const now = currentTimeString();
    card.querySelector('.feeding-milk-start').value = now;
    card.querySelector('.feeding-left-start').value = now;
  }

  syncFeedingTypeVisibility(card);
  attachFeedingCardEvents(card);
  container.appendChild(card);
  return card;
}

function syncFeedingTypeVisibility(card) {
  const isMilk = card.querySelector('.feeding-type').value === 'ミルク';
  card.querySelector('.breast-times').classList.toggle('hidden', isMilk);
  card.querySelector('.milk-times').classList.toggle('hidden', !isMilk);
  card.querySelector('.milk-amount').classList.toggle('hidden', !isMilk);
}

function attachFeedingCardEvents(card) {
  const debouncedSave = debounce(() => executeSave(card), 500);

  card.querySelector('.feeding-type').addEventListener('change', () => {
    syncFeedingTypeVisibility(card);
    showSaveStatus('saving', '保存中...');
    debouncedSave();
  });

  ['feeding-left-start', 'feeding-left-end', 'feeding-right-start', 'feeding-right-end',
   'feeding-milk-start', 'feeding-milk-end', 'feeding-amount', 'feeding-memo'].forEach((cls) => {
    const el = card.querySelector('.' + cls);
    if (!el) return;
    el.addEventListener('change', () => { showSaveStatus('saving', '保存中...'); debouncedSave(); });
    el.addEventListener('input',  () => { showSaveStatus('saving', '保存中...'); debouncedSave(); });
  });

  [
    { btn: '.feeding-left-start-now',  field: '.feeding-left-start' },
    { btn: '.feeding-left-end-now',    field: '.feeding-left-end' },
    { btn: '.feeding-right-start-now', field: '.feeding-right-start' },
    { btn: '.feeding-right-end-now',   field: '.feeding-right-end' },
    { btn: '.feeding-milk-start-now',  field: '.feeding-milk-start' },
    { btn: '.feeding-milk-end-now',    field: '.feeding-milk-end' },
  ].forEach(({ btn, field }) => {
    const el = card.querySelector(btn);
    if (!el) return;
    el.addEventListener('click', () => {
      card.querySelector(field).value = currentTimeString();
      executeSave(card);
    });
  });

  card.querySelector('.delete-btn').addEventListener('click', () => {
    handleDeleteCard(card, '授乳');
  });
}

function collectFeedingData(card) {
  const type   = card.querySelector('.feeding-type').value;
  const isMilk = type === 'ミルク';
  const amount = card.querySelector('.feeding-amount').value;
  return {
    id:         card.dataset.id,
    date:       state.currentDate,
    child:      Number(card.dataset.child),
    category:   'feeding',
    type,
    start:      isMilk
                  ? card.querySelector('.feeding-milk-start').value
                  : card.querySelector('.feeding-left-start').value,
    end:        isMilk
                  ? card.querySelector('.feeding-milk-end').value
                  : card.querySelector('.feeding-left-end').value,
    rightStart: isMilk ? '' : card.querySelector('.feeding-right-start').value,
    rightEnd:   isMilk ? '' : card.querySelector('.feeding-right-end').value,
    amount:     amount !== '' ? Number(amount) : null,
    memo:       card.querySelector('.feeding-memo').value,
  };
}

/* ============================================================
   排泄カード
   ============================================================ */

function addExcretionCard(container, child, data) {
  const tpl  = document.getElementById('excretion-card-template');
  const card = tpl.content.cloneNode(true).querySelector('.excretion-card');

  const id = (data && data.id) ? data.id : generateUUID();
  card.querySelector('.record-id').value = id;
  card.dataset.id    = id;
  card.dataset.child = child;

  if (data) {
    card.querySelector('.excretion-type').value = data.type || 'おしっこ';
    card.querySelector('.excretion-time').value = data.time || '';
    card.querySelector('.excretion-memo').value = data.memo || '';
  } else {
    card.querySelector('.excretion-time').value = currentTimeString();
  }

  attachExcretionCardEvents(card);
  container.appendChild(card);
  return card;
}

function attachExcretionCardEvents(card) {
  const debouncedSave = debounce(() => executeSave(card), 500);

  ['excretion-type', 'excretion-time'].forEach((cls) => {
    card.querySelector('.' + cls).addEventListener('change', () => {
      showSaveStatus('saving', '保存中...');
      debouncedSave();
    });
  });
  card.querySelector('.excretion-memo').addEventListener('input', () => {
    showSaveStatus('saving', '保存中...');
    debouncedSave();
  });

  card.querySelector('.excretion-now-btn').addEventListener('click', () => {
    card.querySelector('.excretion-time').value = currentTimeString();
    executeSave(card);
  });

  card.querySelector('.delete-btn').addEventListener('click', () => {
    handleDeleteCard(card, '排泄');
  });
}

function collectExcretionData(card) {
  return {
    id:       card.dataset.id,
    date:     state.currentDate,
    child:    Number(card.dataset.child),
    category: 'excretion',
    type:     card.querySelector('.excretion-type').value,
    time:     card.querySelector('.excretion-time').value,
    memo:     card.querySelector('.excretion-memo').value,
  };
}

/* ============================================================
   保存 / 削除
   ============================================================ */

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

async function handleDeleteCard(card, categoryLabel) {
  if (!confirm(`この${categoryLabel}記録を削除しますか？`)) return;
  const id = card.dataset.id;
  try {
    showSaveStatus('saving', '削除中...');
    await apiDeleteRecord(id);
    card.remove();
    showSaveStatus('saved', '削除しました');
  } catch (err) {
    console.error('handleDeleteCard:', err);
    showSaveStatus('error', `削除エラー: ${err.message}`);
  }
}

/* ============================================================
   追加ボタン
   ============================================================ */

function initAddButtons() {
  const addMap = [
    { btnId: 'add-child1-feeding',   contId: 'child1-feeding-cards',   child: 1, fn: addFeedingCard },
    { btnId: 'add-child2-feeding',   contId: 'child2-feeding-cards',   child: 2, fn: addFeedingCard },
    { btnId: 'add-child1-excretion', contId: 'child1-excretion-cards', child: 1, fn: addExcretionCard },
    { btnId: 'add-child2-excretion', contId: 'child2-excretion-cards', child: 2, fn: addExcretionCard },
  ];

  addMap.forEach(({ btnId, contId, child, fn }) => {
    document.getElementById(btnId).addEventListener('click', () => {
      const cont = document.getElementById(contId);
      const card = fn(cont, child, null);
      requestAnimationFrame(() =>
        card.scrollIntoView({ behavior: 'smooth', block: 'center' })
      );
    });
  });
}

/* ============================================================
   コンテンツタブ (授乳/排泄)
   ============================================================ */

function initContentTabs() {
  document.querySelectorAll('.content-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.content-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const content = btn.dataset.content;
      document.querySelectorAll('.content-view').forEach((el) => {
        el.classList.toggle('active', el.id === `content-${content}`);
      });
    });
  });
}

/* ============================================================
   タブ切替 (記録/統計)
   ============================================================ */

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      document.querySelectorAll('.view').forEach((el) => {
        el.classList.toggle('active', el.id === `view-${tab}`);
      });

      // コンテンツタブは記録ビューのみ表示
      document.getElementById('content-tabs').classList.toggle('hidden', tab !== 'records');

      if (tab === 'stats') loadStats();
    });
  });
}

/* ============================================================
   統計タブ
   ============================================================ */

function initStatsTab() {
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

  document.getElementById('stats-search-btn').addEventListener('click', loadStats);
}

function resolveStatsPeriod() {
  const today = new Date();
  const todayStr = localDateString(today);
  switch (state.currentPeriod) {
    case '7': {
      const from = new Date(today); from.setDate(today.getDate() - 6);
      return { from: localDateString(from), to: todayStr };
    }
    case '30': {
      const from = new Date(today); from.setDate(today.getDate() - 29);
      return { from: localDateString(from), to: todayStr };
    }
    case 'month': {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: localDateString(from), to: todayStr };
    }
    case 'custom': {
      const from = document.getElementById('stats-from').value;
      const to   = document.getElementById('stats-to').value;
      if (!from || !to) { alert('開始日と終了日を入力してください'); return null; }
      if (from > to)    { alert('開始日は終了日より前に設定してください'); return null; }
      return { from, to };
    }
    default: return null;
  }
}

async function loadStats() {
  const period = resolveStatsPeriod();
  if (!period) return;
  setStatsLoading(true);
  try {
    const [statsData, dayRecords] = await Promise.all([
      apiFetchStats(period.from, period.to),
      apiFetchRecords(state.currentDate),
    ]);
    renderTimetable(dayRecords);
    renderStatsNumbers(statsData);
    renderCharts(statsData);
  } catch (err) {
    console.error('loadStats:', err);
    showError(`統計の取得に失敗しました。\n${err.message}`);
  } finally {
    setStatsLoading(false);
  }
}

/* ============================================================
   タイムテーブル
   ============================================================ */

function renderTimetable(records) {
  const dateLabel = document.getElementById('timetable-date');
  if (dateLabel) dateLabel.textContent = state.currentDate.replace(/-/g, '/');

  const body = document.getElementById('timetable-body');
  body.innerHTML = '';

  const byHour = {};
  records.forEach((r) => {
    if (!r.time) return;
    const hour = parseInt(r.time.split(':')[0], 10);
    if (!byHour[hour]) byHour[hour] = { c1: [], c2: [] };
    byHour[hour][r.child == 1 ? 'c1' : 'c2'].push(r);
  });

  const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
  if (hours.length === 0) {
    body.innerHTML = '<div class="timetable-empty">この日のデータがありません</div>';
    return;
  }

  hours.forEach((hour) => {
    const { c1, c2 } = byHour[hour];
    const row = document.createElement('div');
    row.className = 'tt-row';
    row.innerHTML = `
      <div class="tt-events">${buildEventHTML(c1)}</div>
      <div class="tt-time-col">
        <span class="tt-time-label">${String(hour).padStart(2, '0')}:00</span>
      </div>
      <div class="tt-events">${buildEventHTML(c2)}</div>
    `;
    body.appendChild(row);
  });
}

function buildEventHTML(events) {
  if (!events || events.length === 0) return '';
  return events.map((r) => {
    const cls = r.category === 'feeding' ? 'tt-feeding' : 'tt-excretion';
    let detail = '';
    if (r.category === 'feeding') {
      if (r.type === 'ミルク') {
        detail = r.amount != null ? `${r.amount}ml` : '';
      } else {
        const parts = [];
        if (r.start) parts.push(`左${r.start}${r.end ? '〜' + r.end : ''}`);
        if (r.rightStart) parts.push(`右${r.rightStart}${r.rightEnd ? '〜' + r.rightEnd : ''}`);
        detail = parts.join(' ');
      }
    } else {
      detail = r.type;
    }
    return `<div class="tt-event ${cls}">
      <span class="tt-event-time">${r.start || ''}</span>
      <span class="tt-event-detail">${detail}</span>
    </div>`;
  }).join('');
}

/* ============================================================
   統計数値
   ============================================================ */

function renderStatsNumbers(stats) {
  renderChildStats('c1', stats.child1);
  renderChildStats('c2', stats.child2);
}

function renderChildStats(prefix, data) {
  if (!data) return;
  const f = data.feeding;
  const e = data.excretion;

  document.getElementById(`${prefix}-feeding-stats`).innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${f.totalCount}</div>
      <div class="stat-label">総回数</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.avgPerDay}</div>
      <div class="stat-label">平均/日</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.totalMilk}<small>ml</small></div>
      <div class="stat-label">総ミルク</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.avgMilk}<small>ml</small></div>
      <div class="stat-label">平均ミルク/回</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.totalLeftMin}<small>分</small></div>
      <div class="stat-label">左授乳計</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${f.totalRightMin}<small>分</small></div>
      <div class="stat-label">右授乳計</div>
    </div>
  `;

  document.getElementById(`${prefix}-excretion-stats`).innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${e.urineCount}</div>
      <div class="stat-label">おしっこ</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${e.stoolCount}</div>
      <div class="stat-label">うんち</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${e.bothCount}</div>
      <div class="stat-label">両方</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${e.avgPerDay}</div>
      <div class="stat-label">平均/日</div>
    </div>
  `;
}

/* ============================================================
   グラフ
   ============================================================ */

function renderCharts(stats) {
  const daily = stats.daily;
  const labels = daily.dates.map((d) => {
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  });

  const barDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: true } },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
  };

  drawChart('chart-feeding-count', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '第一子',
          data: daily.c1FeedingCounts,
          backgroundColor: 'rgba(255, 154, 162, 0.65)',
          borderColor: '#FF9AA2',
          borderWidth: 1.5,
          borderRadius: 4,
        },
        {
          label: '第二子',
          data: daily.c2FeedingCounts,
          backgroundColor: 'rgba(168, 216, 234, 0.65)',
          borderColor: '#A8D8EA',
          borderWidth: 1.5,
          borderRadius: 4,
        },
      ],
    },
    options: barDefaults,
  });

  drawChart('chart-excretion-count', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '第一子',
          data: daily.c1ExcretionCounts,
          backgroundColor: 'rgba(255, 154, 162, 0.65)',
          borderColor: '#FF9AA2',
          borderWidth: 1.5,
          borderRadius: 4,
        },
        {
          label: '第二子',
          data: daily.c2ExcretionCounts,
          backgroundColor: 'rgba(168, 216, 234, 0.65)',
          borderColor: '#A8D8EA',
          borderWidth: 1.5,
          borderRadius: 4,
        },
      ],
    },
    options: barDefaults,
  });
}

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
   設定モーダル
   ============================================================ */

function openSettingsModal(required = false) {
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.remove('hidden');
  overlay.classList.toggle('required', required);
  document.getElementById('input-gas-url').value = loadConfig().gasUrl;
  document.getElementById('settings-error').classList.add('hidden');
  document.getElementById('input-gas-url').focus();
}

function closeSettingsModal() {
  document.getElementById('settings-overlay').classList.add('hidden');
}

function initSettingsModal() {
  document.getElementById('settings-btn').addEventListener('click', () => openSettingsModal(false));
  document.getElementById('settings-close-btn').addEventListener('click', closeSettingsModal);
  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget && !e.currentTarget.classList.contains('required')) {
      closeSettingsModal();
    }
  });
  document.getElementById('settings-save-btn').addEventListener('click', handleSettingsSave);
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
  closeSettingsModal();
  await startApp();
}

/* ============================================================
   アプリ初期化
   ============================================================ */

let _appStarted = false;

async function startApp() {
  if (!_appStarted) {
    _appStarted = true;
    initTabs();
    initContentTabs();
    initDateNav();
    initAddButtons();
    initStatsTab();
  }
  await loadRecords(state.currentDate);
}

async function init() {
  initSettingsModal();
  if (!isConfigured()) {
    openSettingsModal(true);
  } else {
    await startApp();
  }
}

document.addEventListener('DOMContentLoaded', init);
