// ========== BLE CONFIG =============
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'; // Nordic UART Service (example)
const RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write
const TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify

// If you know your device name prefix, set it here; otherwise leave null
const NAME_PREFIX = null;

// ========== STATE =============
let device, server, service, rxChar, txChar;
const enc = new TextEncoder();
const dec = new TextDecoder();

// Wake Lock handle
let wakeLock = null;

// ========== HELPERS =============
const $ = id => document.getElementById(id);
const setState = s => ($('state').textContent = s);
const log = msg => {
  const area = $('log');
  area.value += msg + '\n';
  area.scrollTop = area.scrollHeight;
};

// Keep screen awake (Android/Chrome)
async function keepScreenAwake() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      // Re-acquire if page becomes visible again
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && !wakeLock) {
          try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
        }
      });
    }
  } catch {
    // ignore
  }
}

// Release wake lock on disconnect
async function releaseWakeLock() {
  try {
    if (wakeLock) { await wakeLock.release(); }
  } catch {}
  wakeLock = null;
}

// Enter fullscreen (requires user gesture)
async function goFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch {}
}

// ========== BLE FLOW =============
async function connect() {
  try {
    setState('requesting device...');

    let deviceOptions;
    if (NAME_PREFIX) {
      deviceOptions = { filters: [{ namePrefix: NAME_PREFIX }], optionalServices: [SERVICE_UUID] };
    } else {
      // Broadest chooser: show all devices, but still grant us access to our service later
      deviceOptions = { acceptAllDevices: true, optionalServices: [SERVICE_UUID] };
    }

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
      const dv = ev.target.value; // DataView
      log(`ESP32 → ${dec.decode(dv.buffer)}`);
    });

    $('btnDisconnect').disabled = false;
    $('btnSend').disabled = false;
    setState('connected');
    log('✔ Connected. Listening for notifications.');

    // Keep screen awake once connected
    keepScreenAwake();
  } catch (err) {
    console.error(err);
    log(`⚠️ ${err.message || err}`);
    setState('error / idle');
  }
}

async function sendLine() {
  const text = $('outgoing').value;
  if (!text || !rxChar) return;
  try {
    const bytes = enc.encode(text + '\n'); // append newline if your firmware expects it
    await rxChar.writeValue(bytes);
    log(`You → ${text}`);
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

// ========== INIT UI =============
function init() {
  if (!('bluetooth' in navigator)) {
    log('❌ Web Bluetooth not supported in this browser.');
    $('btnConnect').disabled = true;
    return;
  }
  $('btnConnect').addEventListener('click', connect);
  $('btnDisconnect').addEventListener('click', disconnect);
  $('btnSend').addEventListener('click', sendLine);
  $('outgoing').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendLine(); }
  });
  $('btnFullscreen').addEventListener('click', goFullscreen);

  log('Ready. Tap “Connect”. (Requires HTTPS on Android)');
}

init();
