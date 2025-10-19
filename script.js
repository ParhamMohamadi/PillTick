// ===== Version & basic logger (compat) =====
var APP_VERSION = window.APP_VERSION || 'Ver:unknown';
function $(id){ return document.getElementById(id); }
function log(msg){
  var a = $('log');
  if (!a) return;
  a.value += msg + '\n';
  a.scrollTop = a.scrollHeight;
}
try {
  console.log('PillTick version:', APP_VERSION);
  var vl = $('versionLabel');
  if (vl) vl.textContent = APP_VERSION;
} catch(e){}

// Show JS errors in the in-page console
window.addEventListener('error', function(e){ log('JS ERROR: ' + (e.message || e)); });
window.addEventListener('unhandledrejection', function(e){ 
  var r = e.reason && (e.reason.message || e.reason) || e;
  log('PROMISE REJECTION: ' + r);
});

/***********************
 * BLE CONFIG (NUS)
 ***********************/
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const RX_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8'; // write
const TX_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8'; // same char used for notify

var NAME_PREFIX = null;

var device, server, service, rxChar, txChar;
var enc = new TextEncoder();
var dec = new TextDecoder();
var wakeLock = null;

/***********************
 * SUPPORT DIAGNOSTICS
 ***********************/
function diagnostics(){
  var ua = navigator.userAgent || '';
  $('diagBrowser').textContent = ua;
  $('diagHttps').textContent = (location.protocol === 'https:' || location.hostname === 'localhost') ? 'OK' : 'NOT SECURE';
  var bleOK = ('bluetooth' in navigator);
  $('diagBle').textContent = bleOK ? 'available' : 'not available';
  if (!bleOK) { var bw = $('bleWarning'); if (bw) bw.style.display = ''; }
  try { localStorage.setItem('_pilltick_test','1'); localStorage.removeItem('_pilltick_test'); $('diagLs').textContent='OK'; }
  catch (e){ $('diagLs').textContent='blocked'; }
  $('diagSw').textContent = ('serviceWorker' in navigator) ? 'supported' : 'not supported';
}

/***********************
 * UI HELPERS
 ***********************/
function setState(s){ var el = $('state'); if (el) el.textContent = s; }

/***********************
 * WAKE LOCK + FULLSCREEN
 ***********************/
function keepScreenAwake(){
  try{
    if ('wakeLock' in navigator && navigator.wakeLock && navigator.wakeLock.request) {
      return navigator.wakeLock.request('screen').then(function(wl){ wakeLock = wl; });
    }
  }catch(e){ log('WakeLock error: '+e.message); }
  return Promise.resolve();
}
function releaseWakeLock(){
  try{ if (wakeLock && wakeLock.release) wakeLock.release(); }catch(e){}
  wakeLock = null;
}
function goFullscreen(){
  var el = document.documentElement;
  try { if (el.requestFullscreen) el.requestFullscreen(); } catch(e){ log('Fullscreen error: '+e.message); }
}

/***********************
 * REMINDER STORAGE
 ***********************/
var STORE_KEY = 'PILL_REMINDERS_V1';
function loadReminders(){ try{ return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }catch(e){ return []; } }
function saveReminders(list){ localStorage.setItem(STORE_KEY, JSON.stringify(list)); }
function upsertReminder(rem){
  var list = loadReminders();
  var i = -1;
  for (var k=0;k<list.length;k++){ if (list[k].id === rem.id) { i=k; break; } }
  if (i>=0) list[i]=rem; else list.push(rem);
  saveReminders(list);
  renderReminders();
  updateNextDose();
  log('Added/updated reminder: '+rem.label+' @ '+rem.time);
}
function deleteReminder(id){
  var list = loadReminders().filter(function(r){ return r.id !== id; });
  saveReminders(list);
  renderReminders();
  updateNextDose();
  log('Deleted reminder '+id);
}

/***********************
 * DATE/TIME HELPERS
 ***********************/
function pad(n){ return (n<10?'0':'')+n; }
function parseHHMM(hhmm){
  if (!hhmm) return {h:0, m:0};
  var parts = hhmm.split(':');
  return { h: parseInt(parts[0]||'0',10), m: parseInt(parts[1]||'0',10) };
}
function nextOccurrence(rem, now){
  now = now || new Date();
  var t = parseHHMM(rem.time);
  var mask = rem.daysMask;
  for (var add=0; add<8; add++){
    var d = new Date(now.getTime());
    d.setSeconds(0,0);
    d.setDate(now.getDate()+add);
    d.setHours(t.h, t.m, 0, 0);
    var wd = d.getDay();
    var ok = (mask===0) ? true : ((mask & (1<<wd)) !== 0);
    if (!ok) continue;
    if (d > now) return d;
  }
  return null;
}
function computeNextDose(list, now){
  now = now || new Date();
  var best = null, bestRem = null;
  for (var i=0;i<list.length;i++){
    var r = list[i];
    var occ = nextOccurrence(r, now);
    if (!occ) continue;
    if (!best || occ < best){ best = occ; bestRem = r; }
  }
  return { when: best, rem: bestRem };
}

/***********************
 * RENDERING
 ***********************/
function daysMaskToText(mask){
  if (mask===0) return 'Daily';
  var s=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var out=[], i;
  for (i=0;i<7;i++){ if (mask & (1<<i)) out.push(s[i]); }
  return out.join(', ');
}
function renderReminders(){
  var list = loadReminders();
  var ul = $('reminderList');
  if (!ul) return;
  ul.innerHTML = '';
  if (list.length === 0){
    var eh = $('emptyHint'); if (eh) eh.style.display = '';
    return;
  }
  var eh2 = $('emptyHint'); if (eh2) eh2.style.display = 'none';
  list.sort(function(a,b){ return a.time.localeCompare(b.time); });
  for (var i=0;i<list.length;i++){
    var r = list[i];
    var li = document.createElement('li');
    var left = document.createElement('div');
    left.innerHTML = '<div class="pillname">'+r.label+' — '+r.time+'</div><div class="muted small">'+daysMaskToText(r.daysMask)+'</div>';
    var del = document.createElement('button'); del.className='danger'; del.textContent='Delete';
    del.onclick = (function(id){ return function(){ deleteReminder(id); }; })(r.id);
    var right = document.createElement('div'); right.appendChild(del);
    li.appendChild(left); li.appendChild(right); ul.appendChild(li);
  }
}
function updateNextDose(){
  var ndt = $('nextDoseText'), cd = $('countdown');
  if (!ndt || !cd) return;
  var res = computeNextDose(loadReminders());
  var when = res.when, rem = res.rem;
  if (!when || !rem){ ndt.textContent='No upcoming doses'; cd.textContent='—'; return; }
  ndt.textContent = rem.label + ' at ' + when.toDateString() + ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes());
  function tick(){
    var now = new Date();
    var ms = when - now;
    if (ms <= 0){ cd.textContent = 'now'; return; }
    var s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
    cd.textContent = pad(h)+':'+pad(m%60)+':'+pad(s%60);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/***********************
 * FORM
 ***********************/
function collectDaysMask(){
  var rep = $('remRepeat');
  if (!rep || rep.value === 'daily') return 0;
  var mask = 0;
  var box = $('customDays');
  if (!box) return 0;
  var checks = box.querySelectorAll('input[type=checkbox]');
  for (var i=0;i<checks.length;i++){
    var chk = checks[i];
    if (chk.checked) { mask |= (1 << parseInt(chk.value,10)); }
  }
  return mask;
}
function setupForm(){
  var rep = $('remRepeat');
  var custom = $('customDays');
  if (rep && custom){
    rep.addEventListener('change', function(){
      custom.style.display = (rep.value === 'custom') ? '' : 'none';
    });
  }
  var addBtn = $('btnAdd');
  if (addBtn){
    addBtn.addEventListener('click', function(){
      var labelEl = $('remLabel');
      var timeEl  = $('remTime');
      var label = labelEl ? labelEl.value.trim() : '';
      var time  = timeEl ? timeEl.value : '';
      var daysMask = collectDaysMask();
      if (!label || !time){ alert('Please enter a name and time.'); return; }
      var rem = { id: Math.random().toString(36).slice(2,9), label: label, time: time, daysMask: daysMask };
      if (labelEl) labelEl.value = '';
      upsertReminder(rem);
    });
  }
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

function connect(){
  try{
    if (!requireBleOrExplain()) return;
    setState('requesting device…');
    var opts = NAME_PREFIX
      ? { filters:[{namePrefix:NAME_PREFIX}], optionalServices:[SERVICE_UUID] }
      : { acceptAllDevices:true, optionalServices:[SERVICE_UUID] };
    navigator.bluetooth.requestDevice(opts).then(function(dev){
      device = dev;
      device.addEventListener('gattserverdisconnected', onDisconnected);
      setState('connecting…');
      return device.gatt.connect();
    }).then(function(srv){
      server = srv;
      setState('getting service…');
      return server.getPrimaryService(SERVICE_UUID);
    }).then(function(svc){
      service = svc;
      return Promise.all([
        service.getCharacteristic(RX_CHAR_UUID).then(function(c){ rxChar=c; }),
        service.getCharacteristic(TX_CHAR_UUID).then(function(c){ txChar=c; })
      ]);
    }).then(function(){
      return txChar.startNotifications().then(function(){
        txChar.addEventListener('characteristicvaluechanged', function(e){
          var txt = dec.decode(e.target.value.buffer).trim();
          log('ESP32 → ' + txt);
        });
      });
    }).then(function(){
      $('btnDisconnect').disabled = false;
      $('btnSend').disabled = false;
      $('btnSync').disabled = false;
      setState('connected'); log('✔ Connected.');
      return keepScreenAwake();
    }).then(function(){
      return syncTimeToDevice();
    }).catch(function(e){
      log('⚠️ ' + (e.message || e));
      setState('error');
    });
  } catch (e){
    log('⚠️ ' + (e.message || e));
    setState('error');
  }
}

function sendRaw(line){
  if (!rxChar) return Promise.resolve();
  return rxChar.writeValue(enc.encode(line+'\n')).then(function(){
    log('You → ' + line);
  });
}
function syncTimeToDevice(){ return sendRaw('SYNC_TIME ' + Math.floor(Date.now()/1000)); }
function pushRemindersToDevice(){
  if (!requireBleOrExplain()) return;
  sendRaw('CLEAR_REMINDERS').then(function(){
    var list = loadReminders();
    var p = Promise.resolve();
    list.forEach(function(r){
      var safe = r.label.replace(/\s+/g,'_');
      p = p.then(function(){ return sendRaw('ADD_REMINDER ' + r.id + ' ' + r.time + ' ' + r.daysMask + ' ' + safe); });
    });
    return p.then(function(){ log('✔ Reminders synced.'); });
  });
}

function onDisconnected(){
  setState('disconnected');
  $('btnDisconnect').disabled = true;
  $('btnSend').disabled = true;
  $('btnSync').disabled = true;
  log('ℹ️ Device disconnected.');
  releaseWakeLock();
}
function disconnect(){
  try{
    var p = Promise.resolve();
    if (txChar && txChar.stopNotifications) {
      p = txChar.stopNotifications().catch(function(){});
    }
    p.then(function(){
      if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
    }).finally(onDisconnected);
  }catch(e){ onDisconnected(); }
}
function sendLine(){
  var t = $('outgoing') ? $('outgoing').value : '';
  if (!t) return;
  sendRaw(t).then(function(){ if ($('outgoing')) $('outgoing').value=''; });
}

/***********************
 * INIT
 ***********************/
function init(){
  diagnostics();

  // Buttons
  var b1=$('btnConnect'); if (b1) b1.addEventListener('click', connect);
  var b2=$('btnDisconnect'); if (b2) b2.addEventListener('click', disconnect);
  var b3=$('btnSend'); if (b3) b3.addEventListener('click', sendLine);
  var b4=$('btnSync'); if (b4) b4.addEventListener('click', pushRemindersToDevice);
  var b5=$('btnFullscreen'); if (b5) b5.addEventListener('click', goFullscreen);
  var out=$('outgoing'); if (out) out.addEventListener('keydown', function(e){ if (e.key==='Enter'){ e.preventDefault(); sendLine(); } });

  // Form + list + countdown
  setupForm(); renderReminders(); updateNextDose(); setInterval(updateNextDose, 60000);

  log('Ready ('+APP_VERSION+').');
}
init();
