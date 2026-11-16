'use strict';

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString();
}

function switchHtml(on, label) {
  return '<div class="aternos-switch ' + (on ? 'enabled' : 'disabled') + '" role="img" aria-label="' + esc(label) + ': ' + (on ? 'enabled' : 'disabled') + '"><span class="switch-icon"><i class="fa-solid ' + (on ? 'fa-check' : 'fa-xmark') + '"></i></span></div>';
}

function valHtml(v, label) {
  if (typeof v === 'boolean') return switchHtml(v, label);
  if (v === null || v === undefined || v === '') return '<span>-</span>';
  if (Array.isArray(v)) return '<span>' + (v.length ? esc(v.join(', ')) : '-') + '</span>';
  return '<span>' + esc(v) + '</span>';
}

function rowHtml(label, valueHtml) {
  return '<div class="config-row"><span>' + esc(label) + '</span>' + valueHtml + '</div>';
}

function rowsHtml(rows) {
  return rows.map(function (r) { return rowHtml(r[0], valHtml(r[1], r[0])); }).join('');
}

function flatten(node, trail, out) {
  Object.keys(node).forEach(function (k) {
    const v = node[k];
    const next = trail.concat(k);
    if (Array.isArray(v) && v.length && v.every(function (i) { return i && typeof i === 'object'; })) {
      v.forEach(function (item, i) { flatten(item, next.concat(String(i + 1)), out); });
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, next, out);
    } else {
      out.push([next, v]);
    }
  });
  return out;
}

function configHtml(data) {
  const groups = {};
  const order = [];
  flatten(data.config || {}, [], []).forEach(function (e) {
    const p = e[0];
    const g = p.length > 1 ? p[0] : 'general';
    const label = p.length > 1 ? p.slice(1).join('.') : p[0];
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(rowHtml(label, valHtml(e[1], label)));
  });
  return order.map(function (g) {
    return '<div class="group-title">' + esc(g) + '</div><div class="rows">' + groups[g].join('') + '</div>';
  }).join('');
}

function detailRows(data) {
  const s = data.server || {};
  const a = data.account || {};
  const cut = function (t) { t = String(t); return t.length > 160 ? t.slice(0, 160) + '…' : t; };
  return [
    ['Account Type', a.type],
    ['Reconnect Attempts', data.reconnectAttempts],
    ['Server Reachable', s.online === true ? 'Yes' : s.online === false ? 'No' : 'Unknown'],
    ['Last Server Check', s.checkedAt ? fmtTime(s.checkedAt) : '-'],
    ['Failed Checks', s.maxChecks != null ? (s.failedChecks || 0) + '/' + s.maxChecks : '-'],
    ['Last Disconnect', data.lastDisconnect ? cut(data.lastDisconnect.reason) + ' (' + fmtTime(data.lastDisconnect.at) + ')' : '-'],
    ['Last Kick', data.lastKick ? cut(data.lastKick.reason) + ' (' + fmtTime(data.lastKick.at) + ')' : '-']
  ];
}

function playerRows(data) {
  const p = data.player;
  if (!p) return [['Status', 'Bot is not in the server']];
  return [
    ['Position', p.position ? p.position.join(', ') : '-'],
    ['Health', p.health != null ? p.health + '/20' : '-'],
    ['Food', p.food != null ? p.food + '/20' : '-'],
    ['Latency', p.latency != null ? p.latency + ' ms' : '-'],
    ['Dimension', p.dimension],
    ['Players Online', p.playersOnline]
  ];
}

/* Shared helpers: used here for SSR and copied as source into the page script, so both always agree. */
function fmtDuration(s) {
  if (s === null || s === undefined || !Number.isFinite(Number(s))) return '-';
  s = Math.max(0, Math.floor(Number(s)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + r + 's' : r + 's';
}

function statusView(data) {
  const s = data && data.status;
  if (s === 'connected') return { cls: 'online', label: 'Online', icon: 'fa-circle-stop', stop: true };
  if (s === 'disconnected') return { cls: 'starting', label: 'Connecting', icon: 'fa-clock', stop: true };
  return { cls: 'offline', label: 'Offline', icon: 'fa-circle-stop', stop: false };
}

function logParts(line) {
  line = String(line);
  const m = line.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s+(.*)$/);
  let time = '';
  let text = line;
  if (m) {
    const d = new Date(m[1]);
    time = '[' + (isNaN(d.getTime()) ? m[1] : d.toTimeString().slice(0, 8)) + '] ';
    text = m[2];
  }
  let cls = '';
  if (/^\[(Fatal|Kick|Cleanup)\]|\b(error|failed)\b/i.test(text)) cls = 'log-error';
  else if (/^\[Watch\]|^\[Bot\] No spawn|\bwarn/i.test(text)) cls = 'log-warning';
  return { time, text, cls };
}

const CSS = `
:root{--header:#2b3942;--header-light:#46535c;--bg:#f0f0f0;--text:#35414a;--blue:#328acb;--green:#20ce91;--red:#f52250;--amber:#e8a93b;--border:#d5dadd}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Play',sans-serif;padding-top:calc(66px + env(safe-area-inset-top,0px));padding-bottom:24px}
button,textarea{font:inherit}
button{cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
svg{width:21px;height:21px;flex-shrink:0}
[hidden]{display:none!important}

header{position:fixed;top:0;left:0;width:100%;z-index:100;background:var(--header);color:#fff;box-shadow:0 2px 5px #0002;padding-top:env(safe-area-inset-top,0px)}
.header-inner{max-width:1000px;height:56px;padding:0 8px 0 18px;margin:auto;display:flex;align-items:center;justify-content:space-between;font-size:26px;font-weight:700;letter-spacing:.5px}
.tabs{display:flex;gap:2px;height:100%;font-size:15px;letter-spacing:0}
.tab{background:transparent;color:#bdc7cd;border:0;border-bottom:3px solid transparent;height:100%;padding:0 10px;font-size:14px;font-weight:700}
.tab svg{vertical-align:middle;margin-right:4px;width:15px;height:15px}
.tab.active{color:#fff;border-bottom-color:var(--green)}

.container{width:100%;max-width:1000px;margin:auto;padding:0 16px}
.page-title{color:var(--blue);font-size:32px;margin:18px 0 13px}

.server-hero{background:var(--header);color:#fff;text-align:center;margin:0 -16px;padding:22px 16px}
.server-address{font-size:24px;font-weight:700;overflow-wrap:anywhere}

.status{margin:0 -16px;padding:13px;display:flex;align-items:center;justify-content:center;gap:10px;background:var(--red);color:#fff;font-size:25px;font-weight:700}
.status.online{background:var(--green)}
.status.starting{background:var(--amber)}
.status.offline{background:var(--red)}
.status i{font-size:22px}

.actions{margin:14px 0 0;display:flex;justify-content:center}
.start-btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-width:100px;background:var(--green);color:#fff;border:0;border-radius:3px;padding:11px 24px;font-size:18px;font-weight:700}
.start-btn.stop{background:var(--red)}
.start-btn i{font-size:18px}

.section{margin:20px 0}
.section-title{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;background:var(--blue);color:#fff;font-size:15px;font-weight:700;border-radius:3px 3px 0 0}
.section-title i{font-size:14px}
.rows{border-radius:0 3px 3px 3px;overflow:hidden}
.section-content{background:var(--header);color:#fff;border-radius:0 3px 3px 3px;min-height:44px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:9px;overflow-wrap:anywhere;font-size:16px;font-weight:700}
.copy-btn{display:inline-flex;align-items:center;gap:5px;background:var(--blue);color:#fff;border:0;border-radius:3px;padding:9px 13px;font-size:12px;font-weight:700;flex-shrink:0}
.copy-btn i{font-size:13px}

.config-row{background:var(--header);color:#fff;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px;font-weight:700;border-bottom:1px solid #ffffff17;overflow-wrap:anywhere}
.config-row:last-child{border-bottom:0}
.aternos-switch{width:58px;height:28px;padding:2px;flex-shrink:0;display:flex;align-items:center;background:#293740;border:1px solid #3b4953;border-radius:3px;pointer-events:none;user-select:none}
.aternos-switch.enabled{justify-content:flex-end}
.aternos-switch.disabled{justify-content:flex-start}
.switch-icon{width:24px;height:24px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;font-weight:900;line-height:1;border-radius:2px}
.enabled .switch-icon{background:#20c997}
.disabled .switch-icon{background:#f21d50}

.group-title{margin-top:12px;padding:6px 12px;background:var(--header-light);color:#fff;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-radius:3px 3px 0 0}
.group-title:first-child{margin-top:0}
.message{min-height:20px;text-align:center;color:#68747c;font-size:14px;margin:11px 0}

.log-heading{display:flex;justify-content:space-between;align-items:center;padding:17px 0 13px}
.log-heading h1{color:var(--blue);font-size:34px;margin:0}
.log-toolbar{display:flex;gap:8px;margin:0 0 12px;flex-wrap:wrap}
.toolbar-btn{display:inline-flex;align-items:center;gap:6px;background:var(--header-light);color:#fff;border:0;border-radius:3px;padding:8px 11px;font-size:14px;font-weight:700}
.console{background:var(--header);color:#edf0f2;margin:0 -16px;padding:15px 14px;height:calc(100dvh - 220px);min-height:220px;max-height:700px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:#687983 var(--header);font:13px/1.55 'Roboto Mono',monospace;overflow-wrap:anywhere}
.console-row{margin-bottom:3px}
.log-time{color:#429be0;font-weight:700}
.log-error{color:#ff7272}
.log-warning{color:#e8b44f}
button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}

@media(max-width:500px){
  .header-inner{font-size:21px;padding-left:14px}
  .tab{padding:0 7px;font-size:13px}
  .server-address{font-size:22px}
  .status{font-size:23px}
  .section-content{font-size:15px}
}
`;

/* Page script, runs in the browser. Receives the first data snapshot from the server. */
function client(init, refreshMs) {
  const $ = (s) => document.querySelector(s);
  let data = init;
  let fetchedAt = Date.now();
  let busy = false;
  let autoScroll = true;
  let mark = null;
  let cfgCache = '';

  const say = (text) => { $('#Message').textContent = text || ''; };

  function paintStatus() {
    const v = statusView(data);
    $('#Status').className = 'status ' + v.cls;
    $('#StatusIcon').className = 'fa-solid ' + v.icon;
    $('#StatusText').textContent = v.label;
    const btn = $('#StartBtn');
    btn.className = 'start-btn' + (v.stop ? ' stop' : '');
    btn.innerHTML = '<i class="fa-solid ' + (v.stop ? 'fa-circle-stop' : 'fa-power-off') + '"></i>' + (v.stop ? 'Stop' : 'Start');
    btn.disabled = busy;
  }

  function paintTimes() {
    const extra = Math.floor((Date.now() - fetchedAt) / 1000);
    $('#tUptime').textContent = fmtDuration(data.uptime + extra);
    $('#tConnected').textContent = data.status === 'connected' && data.connectedFor != null
      ? fmtDuration(data.connectedFor + extra)
      : '-';
  }

  function paintLogs() {
    const all = data.logs || [];
    let list = all;
    if (mark !== null) {
      const i = all.lastIndexOf(mark);
      if (i >= 0) list = all.slice(i + 1);
    }
    const box = $('#Console');
    const stick = autoScroll && box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.replaceChildren(...list.map((line) => {
      const p = logParts(line);
      const row = document.createElement('div');
      row.className = 'console-row';
      const t = document.createElement('span');
      t.className = 'log-time';
      t.textContent = p.time;
      const c = document.createElement('span');
      c.className = p.cls;
      c.textContent = p.text;
      row.append(t, c);
      return row;
    }));
    if (stick) box.scrollTop = box.scrollHeight;
  }

  function paint() {
    const server = data.server || {};
    const host = server.host || 'Unknown';
    $('#ServerAddress').textContent = host;
    $('#Address').textContent = host + ':' + (server.port || 25565);
    $('#tName').textContent = data.name || 'AFK Bot';
    $('#tVersion').textContent = data.version || '-';
    $('#BotUsername').textContent = (data.account && data.account.username) || '-';
    $('#MinecraftVersion').textContent = server.version || '-';
    const on = data.autoReconnect === true;
    const sw = $('#AutoReconnect');
    sw.className = 'aternos-switch ' + (on ? 'enabled' : 'disabled');
    sw.setAttribute('aria-label', 'Auto Reconnect: ' + (on ? 'enabled' : 'disabled'));
    sw.firstElementChild.innerHTML = '<i class="fa-solid ' + (on ? 'fa-check' : 'fa-xmark') + '"></i>';
    $('#BotDetails').innerHTML = rowsHtml(detailRows(data));
    $('#PlayerInfo').innerHTML = rowsHtml(playerRows(data));
    const cfg = configHtml(data);
    if (cfg !== cfgCache) { $('#ConfigGroups').innerHTML = cfg; cfgCache = cfg; }
    paintStatus();
    paintTimes();
    paintLogs();
  }

  async function refresh() {
    try {
      const r = await fetch('/health', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
      fetchedAt = Date.now();
      say('');
      paint();
    } catch (e) {
      say('Cannot reach the bot server.');
    }
  }

  async function toggle() {
    if (busy) return;
    busy = true;
    $('#StartBtn').disabled = true;
    const stopping = statusView(data).stop;
    try {
      const r = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: stopping ? 'disconnect' : 'join' })
      });
      if (!r.ok) throw new Error(r.status);
    } catch (e) {
      say('Could not ' + (stopping ? 'stop' : 'start') + ' the bot.');
    }
    await refresh();
    busy = false;
    paintStatus();
  }

  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    $('#Details').hidden = name !== 'Details';
    $('#Logs').hidden = name !== 'Logs';
    document.querySelectorAll('[data-tab]').forEach((o) => {
      const active = o === tab;
      o.classList.toggle('active', active);
      o.setAttribute('aria-selected', String(active));
    });
    if (name === 'Logs') {
      paintLogs();
      if (autoScroll) $('#Console').scrollTop = $('#Console').scrollHeight;
    }
  }));

  $('#StartBtn').addEventListener('click', toggle);

  $('#CopyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#Address').textContent);
      $('#CopyBtn').innerHTML = '<i class="fa-solid fa-copy"></i>Copied!';
      setTimeout(() => { $('#CopyBtn').innerHTML = '<i class="fa-solid fa-copy"></i>Copy'; }, 1500);
    } catch (e) { say('Could not copy address.'); }
  });

  $('#ShareBtn').addEventListener('click', async () => {
    const text = $('#Console').innerText;
    if (navigator.share) {
      try { await navigator.share({ title: 'AFK Bot Logs', text }); } catch (e) {}
    } else {
      try {
        await navigator.clipboard.writeText(text);
        $('#ShareBtn').innerHTML = '<i class="fa-solid fa-copy"></i>Copied!';
        setTimeout(() => { $('#ShareBtn').innerHTML = '<i class="fa-solid fa-share-from-square"></i>Share'; }, 1500);
      } catch (e) { say('Could not share logs.'); }
    }
  });

  $('#RefreshLogs').addEventListener('click', async () => {
    mark = null;
    await refresh();
    paintLogs();
  });
  $('#ClearLogs').addEventListener('click', () => {
    const all = data.logs || [];
    mark = all.length ? all[all.length - 1] : null;
    paintLogs();
  });
  $('#AutoScroll').addEventListener('click', () => {
    autoScroll = !autoScroll;
    $('#AutoScroll').textContent = 'Auto-scroll: ' + (autoScroll ? 'ON' : 'OFF');
    if (autoScroll) $('#Console').scrollTop = $('#Console').scrollHeight;
  });

  paint();
  setInterval(refresh, refreshMs);
  setInterval(paintTimes, 1000);
}

const TAB_DETAILS = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h15A1.5 1.5 0 0 1 21 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-15ZM7 7v2h10V7H7Zm0 4v2h10v-2H7Zm0 4v2h6v-2H7Z"/></svg>';
const TAB_LOGS = '<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625ZM7.5 15a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 7.5 15Zm.75 2.25a.75.75 0 0 0 0 1.5H12a.75.75 0 0 0 0-1.5H8.25Z" clip-rule="evenodd"/><path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z"/></svg>';

function render(data, options = {}) {
  const refreshMs = Number(options.refreshInterval) > 0 ? Number(options.refreshInterval) : 5000;
  const name = data.name || 'AFK Bot';
  const server = data.server || {};
  const host = server.host || 'Unknown';
  const v = statusView(data);
  const on = data.autoReconnect === true;

  const logRows = (data.logs || []).map((line) => {
    const p = logParts(line);
    return `<div class="console-row"><span class="log-time">${esc(p.time)}</span><span class="${p.cls}">${esc(p.text)}</span></div>`;
  }).join('');

  const connectedFor = data.status === 'connected' ? fmtDuration(data.connectedFor) : '-';
  const init = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2b3942">
<title>${esc(name)} Dashboard</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Play:wght@400;700&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>

<header>
  <div class="header-inner"><span>${esc(String(name).toUpperCase())}</span>
  <div class="tabs" role="tablist">
    <button class="tab active" role="tab" aria-selected="true" data-tab="Details">${TAB_DETAILS}Details</button>
    <button class="tab" role="tab" aria-selected="false" data-tab="Logs">${TAB_LOGS}Logs</button>
  </div>
  </div>
</header>

<main class="container">

<div id="Details">
  <h1 class="page-title">Dashboard</h1>

  <section class="server-hero"><div class="server-address" id="ServerAddress">${esc(host)}</div></section>

  <div class="status ${v.cls}" id="Status">
    <i class="fa-solid ${v.icon}" id="StatusIcon"></i>
    <span id="StatusText">${v.label}</span>
  </div>

  <div class="actions">
    <button class="start-btn${v.stop ? ' stop' : ''}" id="StartBtn"><i class="fa-solid ${v.stop ? 'fa-circle-stop' : 'fa-power-off'}"></i>${v.stop ? 'Stop' : 'Start'}</button>
  </div>

  <section class="section">
    <div class="section-title"><i class="fa-solid fa-plug"></i>Target Server</div>
    <div class="section-content">
      <span id="Address">${esc(host)}:${esc(server.port || 25565)}</span>
      <button class="copy-btn" id="CopyBtn"><i class="fa-solid fa-copy"></i>Copy</button>
    </div>
  </section>

  <section class="section">
    <div class="section-title"><i class="fa-solid fa-circle-info"></i>Bot Information</div>
    <div class="rows" id="BotTiles">
      <div class="config-row"><span>Uptime</span><span id="tUptime">${fmtDuration(data.uptime)}</span></div>
      <div class="config-row"><span>Connected For</span><span id="tConnected">${connectedFor}</span></div>
      <div class="config-row"><span>Bot Name</span><span id="tName">${esc(name)}</span></div>
      <div class="config-row"><span>Bot Version</span><span id="tVersion">${esc(data.version || '-')}</span></div>
    </div>
  </section>

  <section class="section">
    <div class="section-title"><i class="fa-solid fa-server"></i>Bot Details</div>
    <div class="rows" id="BotDetails">${rowsHtml(detailRows(data))}</div>
  </section>

  <section class="section">
    <div class="section-title"><i class="fa-solid fa-user"></i>Player</div>
    <div class="rows" id="PlayerInfo">${rowsHtml(playerRows(data))}</div>
  </section>

  <section class="section">
    <div class="section-title"><i class="fa-solid fa-gears"></i>Bot Configuration</div>
    <div class="rows">
      <div class="config-row"><span>Bot Username</span><span id="BotUsername">${esc((data.account && data.account.username) || '-')}</span></div>
      <div class="config-row"><span>Minecraft Version</span><span id="MinecraftVersion">${esc(server.version || '-')}</span></div>
      <div class="config-row"><span>Platform</span><span id="Platform">Java Edition</span></div>
      <div class="config-row"><span>Auto Reconnect</span><div class="aternos-switch ${on ? 'enabled' : 'disabled'}" id="AutoReconnect" role="img" aria-label="Auto Reconnect: ${on ? 'enabled' : 'disabled'}"><span class="switch-icon"><i class="fa-solid ${on ? 'fa-check' : 'fa-xmark'}"></i></span></div></div>
    </div>
  </section>

  <section class="section">
    <div class="section-title"><i class="fa-solid fa-sliders"></i>Full Configuration</div>
    <div id="ConfigGroups">${configHtml(data)}</div>
  </section>

  <p class="message" id="Message" aria-live="polite"></p>
</div>

<div id="Logs" hidden>
  <div class="log-heading">
    <h1>Logs</h1>
    <button class="copy-btn" id="ShareBtn"><i class="fa-solid fa-share-from-square"></i>Share</button>
  </div>
  <div class="log-toolbar">
    <button class="toolbar-btn" id="RefreshLogs">Refresh</button>
    <button class="toolbar-btn" id="ClearLogs">Clear</button>
    <button class="toolbar-btn" id="AutoScroll">Auto-scroll: ON</button>
  </div>
  <div class="console" id="Console" aria-label="Bot logs">${logRows}</div>
</div>

</main>

<script type="application/json" id="Init">${init}</script>
<script>
${[esc, fmtTime, switchHtml, valHtml, rowHtml, rowsHtml, flatten, configHtml, detailRows, playerRows, fmtDuration, statusView, logParts].map(String).join('\n')}
(${client})(JSON.parse(document.getElementById('Init').textContent), ${refreshMs});
</script>
</body>
</html>`;
}

module.exports = { render };
