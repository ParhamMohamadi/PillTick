// ==== Configure your UUIDs here (NUS by default) ====
const SERVICE_UUID       = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX_CHAR_UUID       = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write
const TX_CHAR_UUID       = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify
// Optionally, filter by device name prefix to narrow the chooser:
const NAME_PREFIX        = 'ESP32'; // change to your advertised name, or set to null

let device, server, service, rxChar, txChar;
const enc = new TextEncoder();
const dec = new TextDecoder();

const $ = (id) => document.getElementById(id);
const setState = (s) => ($('state').textContent = s);
const log = (msg) => {
  const area = $('log');
  area.value += msg + '\n';
  area.scrollTop = area.scrollHeight;
};

async function connect() {
  try {
    setState('requesting device...');
    const filters = [];
    if (NAME_PREFIX) filters.push({ namePrefix: NAME_PREFIX });
    // At least one of filters or acceptAllDevices is required
    const deviceOptions = filters.length
      ? { filters, optionalServices: [SERVICE_UUID] }
      : { acceptAllDevices: true, optionalServices: [SERVICE_UUID] };

    device = await navigator.bluetooth.requestDevice(deviceOptions);

    device.addEventListener('gattserverdisconnected', onDisconnected);

    setState('connecting...');
    server = await device.gatt.connect();

    setState('getting service...');
    service = await server.getPrimaryService(SERVICE_UUID);

    setState('getting characteristics...');
    // RX: write from browser to ESP32
    rxChar = await service.getCharacteristic(RX_CHAR_UUID);
    // TX: notifications from ESP32 to browser
    txChar = await service.getCharacteristic(TX_CHAR_UUID);

    setState('subscribing to notifications...');
    await txChar.startNotifications();
    txChar.addEventListener('characteristicvaluechanged', (ev) => {
      const value = ev.target.value;
      // Convert DataView to string (assuming UTF-8 text)
      const str = dec.decode(value.buffer);
      log(`ESP32 → ${str}`);
    });

    $('btnDisconnect').disabled = false;
    $('btnSend').disabled = false;
    setState('connected');
    log('✔ Connected. Listening for notifications.');
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
    // Append newline if your ESP32 firmware expects it
    const bytes = enc.encode(text + '\n');
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
  log('Ready. Click “Connect”.');
}
init();
