// ===== Version & basic logger =====
const APP_VERSION = window.APP_VERSION || 'Ver:unknown';
const $ = id => document.getElementById(id);
function log(msg){ const a=$('log'); a.value += msg + '\n'; a.scrollTop = a.scrollHeight; }
console.log('PillTick version:', APP_VERSION);
$('versionLabel')?.textContent = APP_VERSION;

// Catch uncaught JS errors so you’ll see them in the console box
window.addEventListener('error', (e) => log('JS ERROR: ' + (e.message || e)));
window.addEventListener('unhandledrejection', (e) => log('PROMISE REJECTION: ' + (e.reason?.message || e.reason || e)));

/***********************
 * BLE CONFIG (NUS)
 ***********************/
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const NAME_PREFIX = null;

let device, server, service, rxChar, txChar;
const enc = new TextEncoder();
const dec = new TextDecoder();
let wakeLock = null;

/***********************
 * SUPPORT DIAGNOSTICS
 ***********************/
function diagnostics(){
  $('diagBrowser').textContent = navigator.userAgent;
  $('diagHttps').textContent = (location.protocol === 'https:' || location.hostname === 'localhost') ? 'OK' : 'NOT SECURE';
  const bleOK = 'bluetooth' in navigator;
  $('diagBle').textContent = bleOK ? 'available' : 'not available';
  if (!bleOK) $('bleWarning').style.display = '';
  // LocalStorage test
  try { localStorage.setItem('_pilltick_test','1'); localStorage.removeItem('_pilltick_test'); $('diagLs').textContent='OK'; }
  catch { $('diagLs').textContent='blocked'; }
  $('diagSw').textContent = 'serviceWorker' in navigator ? 'supported' : 'not supported';
}

/***********************
 * UI HELPERS
 ***********************/
function setState(s){ $('state').textContent = s; }

/***********************
 * WAKE LOCK + FULLSCREEN
 ***********************/
async function keepScreenAwake(){ try{ if('wakeLock' in navigator){ wakeLock = await navigator.wakeLock.request('screen'); } }catch(e){ log('WakeLock error: '+e.message); } }
async function releaseWakeLock(){ try{ await wakeLock?.release(); }catch{} wakeLock=null; }
async function goFullscreen(){ const el=document.documentElement; try{ if(el.requestFullscreen) await el.requestFullscreen(); }catch(e){ log('Fullscreen error: '+e.message); } }

/***********************
 * REMINDER STORAGE
 ***********************/
const STORE_KEY = 'PILL_REMINDERS_V1';
function loadReminders(){ try{return JSON.parse(localStorage.getItem(STORE_KEY))||[];}catch{return[];} }
function saveReminders(list){ localStorage.setItem(STORE_KEY, JSON.stringify(list)); }
function upsertReminder(rem){ const list=loadReminders(); const i=list.findIndex(r=>r.id===rem.id); if(i>=0) list[i]=rem; else list.push(rem); saveReminders(list); renderReminders(); updateNextDose(); log('Added/updated reminder: '+rem.label+' @ '+rem.time); }
function deleteReminder(id){ saveReminders(loadReminders().filter(r=>r.id!==id)); renderReminders(); updateNextDose(); log('Deleted reminder '+id); }

/***********************
 * DATE/TIME HELPERS
 ***********************/
function pad(n){return (n<10?'0':'')+n;}
function parseHHMM(hhmm){ const [h,m] = (hhmm||'').split(':').map(Number); return {h: h||0, m: m||0}; }
function nextOccurrence(rem, now=new Date()){
  const {h,m} = parseHHMM(rem.time); const mask = rem.daysMask;
  for (let add=0; add<8; add++){
    const d = new Date(now);
    d.setSeconds(0,0); d.setDate(now.getDate()+add); d.setHours(h, m, 0, 0);
    const wd = d.getDay(); const ok = (mask===0) ? true : ((mask & (1<<wd))!==0);
    if (!ok) continue; if (d > now) return d;
  }
  return null;
}
function computeNextDose(list, now=new Date()){
  let best=null, bestRem=null;
  for (const r of list){ const occ = nextOccurrence(r, now); if (!occ) continue; if (!best || occ<best){ best=occ; bestRem=r; } }
  return {when:best, rem:bestRem};
}

/***********************
 * RENDERING
 ***********************/
function daysMaskToText(mask){ if(mask===0) return 'Daily'; const s=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return s.filter((_,i)=>mask&(1<<i)).join(', '); }
function renderReminders(){
  const list = loadReminders();
  const ul = $('reminderList');
  ul.innerHTML = '';
  if (list.length === 0){ $('emptyHint').style.display=''; return; }
  $('emptyHint').style.display='none';
  list.sort((a,b)=>a.time.localeCompare(b.time));
  for (const r of list){
    const li = document.createElement('li');
    const left = document.createElement('div');
    left.innerHTML = `<div class="pillname">${r.label} — ${r.time}</div><div class="muted small">${daysMaskToText(r.daysMask)}</div>`;
    const del = document.createElement('button'); del.className='danger'; del.textContent='Delete'; del.onclick=()=>deleteReminder(r.id);
    const right = document.createElement('div'); right.appendChild(del);
    li.appendChild(left); li.appendChild(right); ul.appendChild(li);
  }
}
function updateNextDose(){
  const {when, rem} = computeNextDose(loadReminders());
  const txt = $('nextDoseText'); const cd = $('countdown');
  if (!when || !rem){ txt.textContent='No upcoming doses'; cd.textContent='—'; return; }
  txt.textContent = `${rem.label} at ${when.toDateString()} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  function tick(){
    const now = new Date(); const ms = when - now;
    if (ms <= 0){ cd.textContent = 'now'; return; }
    const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
    cd.textContent = `${pad(h)}:${pad(m%60)}:${pad(s%60)}`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/***********************
 * FORM
 ***********************/
function collectDaysMask(){
  if ($('remRepeat').value === 'daily') return 0;
  let mask = 0;
  [...$('customDays').querySelectorAll('input[type=checkbox]')].forEach(chk => { if (chk.checked) mask |= (1 << Number(chk.value)); });
  return mask;
}
function setupForm(){
  $('remRepeat').addEventListener('change', ()=>{ $('customDays').style.display = ($('remRepeat').value==='custom') ? '' : 'none'; });
  $('btnAdd').addEventListener('click', ()=>{
    const label = $('remLabel').value.trim();
    const time = $('remTime').value;
    const daysMask = collectDaysMask();
    if (!label || !time){ alert('Please enter a name and time.'); return; }
    const rem = { id: Math.random().toString(36).slice(2,9), label, time, daysMask };
    $('remLabel').value = '';
    upsertReminder(rem);
  });
}

/***********************
 * BLE
 ***********************/
function requireBleOrExplain(){
  if (!('bluetooth' in navigator)){
    alert('Web Bluetooth not available on this device/browser. Use Android Chrome or desktop Chrome/Edge. You can still use reminders without BLE.');
    return false;
  }
  if (!(location.protocol === 'https:' || location.hostname === 'localhost')){
    alert('Web Bluetooth requires HTTPS (or localhost). Use your GitHub Pages HTTPS URL.');
    return false;
  }
  return true;
}

async function connect(){
  try{
    if (!requireBleOrExplain()) return;
    setState('requesting device…');
    const opts = NAME_PREFIX
      ? { filters:[{namePrefix:NAME_PREFIX}], optionalServices:[SERVICE_UUID] }
      : { acceptAllDevices:true, optionalServices:[SERVICE_UUID] };
    device = await navigator.bluetooth.requestDevice(opts);
    device.addEventListener('gattserverdisconnected', onDisconnected);
    setState('connecting…'); server = await device.gatt.connect();
    setState('getting service…'); service = await server.getPrimaryService(SERVICE_UUID);
    rxChar = await service.getCharacteristic(RX_CHAR_UUID);
    txChar = await service.getCharacteristic(TX_CHAR_UUID);
    await txChar.startNotifications();
    txChar.addEventListener('characteristicvaluechanged', e => { log('ESP32 → ' + dec.decode(e.target.value.buffer).trim()); });
    $('btnDisconnect').disabled = false; $('btnSend').disabled = false; $('btnSync').disabled = false;
    setState('connected'); log('✔ Connected.');
    await keepScreenAwake();
    await syncTimeToDevice();
  } catch (e){
    log('⚠️ ' + (e.message || e));
    setState('error');
  }
}

async function sendRaw(line){ if (!rxChar) return; await rxChar.writeValue(enc.encode(line+'\n')); log('You → ' + line); }
async function syncTimeToDevice(){ await sendRaw(`SYNC_TIME ${Math.floor(Date.now()/1000)}`); }
async function pushRemindersToDevice(){
  if (!requireBleOrExplain()) return;
  await sendRaw('CLEAR_REMINDERS');
  for (const r of loadReminders()){
    const safe = r.label.replace(/\s+/g,'_');
    await sendRaw(`ADD_REMINDER ${r.id} ${r.time} ${r.daysMask} ${safe}`);
  }
  log('✔ Reminders synced.');
}

function onDisconnected(){ setState('disconnected'); $('btnDisconnect').disabled=true; $('btnSend').disabled=true; $('btnSync').disabled=true; log('ℹ️ Device disconnected.'); releaseWakeLock(); }
async function disconnect(){ try{ if (txChar){ try{ await txChar.stopNotifications(); }catch{} } if (device?.gatt?.connected) device.gatt.disconnect(); } finally { onDisconnected(); } }
async function sendLine(){ const t = $('outgoing').value; if (!t) return; await sendRaw(t); $('outgoing').value=''; }

/***********************
 * INIT
 ***********************/
function init(){
  diagnostics();

  // Buttons
  $('btnConnect').addEventListener('click', connect);
  $('btnDisconnect').addEventListener('click', disconnect);
  $('btnSend').addEventListener('click', sendLine);
  $('btnSync').addEventListener('click', pushRemindersToDevice);
  $('btnFullscreen').addEventListener('click', goFullscreen);
  $('outgoing').addEventListener('keydown', e => { if (e.key==='Enter'){ e.preventDefault(); sendLine(); } });

  // Form + list + countdown
  setupForm(); renderReminders(); updateNextDose(); setInterval(updateNextDose, 60000);

  log(`Ready (${APP_VERSION}).`);
}
init();
