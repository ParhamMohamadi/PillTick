/***********************
 * BLE CONFIG (NUS)
 ***********************/
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'; // Nordic UART Service
const RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write
const TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify
const NAME_PREFIX = null; // broaden chooser

let device, server, service, rxChar, txChar;
const enc = new TextEncoder();
const dec = new TextDecoder();

let wakeLock = null;

/***********************
 * UI HELPERS
 ***********************/
const $ = id => document.getElementById(id);
const setState = s => ($('state').textContent = s);
const log = msg => {
  const area = $('log');
  area.value += msg + '\n';
  area.scrollTop = area.scrollHeight;
};

/***********************
 * WAKE LOCK + FULLSCREEN
 ***********************/
async function keepScreenAwake() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && !wakeLock) {
          try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
        }
      });
    }
  } catch {}
}
async function releaseWakeLock() {
  try { if (wakeLock) await wakeLock.release(); } catch {}
  wakeLock = null;
}
async function goFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch {}
}

/***********************
 * REMINDER STORAGE
 ***********************/
const STORE_KEY = 'PILL_REMINDERS_V1';
// Reminder shape: { id, label, time:"HH:MM", daysMask:number }
function loadReminders() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
  catch { return []; }
}
function saveReminders(list) {
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
}
function upsertReminder(rem) {
  const list = loadReminders();
  const idx = list.findIndex(r => r.id === rem.id);
  if (idx >= 0) list[idx] = rem; else list.push(rem);
  saveReminders(list);
  renderReminders();
  updateNextDose();
}
function deleteReminder(id) {
  const list = loadReminders().filter(r => r.id !== id);
  saveReminders(list);
  renderReminders();
  updateNextDose();
}

/***********************
 * DATE/TIME HELPERS
 ***********************/
function pad(n){ return (n<10?'0':'') + n; }
function parseHHMM(hhmm) {
  const [h,m] = hhmm.split(':').map(Number);
  return {h, m};
}

/**
 * Compute next occurrence for a reminder after 'now'
 * JS Date weekday: 0=Sun .. 6=Sat
 */
function nextOccurrence(rem, now = new Date()) {
  const {h, m} = parseHHMM(rem.time);
  const mask = rem.daysMask; // 0 means daily
  for (let addDays = 0; addDays < 8; addDays++) {
    const d = new Date(now);
    d.setSeconds(0,0);
    d.setDate(now.getDate() + addDays);
    d.setHours(h, m, 0, 0);
    const wd = d.getDay();
    const dayOk = (mask === 0) ? true : ((mask & (1 << wd)) !== 0);
    if (!dayOk) continue;
    if (d > now) return d;
  }
  return null;
}

/** Pick the soonest upcoming reminder across the list */
function computeNextDose(list, now = new Date()) {
  let best = null, bestRem = null;
  for (const rem of list) {
    const occ = nextOccurrence(rem, now);
    if (!occ) continue;
    if (!best || occ < best) { best = occ; bestRem = rem; }
  }
  return { when: best, rem: bestRem };
}

/***********************
 * UI RENDERING
 ***********************/
function daysMaskToText(mask) {
  if (mask === 0) return 'Daily';
  const short = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const out = [];
  for (let i=0;i<7;i++) if (mask & (1<<i)) out.push(short[i]);
  return out.join(', ');
}
function renderReminders() {
  const list = loadReminders();
  const ul = $('reminderList');
  ul.innerHTML = '';
  if (list.length === 0) {
    $('emptyHint').style.display = '';
    return;
  }
  $('emptyHint').style.display = 'none';
  list.sort((a,b)=>a.time.localeCompare(b.time)); // sort by time of day
  for (const r of list) {
    const li = document.createElement('li');
    const left = document.createElement('div');
    left.innerHTML = `<div class="pillname">${r.label} — ${r.time}</div>
                      <div class="muted small">${daysMaskToText(r.daysMask)}</div>`;
    const right = document.createElement('div');
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Delete';
    del.onclick = () => deleteReminder(r.id);
    right.appendChild(del);
    li.appendChild(left);
    li.appendChild(right);
    ul.appendChild(li);
  }
}
function updateNextDose() {
  const { when, rem } = computeNextDose(loadReminders());
  const txt = $('nextDoseText');
  const cd = $('countdown');

  if (!when || !rem) {
    txt.textContent = 'No upcoming doses';
    cd.textContent = '—';
    return;
  }
  const dtStr = `${when.toDateString()} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  txt.textContent = `${rem.label} at ${dtStr}`;

  // live countdown
  function tick() {
    const now = new Date();
    const ms = when - now;
    if (ms <= 0) { cd.textContent = 'now'; return; }
    const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
    const ss = s % 60, mm = m % 60, hh = h;
    cd.textContent = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/***********************
 * ADD FORM HANDLERS
 ***********************/
function collectDaysMask() {
  const repeat = $('remRepeat').value;
  if (repeat === 'daily') return 0;
  let mask = 0;
  [...$('customDays').querySelectorAll('input[type=checkbox]')].forEach(chk => {
    if (chk.checked) mask |= (1 << Number(chk.value));
  });
  return mask;
}
function setupForm() {
  $('remRepeat').addEventListener('change', () => {
    $('customDays').style.display = ($('remRepeat').value === 'custom') ? '' : 'none';
  });
  $('btnAdd').addEventListener('click', () => {
    const label = $('remLabel').value.trim();
    const time = $('remTime').value;
    const daysMask = collectDaysMask();
    if (!label || !time) { alert('Please enter a name and time.'); return; }
    const rem = {
      id: Math.random().toString(36).slice(2,9),
      label, time, daysMask
    };
    $('remLabel').value = '';
    upsertReminder(rem);
  });
}

/***********************
 * BLE FLOW
 ***********************/
async function connect() {
  try {
    setState('requesting device...');
    const deviceOptions = NAME_PREFIX
      ? { filters: [{ namePrefix: NAME_PREFIX }], optionalServices: [SERVICE_UUID] }
      : { acceptAllDevices: true, optionalServices: [SERVICE_UUID] };

    device = await navigator.bluetooth.requestDevice(deviceOptions);
    device.addEventListener('gattserverdisconnected', onDisconnected);

    setState('connecting...');
    server = await device.gatt.connect();

    setState('getting service...');
    service = await server.getPrimaryService(SERVICE_UUID);

    setState('getting characteristics...');
    rxChar = await service.getCharacteristic(RX_CHAR_UUID);
    txChar = await service.getCharacteristic(TX_CHAR_UUID);

    setState('subscribing...');
    await txChar.startNotifications();
    txChar.addEventListener('characteristicvaluechanged', (ev) => {
      const text = dec.decode(ev.target.value.buffer);
      log(`ESP32 → ${text.trim()}`);
      // Optional: you can parse device responses here to update UI
      // e.g., if firmware sends `NEXT: <epoch> <label>`
    });

    $('btnDisconnect').disabled = false;
    $('btnSend').disabled = false;
    $('btnSync').disabled = false;

    setState('connected');
    log('✔ Connected.');
    keepScreenAwake();

    // Sync clock automatically on connect (optional)
    await syncTimeToDevice();
  } catch (err) {
    console.error(err);
    log(`⚠️ ${err.message || err}`);
    setState('error / idle');
  }
}

async function sendRaw(line) {
  if (!rxChar) return;
  const bytes = enc.encode(line + '\n');
  await rxChar.writeValue(bytes);
  log(`You → ${line}`);
}

async function syncTimeToDevice() {
  const epoch = Math.floor(Date.now() / 1000);
  await sendRaw(`SYNC_TIME ${epoch}`);
}

async function pushRemindersToDevice() {
  const list = loadReminders();
  await sendRaw('CLEAR_REMINDERS');
  for (const r of list) {
    // Escape spaces in label minimally by replacing spaces with underscores (adjust to your firmware)
    const safeLabel = r.label.replace(/\s+/g, '_');
    await sendRaw(`ADD_REMINDER ${r.id} ${r.time} ${r.daysMask} ${safeLabel}`);
  }
  log('✔ Reminders synced.');
}

async function sendLine() {
  const text = $('outgoing').value;
  if (!text) return;
  try {
    await sendRaw(text);
    $('outgoing').value = '';
  } catch (err) {
    console.error(err);
    log(`⚠️ send error: ${err.message || err}`);
  }
}

function onDisconnected() {
  setState('disconnected');
  $('btnDisconnect').disabled = true;
  $('btnSend').disabled = true;
  $('btnSync').disabled = true;
  log('ℹ️ Device disconnected.');
  releaseWakeLock();
}

async function disconnect() {
  try {
    if (txChar) {
      try { await txChar.stopNotifications(); } catch {}
      txChar.removeEventListener('characteristicvaluechanged', () => {});
    }
    if (device?.gatt?.connected) device.gatt.disconnect();
  } finally {
    onDisconnected();
  }
}

/***********************
 * INIT
 ***********************/
function init() {
  // BLE buttons
  if (!('bluetooth' in navigator)) {
    log('❌ Web Bluetooth not supported in this browser.');
    $('btnConnect').disabled = true;
  } else {
    $('btnConnect').addEventListener('click', connect);
    $('btnDisconnect').addEventListener('click', disconnect);
    $('btnSend').addEventListener('click', sendLine);
    $('btnSync').addEventListener('click', pushRemindersToDevice);
  }

  $('btnFullscreen').addEventListener('click', goFullscreen);
  $('outgoing').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendLine(); }
  });

  // Form + list + next dose
  setupForm();
  renderReminders();
  updateNextDose();

  // Recompute next dose every minute (lightweight)
  setInterval(updateNextDose, 60 * 1000);

  log('Ready. Add reminders and/or tap “Connect”.');
}
init();
