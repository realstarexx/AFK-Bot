'use strict';

/*
  Dashboard page (HTML + server-side rendering).
  render(data) takes the object returned by details() in src/index.js and returns the full HTML page.
  The page is already filled in when it arrives, then the script keeps it live through GET /health
  and controls the bot through POST /api ({ "action": "join" | "disconnect" }).
*/

const COLORS = {
  black: '#000000', dark_blue: '#0000AA', dark_green: '#00AA00', dark_aqua: '#00AAAA',
  dark_red: '#AA0000', dark_purple: '#AA00AA', gold: '#FFAA00', gray: '#AAAAAA',
  dark_gray: '#555555', blue: '#5555FF', green: '#55FF55', aqua: '#55FFFF',
  red: '#FF5555', light_purple: '#FF55FF', yellow: '#FFFF55', white: '#FFFFFF',
  pink: '#FFC0CB', hot_pink: '#FF69B4', orange: '#FFA500', coral: '#FF7F50',
  crimson: '#DC143C', lime: '#00FF00', turquoise: '#40E0D0', cyan: '#00FFFF',
  sky_blue: '#87CEEB', royal_blue: '#4169E1', indigo: '#4B0082', violet: '#8A2BE2',
  lavender: '#E6E6FA', brown: '#8B4513', chocolate: '#D2691E', silver: '#C0C0C0',
  bright_gold: '#FFD700', beige: '#F5F5DC'
};

/* Legacy section-sign codes (§c, §l ...) */
const LEGACY = {
  0: 'black', 1: 'dark_blue', 2: 'dark_green', 3: 'dark_aqua', 4: 'dark_red', 5: 'dark_purple',
  6: 'gold', 7: 'gray', 8: 'dark_gray', 9: 'blue', a: 'green', b: 'aqua', c: 'red',
  d: 'light_purple', e: 'yellow', f: 'white'
};

/* Common disconnect messages sent as translation keys */
const LANG = {
  'multiplayer.disconnect.kicked': 'Kicked by an operator',
  'multiplayer.disconnect.banned': 'You are banned from this server',
  'multiplayer.disconnect.banned.reason': 'You are banned from this server.\nReason: %s',
  'multiplayer.disconnect.server_full': 'The server is full!',
  'multiplayer.disconnect.not_whitelisted': 'You are not white-listed on this server!',
  'multiplayer.disconnect.duplicate_login': 'You logged in from another location',
  'multiplayer.disconnect.idling': 'You have been idle for too long!',
  'multiplayer.disconnect.flying': 'Flying is not enabled on this server',
  'multiplayer.disconnect.outdated_client': 'Incompatible client! Please use %s',
  'multiplayer.disconnect.outdated_server': 'Incompatible client! Please use %s',
  'disconnect.timeout': 'Timed out',
  'disconnect.lost': 'Connection Lost',
  'disconnect.quitting': 'Quitting',
  'disconnect.kicked': 'Was kicked from the game'
};

/* ---------- Shared helpers ----------
   Used here for SSR and copied as source into the page script, so both always agree. */

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString();
}

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
  if (s === 'connected') return { cls: 'online', label: 'Online', icon: 'fa-circle-play', stop: true };
  if (s === 'disconnected') return { cls: 'starting', label: 'Connecting', icon: 'fa-clock', stop: true };
  return { cls: 'offline', label: 'Offline', icon: 'fa-circle-stop', stop: false };
}

/* ---------- Tellraw / kick JSON resolver ---------- */

function flag(v, fallback) {
  return v === undefined ? fallback : (v === true || v === 1 || v === '1' || v === 'true');
}

function wrap(html, st) {
  if (!html) return '';
  const css = [];
  if (st.color) css.push('color:' + st.color);
  if (st.bold) css.push('font-weight:700');
  if (st.italic) css.push('font-style:italic');
  const dec = [];
  if (st.underlined) dec.push('underline');
  if (st.strikethrough) dec.push('line-through');
  if (dec.length) css.push('text-decoration:' + dec.join(' '));
  return css.length ? '<span style="' + css.join(';') + '">' + html + '</span>' : html;
}

function legacyHtml(text, st) {
  text = String(text);
  if (text.indexOf('\u00a7') < 0) return wrap(esc(text), st);
  const parts = text.split('\u00a7');
  let cur = Object.assign({}, st);
  let out = wrap(esc(parts[0]), cur);
  for (let i = 1; i < parts.length; i++) {
    const code = parts[i].charAt(0).toLowerCase();
    const rest = parts[i].slice(1);
    if (LEGACY[code]) cur = { color: COLORS[LEGACY[code]] };
    else if (code === 'r') cur = {};
    else if (code === 'l') cur = Object.assign({}, cur, { bold: true });
    else if (code === 'o') cur = Object.assign({}, cur, { italic: true });
    else if (code === 'n') cur = Object.assign({}, cur, { underlined: true });
    else if (code === 'm') cur = Object.assign({}, cur, { strikethrough: true });
    out += wrap(esc(rest), cur);
  }
  return out;
}

function compHtml(node, inh) {
  inh = inh || {};
  if (node == null) return '';
  if (typeof node === 'string') return legacyHtml(node, inh);
  if (typeof node === 'number' || typeof node === 'boolean') return wrap(esc(node), inh);
  if (Array.isArray(node)) return node.map(function (n) { return compHtml(n, inh); }).join('');
  if (typeof node !== 'object') return '';

  let color = inh.color;
  if (node.color !== undefined) {
    const named = COLORS[node.color];
    color = named || (/^#[0-9a-fA-F]{6}$/.test(String(node.color)) ? String(node.color) : inh.color);
  }
  const st = {
    color: color,
    bold: flag(node.bold, inh.bold),
    italic: flag(node.italic, inh.italic),
    underlined: flag(node.underlined, inh.underlined),
    strikethrough: flag(node.strikethrough, inh.strikethrough)
  };

  let own = '';
  if (node.text !== undefined) {
    own = legacyHtml(node.text, st);
  } else if (node.translate !== undefined) {
    const key = String(node.translate);
    const args = (Array.isArray(node.with) ? node.with : []).map(function (a) { return compHtml(nbtToJson(a), st); });
    let n = 0;
    const tpl = esc(LANG[key] || node.fallback || key);
    own = wrap(tpl.replace(/%(?:(\d+)\$)?s/g, function (m, idx) {
      return idx ? (args[Number(idx) - 1] || '') : (args[n++] || '');
    }), st);
  }
  const extra = Array.isArray(node.extra) ? node.extra.map(function (e) { return compHtml(e, st); }).join('') : '';
  return own + extra;
}

/* {"type":"string","value":"text"} (NBT-style) -> plain JSON component */
function nbtToJson(n) {
  if (Array.isArray(n)) return n.map(nbtToJson);
  if (!n || typeof n !== 'object') return n;
  if (typeof n.type === 'string' && 'value' in n) {
    const v = n.value;
    if (n.type === 'compound') {
      const o = {};
      Object.keys(v || {}).forEach(function (k) { o[k] = nbtToJson(v[k]); });
      return o;
    }
    if (n.type === 'list') {
      if (v && typeof v === 'object' && Array.isArray(v.value)) {
        return v.value.map(function (item) {
          if (v.type === 'compound' && item && typeof item === 'object') {
            const o = {};
            Object.keys(item).forEach(function (k) { o[k] = nbtToJson(item[k]); });
            return o;
          }
          return item;
        });
      }
      return [];
    }
    return v;
  }
  return n;
}

/* A stored kick / disconnect reason: JSON component, NBT-style JSON or plain text */
function reasonHtml(reason) {
  const t = String(reason == null ? '' : reason);
  let parsed;
  try { parsed = JSON.parse(t); } catch (e) { return legacyHtml(t, {}); }
  return compHtml(nbtToJson(parsed), {}) || esc(t);
}

/* Log text that contains a JSON component after some prefix, e.g. "[Kick] {...}" */
function richInline(text) {
  const i = text.indexOf('{');
  if (i < 0) return null;
  let parsed;
  try { parsed = JSON.parse(text.slice(i)); } catch (e) { return null; }
  const html = compHtml(nbtToJson(parsed), {});
  return html ? esc(text.slice(0, i)) + html : null;
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

function logRowHtml(line) {
  const p = logParts(line);
  const body = richInline(p.text) || esc(p.text);
  return '<div class="console-row"><span class="log-time">' + esc(p.time) + '</span><span class="' + p.cls + '">' + body + '</span></div>';
}

/* ---------- Rows ---------- */

function switchHtml(on, label) {
  return '<div class="aternos-switch ' + (on ? 'enabled' : 'disabled') + '" role="img" aria-label="' + esc(label) + ': ' + (on ? 'enabled' : 'disabled') + '"><span class="switch-icon"><i class="fa-solid ' + (on ? 'fa-check' : 'fa-xmark') + '"></i></span></div>';
}

function valHtml(v, label) {
  if (typeof v === 'boolean') return switchHtml(v, label);
  if (v === null || v === undefined || v === '') return '<span>-</span>';
  if (typeof v === 'object' && !Array.isArray(v) && v.html !== undefined) return '<span class="rich">' + v.html + '</span>';
  if (Array.isArray(v)) return '<span>' + (v.length ? esc(v.join(', ')) : '-') + '</span>';
  return '<span>' + esc(v) + '</span>';
}

function rowHtml(label, valueHtml) {
  return '<div class="config-row"><span>' + esc(label) + '</span>' + valueHtml + '</div>';
}

function rowsHtml(rows) {
  return rows.map(function (r) { return rowHtml(r[0], valHtml(r[1], r[0])); }).join('');
}

function detailRows(data) {
  const s = data.server || {};
  const a = data.account || {};
  return [
    ['Account Type', a.type],
    ['Reconnect Attempts', data.reconnectAttempts],
    ['Server Reachable', s.online === true ? 'Yes' : s.online === false ? 'No' : 'Unknown'],
    ['Last Server Check', s.checkedAt ? fmtTime(s.checkedAt) : '-'],
    ['Failed Checks', s.maxChecks != null ? (s.failedChecks || 0) + '/' + s.maxChecks : '-'],
    ['Last Disconnect', data.lastDisconnect ? { html: reasonHtml(data.lastDisconnect.reason) + esc(' (' + fmtTime(data.lastDisconnect.at) + ')') } : '-'],
    ['Last Kick', data.lastKick ? { html: reasonHtml(data.lastKick.reason) + esc(' (' + fmtTime(data.lastKick.at) + ')') } : '-']
  ];
}

/* Bot configuration + player in one section */
function botInfoRows(data) {
  const s = data.server || {};
  const p = data.player;
  const rows = [
    ['Bot Username', (data.account && data.account.username) || '-'],
    ['Minecraft Version', s.version || '-'],
    ['Platform', 'Java Edition'],
    ['Auto Reconnect', data.autoReconnect === true]
  ];
  if (!p) return rows.concat([['Status', 'Bot is not in the server']]);
  return rows.concat([
    ['Position', p.position ? p.position.join(', ') : '-'],
    ['Health', p.health != null ? p.health + '/20' : '-'],
    ['Food', p.food != null ? p.food + '/20' : '-'],
    ['Latency', p.latency != null ? p.latency + ' ms' : '-'],
    ['Dimension', p.dimension],
    ['Players Online', p.playersOnline]
  ]);
}

/* ---------- bot.properties (full configuration, flat, switches first) ---------- */

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

function propHtml(item) {
  const shown = Array.isArray(item.value) ? item.value.join(', ') : (item.value == null ? '' : String(item.value));
  const control = typeof item.value === 'boolean'
    ? switchHtml(item.value, item.label)
    : '<div class="prop-opt">' + (shown ? esc(shown) : '-') + '</div>';
  return '<div class="prop"><div class="prop-card"><span class="prop-label">' + esc(item.label) + '</span>' + control + '</div>'
    + '<div class="prop-key"><b>' + esc(item.key) + '</b>=' + esc(shown) + '</div></div>';
}

function propsHtml(data) {
  const items = flatten(data.config || {}, [], []).map(function (e) {
    return {
      key: e[0].join('.'),
      label: e[0].join(' ').replace(/[-_]/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }),
      value: e[1]
    };
  });
  const switches = items.filter(function (i) { return typeof i.value === 'boolean'; });
  const others = items.filter(function (i) { return typeof i.value !== 'boolean'; });
  return switches.concat(others).map(propHtml).join('');
}

const CSS = `
:root{--header:#2b3942;--header-light:#46535c;--bg:#f0f0f0;--text:#35414a;--blue:#328acb;--green:#20ce91;--red:#f52250;--amber:#e8a93b;--border:#d5dadd;--props-bg:#2f3d47}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Play',sans-serif;padding-top:calc(66px + env(safe-area-inset-top,0px));padding-bottom:24px}
body.on-props{background:var(--props-bg)}
body.on-log{padding-bottom:0}
button,textarea{font:inherit}
button{cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
svg{width:21px;height:21px;flex-shrink:0}
a{color:inherit}
[hidden]{display:none!important}

header{position:fixed;top:0;left:0;width:100%;z-index:100;background:var(--header);color:#fff;box-shadow:0 2px 5px #0002;padding-top:env(safe-area-inset-top,0px)}
.header-inner{max-width:1000px;height:56px;padding:0 8px 0 18px;margin:auto;display:flex;align-items:center;justify-content:space-between;font-size:26px;font-weight:700;letter-spacing:.5px}
.header-inner>span{min-width:0;margin-right:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tabs{display:flex;gap:2px;height:100%;font-size:15px;letter-spacing:0;flex-shrink:0}
.tab{background:transparent;color:#bdc7cd;border:0;border-bottom:3px solid transparent;height:100%;padding:0 10px;font-size:14px;font-weight:700;white-space:nowrap}
.tab svg{vertical-align:middle;margin-right:4px;width:15px;height:15px}
.tab i{margin-right:4px;font-size:13px}
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
.config-row>span:last-child{min-width:0;text-align:right}
.rich{white-space:pre-wrap}
.aternos-switch{width:58px;height:28px;padding:2px;flex-shrink:0;display:flex;align-items:center;background:#293740;border:1px solid #3b4953;border-radius:3px;pointer-events:none;user-select:none}
.aternos-switch.enabled{justify-content:flex-end}
.aternos-switch.disabled{justify-content:flex-start}
.switch-icon{width:24px;height:24px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;font-weight:900;line-height:1;border-radius:2px}
.enabled .switch-icon{background:#20c997}
.disabled .switch-icon{background:#f21d50}

.message{min-height:20px;text-align:center;color:#68747c;font-size:14px;margin:11px 0}
.powered{margin:18px 0 0;text-align:center;font-size:13px;color:#77838b}
.powered a{text-decoration:none}
.powered b{color:var(--blue)}

/* bot.properties */
.props{padding:18px 0 8px}
.props-title{display:flex;align-items:center;gap:12px;color:#fff;font-size:26px;font-weight:700;margin:0 0 20px}
.props-title i{font-size:24px}
.prop{margin-bottom:18px}
.prop-card{background:#efefef;color:var(--text);padding:10px 12px;min-height:54px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-radius:3px 3px 0 0}
.prop-label{font-size:16px;font-weight:700;min-width:0;overflow-wrap:anywhere}
.prop-opt{background:#2b3741;color:#fff;font-size:14px;font-weight:700;padding:10px 12px;border-radius:3px;min-width:90px;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prop-key{background:#252e36;color:#aab4bb;padding:8px 12px;font:12.5px/1.5 'Roboto Mono',monospace;overflow-wrap:anywhere;border-radius:0 0 3px 3px}
.prop-key b{color:#cdd5da}

/* log */
.log-heading{display:flex;justify-content:space-between;align-items:center;padding:17px 0 13px}
.log-heading h1{color:var(--blue);font-size:34px;margin:0}
.log-toolbar{display:flex;gap:8px;margin:0 0 12px;flex-wrap:wrap}
.toolbar-btn{display:inline-flex;align-items:center;gap:6px;background:var(--header-light);color:#fff;border:0;border-radius:3px;padding:8px 11px;font-size:14px;font-weight:700}
.console{background:var(--header);color:#edf0f2;margin:0 -16px;padding:15px 14px;height:calc(100dvh - 220px);min-height:220px;max-height:700px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:#687983 var(--header);font:300 11px/1.6 'Roboto Mono',monospace;overflow-wrap:anywhere}
.console-row{margin-bottom:3px;white-space:pre-wrap}
.log-time{color:#429be0;font-weight:400}
.log-error{color:#ff7272}
.log-warning{color:#e8b44f}
button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}

@media(max-width:700px){
  #Log{display:flex;flex-direction:column;min-height:calc(100dvh - 66px - env(safe-area-inset-top,0px))}
  #Log[hidden]{display:none}
  #Log .console{flex:1;height:auto;max-height:none;margin-bottom:0;padding-bottom:calc(15px + env(safe-area-inset-bottom,0px))}
}
@media(max-width:500px){
  .header-inner{font-size:18px;padding-left:12px}
  .tab{padding:0 6px;font-size:12px}
  .server-address{font-size:22px}
  .status{font-size:23px}
  .section-content{font-size:15px}
}
@media(max-width:400px){.tab svg,.tab i{display:none}}
`;

/* Page script, runs in the browser. Receives the first data snapshot from the server. */
function client(init, refreshMs) {
  const $ = (s) => document.querySelector(s);
  let data = init;
  let fetchedAt = Date.now();
  let busy = false;
  let autoScroll = true;
  let mark = null;
  let propsCache = '';

  const say = (text) => { $('#Message').textContent = text || ''; };

  function paintStatus() {
    const v = statusView(data);
    $('#Status').className = 'status ' + v.cls;
    $('#StatusIcon').className = 'fa-solid ' + v.icon;
    $('#StatusText').textContent = v.label;
    const btn = $('#StartBtn');
    btn.className = 'start-btn' + (v.stop ? ' stop' : '');
    btn.innerHTML = '<i class="fa-solid ' + (v.stop ? 'fa-stop' : 'fa-power-off') + '"></i>' + (v.stop ? 'Stop' : 'Start');
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
    box.innerHTML = list.map(logRowHtml).join('');
    if (stick) box.scrollTop = box.scrollHeight;
  }

  function paint() {
    const server = data.server || {};
    const host = server.host || 'Unknown';
    $('#ServerAddress').textContent = host;
    $('#Address').textContent = host + ':' + (server.port || 25565);
    $('#tName').textContent = data.name || 'AFK Bot';
    $('#tVersion').textContent = data.version || '-';
    $('#BotDetails').innerHTML = rowsHtml(detailRows(data));
    $('#BotInfo').innerHTML = rowsHtml(botInfoRows(data));
    const props = propsHtml(data);
    if (props !== propsCache) { $('#PropsList').innerHTML = props; propsCache = props; }
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
    const stopping = statusView(data).stop;
    if (!confirm(stopping ? 'Stop the bot?' : 'Start the bot?')) return;
    busy = true;
    $('#StartBtn').disabled = true;
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
    ['Dashboard', 'Props', 'Log'].forEach((n) => { $('#' + n).hidden = n !== name; });
    document.body.classList.toggle('on-props', name === 'Props');
    document.body.classList.toggle('on-log', name === 'Log');
    document.querySelectorAll('[data-tab]').forEach((o) => {
      const active = o === tab;
      o.classList.toggle('active', active);
      o.setAttribute('aria-selected', String(active));
    });
    if (name === 'Log') {
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
      try { await navigator.share({ title: 'AFK Bot Log', text }); } catch (e) {}
    } else {
      try {
        await navigator.clipboard.writeText(text);
        $('#ShareBtn').innerHTML = '<i class="fa-solid fa-copy"></i>Copied!';
        setTimeout(() => { $('#ShareBtn').innerHTML = '<i class="fa-solid fa-share-from-square"></i>Share'; }, 1500);
      } catch (e) { say('Could not share log.'); }
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

const TAB_DASHBOARD = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h15A1.5 1.5 0 0 1 21 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-15ZM7 7v2h10V7H7Zm0 4v2h10v-2H7Zm0 4v2h6v-2H7Z"/></svg>';
const TAB_LOG = '<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625ZM7.5 15a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 7.5 15Zm.75 2.25a.75.75 0 0 0 0 1.5H12a.75.75 0 0 0 0-1.5H8.25Z" clip-rule="evenodd"/><path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z"/></svg>';

const SHARED = [
  esc, fmtTime, fmtDuration, statusView, flag, wrap, legacyHtml, compHtml, nbtToJson, reasonHtml,
  richInline, logParts, logRowHtml, switchHtml, valHtml, rowHtml, rowsHtml, detailRows, botInfoRows,
  flatten, propHtml, propsHtml
].map(String).join('\n');

function render(data, options = {}) {
  const refreshMs = Number(options.refreshInterval) > 0 ? Number(options.refreshInterval) : 5000;
  const name = data.name || 'AFK Bot';
  const server = data.server || {};
  const host = server.host || 'Unknown';
  const v = statusView(data);

  const logRows = (data.logs || []).map(logRowHtml).join('');
  const connectedFor = data.status === 'connected' ? fmtDuration(data.connectedFor) : '-';
  const init = JSON.stringify(data).replace(/</g, '\\u003c');
  const prelude = `const COLORS=${JSON.stringify(COLORS)};const LEGACY=${JSON.stringify(LEGACY)};const LANG=${JSON.stringify(LANG)};`;

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
<link href="https://fonts.googleapis.com/css2?family=Play:wght@400;700&family=Roboto+Mono:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>

<header>
  <div class="header-inner"><span>${esc(String(name).toUpperCase())}</span>
  <div class="tabs" role="tablist">
    <button class="tab active" role="tab" aria-selected="true" data-tab="Dashboard">${TAB_DASHBOARD}Dashboard</button>
    <button class="tab" role="tab" aria-selected="false" data-tab="Props"><i class="fa-solid fa-file-code"></i>bot.properties</button>
    <button class="tab" role="tab" aria-selected="false" data-tab="Log">${TAB_LOG}Log</button>
  </div>
  </div>
</header>

<main class="container">

<div id="Dashboard">
  <h1 class="page-title">Dashboard</h1>

  <section class="server-hero"><div class="server-address" id="ServerAddress">${esc(host)}</div></section>

  <div class="status ${v.cls}" id="Status">
    <i class="fa-solid ${v.icon}" id="StatusIcon"></i>
    <span id="StatusText">${v.label}</span>
  </div>

  <div class="actions">
    <button class="start-btn${v.stop ? ' stop' : ''}" id="StartBtn"><i class="fa-solid ${v.stop ? 'fa-stop' : 'fa-power-off'}"></i>${v.stop ? 'Stop' : 'Start'}</button>
  </div>

  <section class="section">
    <div class="section-title"><i class="fa-solid fa-plug"></i>Address</div>
    <div class="section-content">
      <span id="Address">${esc(host)}:${esc(server.port || 25565)}</span>
      <button class="copy-btn" id="CopyBtn"><i class="fa-solid fa-copy"></i>Copy</button>
    </div>
  </section>

  <section class="section">
    <div class="section-title"><i class="fa-solid fa-circle-info"></i>Software Information</div>
    <div class="rows">
      <div class="config-row"><span>Uptime</span><span id="tUptime">${fmtDuration(data.uptime)}</span></div>
      <div class="config-row"><span>Connected For</span><span id="tConnected">${connectedFor}</span></div>
      <div class="config-row"><span>App Name</span><span id="tName">${esc(name)}</span></div>
      <div class="config-row"><span>App Version</span><span id="tVersion">${esc(data.version || '-')}</span></div>
    </div>
  </section>

  <section class="section">
    <div class="section-title"><i class="fa-solid fa-server"></i>Runtime Details</div>
    <div class="rows" id="BotDetails">${rowsHtml(detailRows(data))}</div>
  </section>

  <section class="section">
    <div class="section-title"><i class="fa-solid fa-robot"></i>Bot Information</div>
    <div class="rows" id="BotInfo">${rowsHtml(botInfoRows(data))}</div>
  </section>

  <p class="message" id="Message" aria-live="polite"></p>

  <p class="powered"><a href="https://github.com/realstarexx/AFK-Bot" target="_blank" rel="noopener noreferrer">Powered by <b>Starexx</b></a></p>
</div>

<div id="Props" hidden>
  <div class="props">
    <h1 class="props-title"><i class="fa-solid fa-file-code"></i>bot.properties</h1>
    <div id="PropsList">${propsHtml(data)}</div>
  </div>
</div>

<div id="Log" hidden>
  <div class="log-heading">
    <h1>Log</h1>
    <button class="copy-btn" id="ShareBtn"><i class="fa-solid fa-share-from-square"></i>Share</button>
  </div>
  <div class="log-toolbar">
    <button class="toolbar-btn" id="RefreshLogs">Refresh</button>
    <button class="toolbar-btn" id="ClearLogs">Clear</button>
    <button class="toolbar-btn" id="AutoScroll">Auto-scroll: ON</button>
  </div>
  <div class="console" id="Console" aria-label="Bot log">${logRows}</div>
</div>

</main>

<script type="application/json" id="Init">${init}</script>
<script>
${prelude}
${SHARED}
(${client})(JSON.parse(document.getElementById('Init').textContent), ${refreshMs});
</script>
</body>
</html>`;
}

module.exports = { render };
