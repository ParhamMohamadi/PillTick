// ===== Global version =====
const APP_VERSION = window.APP_VERSION || 'Ver:unknown';
console.log('PillTick version:', APP_VERSION);
document.getElementById('versionLabel')?.textContent = APP_VERSION;

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
async function releaseWakeLock() { try { if (wakeLock) await wakeLock.release(); } catch {} wakeLock=null; }
async function goFullscreen() { const el=document.documentElement; if (el.requestFullscreen) await el.requestFullscreen(); }

/***********************
 * REMINDER STORAGE
 ***********************/
const STORE_KEY = 'PILL_REMINDERS_V1';
function loadReminders(){ try{return JSON.parse(localStorage.getItem(STORE_KEY))||[];}catch{return[];} }
function saveReminders(list){ localStorage.setItem(STORE_KEY, JSON.stringify(list)); }
function upsertReminder(rem){ const list=loadReminders();const i=list.findIndex(r=>r.id===rem.id); if(i>=0) list[i]=rem; else list.push(rem); saveReminders(list); renderReminders(); updateNextDose(); }
function deleteReminder(id){ saveReminders(loadReminders().filter(r=>r.id!==id)); renderReminders(); updateNextDose(); }

/***********************
 * DATE/TIME HELPERS
 ***********************/
function pad(n){return (n<10?'0':'')+n;}
function parseHHMM(hhmm){const [h,m]=hhmm.split(':').map(Number);return{h,m};}
function nextOccurrence(rem,now=new Date()){const {h,m}=parseHHMM(rem.time);const mask=rem.daysMask;for(let a=0;a<8;a++){const d=new Date(now);d.setSeconds(0,0);d.setDate(now.getDate()+a);d.setHours(h,m,0,0);const wd=d.getDay();const ok=(mask===0)?true:((mask&(1<<wd))!==0);if(!ok)continue;if(d>now)return d;}return null;}
function computeNextDose(list,now=new Date()){let best=null,rem=null;for(const r of list){const occ=nextOccurrence(r,now);if(!occ)continue;if(!best||occ<best){best=occ;rem=r;}}return{when:best,rem};}

/***********************
 * RENDERING
 ***********************/
function daysMaskToText(mask){if(mask===0)return'Daily';const s=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];return s.filter((_,i)=>mask&(1<<i)).join(', ');}
function renderReminders(){
  const list=loadReminders();const ul=$('reminderList');ul.innerHTML='';
  if(list.length===0){$('emptyHint').style.display='';return;}
  $('emptyHint').style.display='none';list.sort((a,b)=>a.time.localeCompare(b.time));
  for(const r of list){
    const li=document.createElement('li');
    const left=document.createElement('div');
    left.innerHTML=`<div class="pillname">${r.label} — ${r.time}</div><div class="muted small">${daysMaskToText(r.daysMask)}</div>`;
    const del=document.createElement('button');del.className='danger';del.textContent='Delete';del.onclick=()=>deleteReminder(r.id);
    const right=document.createElement('div');right.appendChild(del);
    li.appendChild(left);li.appendChild(right);ul.appendChild(li);
  }
}
function updateNextDose(){
  const{when,rem}=computeNextDose(loadReminders());const txt=$('nextDoseText');const cd=$('countdown');
  if(!when||!rem){txt.textContent='No upcoming doses';cd.textContent='—';return;}
  const ds=`${when.toDateString()} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  txt.textContent=`${rem.label} at ${ds}`;
  function tick(){const now=new Date();const ms=when-now;if(ms<=0){cd.textContent='now';return;}
    const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60);cd.textContent=`${pad(h)}:${pad(m%60)}:${pad(s%60)}`;
    requestAnimationFrame(tick);}requestAnimationFrame(tick);
}

/***********************
 * FORM
 ***********************/
function collectDaysMask(){
  if($('remRepeat').value==='daily')return 0;
  let mask=0;[...$('customDays').querySelectorAll('input[type=checkbox]')].forEach(chk=>{if(chk.checked)mask|=(1<<Number(chk.value));});
  return mask;
}
function setupForm(){
  $('remRepeat').addEventListener('change',()=>{$('customDays').style.display=($('remRepeat').value==='custom')?'':'none';});
  $('btnAdd').addEventListener('click',()=>{
    const label=$('remLabel').value.trim();const time=$('remTime').value;const daysMask=collectDaysMask();
    if(!label||!time){alert('Please enter a name and time.');return;}
    const rem={id:Math.random().toString(36).slice(2,9),label,time,daysMask};
    $('remLabel').value='';upsertReminder(rem);
  });
}

/***********************
 * BLE
 ***********************/
async function connect(){
  try{
    setState('requesting device...');
    const opts=NAME_PREFIX?{filters:[{namePrefix:NAME_PREFIX}],optionalServices:[SERVICE_UUID]}:{acceptAllDevices:true,optionalServices:[SERVICE_UUID]};
    device=await navigator.bluetooth.requestDevice(opts);
    device.addEventListener('gattserverdisconnected',onDisconnected);
    setState('connecting...');server=await device.gatt.connect();
    setState('getting service...');service=await server.getPrimaryService(SERVICE_UUID);
    rxChar=await service.getCharacteristic(RX_CHAR_UUID);
    txChar=await service.getCharacteristic(TX_CHAR_UUID);
    await txChar.startNotifications();
    txChar.addEventListener('characteristicvaluechanged',e=>{log(`ESP32 → ${dec.decode(e.target.value.buffer).trim()}`);});
    $('btnDisconnect').disabled=false;$('btnSend').disabled=false;$('btnSync').disabled=false;
    setState('connected');log('✔ Connected.');keepScreenAwake();await syncTimeToDevice();
  }catch(e){console.error(e);log(`⚠️ ${e.message}`);setState('error');}
}
async function sendRaw(l){if(!rxChar)return;await rxChar.writeValue(enc.encode(l+'\n'));log(`You → ${l}`);}
async function syncTimeToDevice(){await sendRaw(`SYNC_TIME ${Math.floor(Date.now()/1000)}`);}
async function pushRemindersToDevice(){
  const list=loadReminders();await sendRaw('CLEAR_REMINDERS');
  for(const r of list){const safe=r.label.replace(/\s+/g,'_');await sendRaw(`ADD_REMINDER ${r.id} ${r.time} ${r.daysMask} ${safe}`);}
  log('✔ Reminders synced.');
}
async function sendLine(){const t=$('outgoing').value;if(!t)return;await sendRaw(t);$('outgoing').value='';}
function onDisconnected(){setState('disconnected');$('btnDisconnect').disabled=true;$('btnSend').disabled=true;$('btnSync').disabled=true;log('ℹ️ Device disconnected.');releaseWakeLock();}
async function disconnect(){try{if(txChar){try{await txChar.stopNotifications();}catch{}}
  if(device?.gatt?.connected)device.gatt.disconnect();}finally{onDisconnected();}}

/***********************
 * INIT
 ***********************/
function init(){
  if(!('bluetooth'in navigator)){$('btnConnect').disabled=true;log('❌ Web Bluetooth not supported.');}
  else{$('btnConnect').addEventListener('click',connect);}
  $('btnDisconnect').addEventListener('click',disconnect);
  $('btnSend').addEventListener('click',sendLine);
  $('btnSync').addEventListener('click',pushRemindersToDevice);
  $('btnFullscreen').addEventListener('click',goFullscreen);
  $('outgoing').addEventListener('keydown',e=>{if(e.key==
