const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const readline = require('readline');
const yaml = require('js-yaml');
const mineflayer = require('mineflayer');
const minecraftData = require('minecraft-data');
const { ping } = require('minecraft-protocol');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const setupRejoin = require('./rejoin');
const dashboardPage = require('./web/main');
const pkg = require('../package.json');
function applyEnvFlags(node, trail = []) {
  for (const [key, value] of Object.entries(node)) {
    const next = [...trail, key];
    if (typeof value === 'boolean') {
      const raw = (process.env[next.join('_').replace(/-/g, '_').toUpperCase()] || '').toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(raw)) node[key] = true;
      else if (['false', '0', 'no', 'off'].includes(raw)) node[key] = false;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      applyEnvFlags(value, next);
    }
  }
}

function collectFlags(node, trail = [], out = {}) {
  for (const [key, value] of Object.entries(node)) {
    const next = [...trail, key];
    if (typeof value === 'boolean') out[next.join('.')] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) collectFlags(value, next, out);
  }
  return out;
}

const KEYS = {
  name: 'name',
  accounts: 'accounts',
  serverHost: 'server.host',
  serverPort: 'server.port',
  serverVersion: 'server.version',
  serverViewDistance: 'server.view-distance',
  serverConnectTimeout: 'server.connect-timeout',
  serverKeepaliveTimeout: 'server.keepalive-timeout',
  dashboardHost: 'dashboard.host',
  dashboardPort: 'dashboard.port',
  dashboardRefreshInterval: 'dashboard.refresh-interval',
  dashboardSelfPingInterval: 'dashboard.self-ping-interval',
  positionEnabled: 'position.enabled',
  positionX: 'position.x',
  positionY: 'position.y',
  positionZ: 'position.z',
  startupCommandsDelay: 'startup-commands.delay',
  startupCommandsGap: 'startup-commands.gap',
  startupCommandsList: 'startup-commands.list',
  autoAuthEnabled: 'utils.auto-auth.enabled',
  autoAuthPassword: 'utils.auto-auth.password',
  autoAuthRegisterTrigger: 'utils.auto-auth.register-trigger',
  autoAuthLoginTrigger: 'utils.auto-auth.login-trigger',
  autoAuthRegisterCommand: 'utils.auto-auth.register-command',
  autoAuthLoginCommand: 'utils.auto-auth.login-command',
  antiAfkEnabled: 'utils.anti-afk.enabled',
  antiAfkSneak: 'utils.anti-afk.sneak',
  antiAfkInterval: 'utils.anti-afk.interval',
  antiAfkJumpDuration: 'utils.anti-afk.jump-duration',
  antiAfkJjumpDuration: 'utils.anti-afk.jump-duration',
  chatLog: 'utils.chat-log',
  autoReconnect: 'utils.auto-reconnect',
  autoReconnectDelay: 'utils.auto-reconnect-delay',
  maxReconnectDelay: 'utils.max-reconnect-delay',
  reconnectBackoffStep: 'utils.reconnect-backoff-step',
  serverWatchEnabled: 'utils.server-watch.enabled',
  serverWatchInterval: 'utils.server-watch.interval',
  serverWatchTimeout: 'utils.server-watch.timeout',
  serverWatchMaxTries: 'utils.server-watch.max-tries',
  serverWatchOfflinePattern: 'utils.server-watch.offline-pattern',
  periodicRejoinEnabled: 'utils.periodic-rejoin.enabled',
  periodicRejoinMinInterval: 'utils.periodic-rejoin.min-interval',
  periodicRejoinMaxInterval: 'utils.periodic-rejoin.max-interval',
  periodicRejoinReason: 'utils.periodic-rejoin.reason',
  circleWalkEnabled: 'movement.circle-walk.enabled',
  circleWalkRadius: 'movement.circle-walk.radius',
  circleWalkSpeed: 'movement.circle-walk.speed',
  circleWalkAngleStep: 'movement.circle-walk.angle-step',
  lookAroundEnabled: 'movement.look-around.enabled',
  lookAroundInterval: 'movement.look-around.interval',
  lookAroundPitchRange: 'movement.look-around.pitch-range',
  randomJumpEnabled: 'movement.random-jump.enabled',
  randomJumpInterval: 'movement.random-jump.interval',
  randomJumpDuration: 'movement.random-jump.jump-duration',
  modulesAvoidMobs: 'modules.avoid-mobs',
  modulesCombat: 'modules.combat',
  modulesBeds: 'modules.beds',
  modulesChat: 'modules.chat',
  avoidMobsSafeDistance: 'avoid-mobs.safe-distance',
  avoidMobsInterval: 'avoid-mobs.interval',
  avoidMobsBackDuration: 'avoid-mobs.back-duration',
  combatAttackMobs: 'combat.attack-mobs',
  combatAttackRange: 'combat.attack-range',
  combatAttackInterval: 'combat.attack-interval',
  combatAutoEat: 'combat.auto-eat',
  combatEatBelow: 'combat.eat-below',
  bedsNightStart: 'beds.night-start',
  bedsNightEnd: 'beds.night-end',
  bedsSearchDistance: 'beds.search-distance',
  bedsInterval: 'beds.interval',
  chatRespond: 'chat.respond',
  chatGreetings: 'chat.greetings',
  chatReply: 'chat.reply',
  discordEnabled: 'discord.enabled',
  discordWebhook: 'discord.webhook',
  discordEventsConnect: 'discord.events.connect',
  discordEventsDisconnect: 'discord.events.disconnect',
  discordColorsConnect: 'discord.colors.connect',
  discordColorsDisconnect: 'discord.colors.disconnect'
};

function nest(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!Object.hasOwn(KEYS, key)) {
      console.warn(`[Config] Unknown key ignored: ${key}`);
      continue;
    }
    const parts = KEYS[key].split('.');
    const last = parts.pop();
    let node = out;
    for (const part of parts) node = node[part] ??= {};
    node[last] = value;
  }
  return out;
}

function pick(node, dotted) {
  return dotted.split('.').reduce((cur, part) => (cur == null ? cur : cur[part]), node);
}

const rawConfig = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'config.yml'), 'utf8'));
const config = nest(rawConfig);
applyEnvFlags(config);
const features = collectFlags(config);
const { server, dashboard, position, utils, movement, modules, combat, beds, chat, discord } = config;
const avoid = config['avoid-mobs'];
const startup = config['startup-commands'];
const watch = utils['server-watch'];
const maxChecks = watch['max-tries'] ?? 30;
const checkInterval = watch.interval ?? 300000;
const offlinePattern = new RegExp(watch['offline-pattern'], 'i');
const greeting = new RegExp(`\\b(${chat.greetings.join('|')})\\b`, 'i');
const account = config.accounts && config.accounts[0];

if (!account || !account.username) {
  console.error('[Config] config.yml needs at least one account with a username');
  process.exit(1);
}

const PORT = process.env.PORT || dashboard.port;
const serverHost = process.env.SERVER_HOST || server.host;
const serverPort = Number(process.env.SERVER_PORT) || server.port;
const LOG_LIMIT = 100;
const MAX_BODY = 1024;
const state = {
  connected: false,
  paused: false,
  startedAt: Date.now(),
  connectedAt: null,
  attempts: 0,
  serverOnline: null,
  serverCheckedAt: null,
  failedChecks: 0,
  lastDisconnect: null,
  lastKick: null
};
const logs = [];
const sockets = new Set();
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

let bot = null;
let timers = [];
let reconnectTimer = null;
let reconnectGen = 0;
let connectTimer = null;

const log = (tag, message) => {
  const line = `[${tag}] ${message}`;
  console.log(line);
  const stored = `${new Date().toISOString()} ${line.slice(0, 500)}`;
  logs.push(stored);
  if (logs.length > LOG_LIMIT) logs.shift();
  if (sockets.size) {
    sendAll(JSON.stringify({ type: 'log', line: stored }));
    pushState();
  }
};
const uptime = () => Math.floor((Date.now() - state.startedAt) / 1000);
const round = (value) => Math.round(value * 10) / 10;
const span = (ms) => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${total % 60}s` : `${total}s`;
};

function sendJson(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

const MASK = '********';

function publicConfig() {
  const copy = {};
  for (const key of Object.keys(rawConfig)) {
    const value = Object.hasOwn(KEYS, key) ? pick(config, KEYS[key]) : rawConfig[key];
    copy[key] = JSON.parse(JSON.stringify(value ?? null));
  }
  if ('serverHost' in copy) copy.serverHost = serverHost;
  if ('serverPort' in copy) copy.serverPort = serverPort;
  if ('dashboardPort' in copy) copy.dashboardPort = Number(PORT);
  (copy.accounts || []).forEach((entry) => { if (entry.password) entry.password = MASK; });
  if ('autoAuthPassword' in copy) copy.autoAuthPassword = (process.env.AUTH_PASSWORD || copy.autoAuthPassword) ? MASK : '';
  if ('discordWebhook' in copy) copy.discordWebhook = (process.env.DISCORD_WEBHOOK_URL || copy.discordWebhook) ? MASK : '';
  return copy;
}

const shownConfig = publicConfig();

function sendHtml(res, code, html, head) {
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  res.end(head ? undefined : html);
}

function currentStatus() {
  if (state.paused) return 'stopped';
  return state.connected ? 'connected' : 'disconnected';
}

function liveState() {
  const live = bot && state.connected ? bot : null;
  const pos = live && live.entity ? live.entity.position : null;
  return {
    status: currentStatus(),
    startedAt: state.startedAt,
    connectedAt: state.connectedAt,
    reconnectAttempts: state.attempts,
    server: {
      online: state.serverOnline,
      checkedAt: state.serverCheckedAt,
      failedChecks: state.failedChecks,
      maxChecks
    },
    player: live ? {
      position: pos ? [round(pos.x), round(pos.y), round(pos.z)] : null,
      health: live.health,
      food: live.food,
      latency: live.player ? live.player.ping : null,
      dimension: live.game ? live.game.dimension : null,
      playersOnline: Object.keys(live.players).length
    } : null,
    lastDisconnect: state.lastDisconnect,
    lastKick: state.lastKick
  };
}

function details() {
  const live = liveState();
  return {
    name: config.name,
    version: pkg.version,
    now: Date.now(),
    ...live,
    account: { username: account.username, type: account.type },
    server: { host: serverHost, port: serverPort, version: server.version, ...live.server },
    autoReconnect: !!utils['auto-reconnect'],
    config: shownConfig,
    features,
    logs
  };
}

function wsFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const size = body.length;
  let head;
  if (size < 126) {
    head = Buffer.from([0x80 | opcode, size]);
  } else if (size < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(size, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(size), 2);
  }
  return Buffer.concat([head, body]);
}

function writeFrame(socket, frame) {
  if (socket.destroyed) return;
  if (socket.writableLength > 1048576) return socket.destroy();
  socket.write(frame);
}

function sendAll(text) {
  const frame = wsFrame(1, text);
  for (const socket of sockets) writeFrame(socket, frame);
}

let pushTimer = null;
let lastState = '';
let liveTimers = [];

function pushState() {
  if (pushTimer || !sockets.size) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (!sockets.size) return;
    const body = JSON.stringify(liveState());
    if (body === lastState) return;
    lastState = body;
    sendAll(`{"type":"state","now":${Date.now()},"data":${body}}`);
  }, 200);
}

function heartbeat() {
  const ping = wsFrame(9, Buffer.alloc(0));
  for (const socket of sockets) {
    if (!socket.alive) {
      socket.destroy();
      continue;
    }
    socket.alive = false;
    writeFrame(socket, ping);
  }
}

function startLive() {
  if (liveTimers.length) return;
  liveTimers = [setInterval(pushState, dashboard['refresh-interval']), setInterval(heartbeat, 30000)];
}

function stopLive() {
  liveTimers.forEach(clearInterval);
  liveTimers = [];
  clearTimeout(pushTimer);
  pushTimer = null;
  lastState = '';
}

function wsRead(socket, chunk) {
  socket.wsBuffer = socket.wsBuffer ? Buffer.concat([socket.wsBuffer, chunk]) : chunk;
  while (socket.wsBuffer.length >= 2) {
    const buf = socket.wsBuffer;
    const opcode = buf[0] & 0x0f;
    let size = buf[1] & 0x7f;
    let offset = 2;
    if (!(buf[1] & 0x80) || size === 127) return socket.destroy();
    if (size === 126) {
      if (buf.length < 4) return;
      size = buf.readUInt16BE(2);
      offset = 4;
    }
    if (size > 1024) return socket.destroy();
    if (buf.length < offset + 4 + size) return;
    const mask = buf.subarray(offset, offset + 4);
    const payload = Buffer.from(buf.subarray(offset + 4, offset + 4 + size));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    socket.wsBuffer = buf.subarray(offset + 4 + size);
    socket.alive = true;
    if (opcode === 0x8) {
      writeFrame(socket, wsFrame(8, Buffer.alloc(0)));
      return socket.end();
    }
    if (opcode === 0x9) writeFrame(socket, wsFrame(0xa, payload));
    else if (opcode === 0x1 && payload.toString() === 'sync') writeFrame(socket, wsFrame(1, JSON.stringify({ type: 'snapshot', data: details() })));
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function acceptSocket(req, socket) {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    pathname = '';
  }
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (pathname !== '/ws' || !key || upgrade !== 'websocket' || !sameOrigin(req)) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  socket.setTimeout(0);
  socket.alive = true;
  socket.wsBuffer = null;
  sockets.add(socket);
  const drop = () => {
    sockets.delete(socket);
    socket.destroy();
    if (!sockets.size) stopLive();
  };
  socket.on('data', (chunk) => wsRead(socket, chunk));
  socket.on('close', drop);
  socket.on('error', drop);
  socket.on('end', drop);
  writeFrame(socket, wsFrame(1, JSON.stringify({ type: 'snapshot', data: details() })));
  startLive();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) return reject(Object.assign(new Error('payload too large'), { code: 413 }));
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch {
        reject(Object.assign(new Error('invalid json'), { code: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const actions = {
  join: () => joinServer(),
  disconnect: () => leaveServer(),
  reconnect: () => reconnectServer()
};

async function handleApi(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' }, { Allow: 'POST' });
  try {
    const body = await readJson(req);
    const action = body && body.action;
    if (typeof action !== 'string' || !Object.hasOwn(actions, action)) {
      return sendJson(res, 400, { ok: false, error: 'action must be join, disconnect or reconnect' });
    }
    sendJson(res, 200, { ok: true, status: actions[action]() });
  } catch (err) {
    if (err.code === 413) res.once('finish', () => req.socket.destroy());
    sendJson(res, err.code || 400, { ok: false, error: err.message });
  }
}

const web = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad request' });
  }

  if (pathname === '/api') return handleApi(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, error: 'method not allowed' }, { Allow: 'GET, HEAD' });
  }
  if (pathname === '/') {
    return sendHtml(res, 200, dashboardPage.render(details()), req.method === 'HEAD');
  }
  if (pathname === '/health') return sendJson(res, 200, details());
  if (pathname === '/ping') return res.end('pong');
  sendJson(res, 404, { ok: false, error: 'not found' });
});

web.on('upgrade', acceptSocket);
web.listen(PORT, dashboard.host, () => log('Server', `Listening on port ${PORT}`));

const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
if (publicUrl) {
  setInterval(() => fetch(`${publicUrl}/ping`).catch((err) => log('KeepAlive', err.message)), dashboard['self-ping-interval']);
}

async function notify(text, event) {
  const url = process.env.DISCORD_WEBHOOK_URL || (discord && discord.webhook);
  if (!discord || !discord.enabled || !url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: config.name,
        embeds: [{ description: text, color: discord.colors[event], timestamp: new Date().toISOString() }]
      })
    });
  } catch (err) {
    log('Discord', err.message);
  }
}

function every(name, task, delay) {
  timers.push(setInterval(() => {
    if (!bot || !state.connected) return;
    Promise.resolve().then(task).catch((err) => log(name, err.message));
  }, delay));
}

function stopTimers() {
  timers.forEach(clearInterval);
  timers = [];
}

function pulse(target, control, duration) {
  target.setControlState(control, true);
  setTimeout(() => target.setControlState(control, false), duration);
}

function reconnectDelay() {
  return Math.min(
    utils['auto-reconnect-delay'] + state.attempts * utils['reconnect-backoff-step'],
    utils['max-reconnect-delay']
  );
}

function serverOnline() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (online) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      state.serverOnline = online;
      state.serverCheckedAt = new Date().toISOString();
      resolve(online);
    };
    const timer = setTimeout(() => finish(false), watch.timeout);
    ping({ host: serverHost, port: serverPort }, (err, result) => {
      const version = result && result.version ? String(result.version.name) : '';
      finish(!err && !!result && !offlinePattern.test(version));
    });
  });
}

function cancelReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectGen++;
}

function scheduleReconnect(delay) {
  if (reconnectTimer || state.paused) return;
  const generation = reconnectGen;
  if (delay === undefined) {
    state.attempts++;
    delay = reconnectDelay();
    log('Bot', `Reconnecting in ${delay / 1000}s (attempt ${state.attempts})`);
  }
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (watch.enabled) {
      if (!(await serverOnline())) {
        if (generation !== reconnectGen || state.paused) return;
        state.failedChecks++;
        if (maxChecks > 0 && state.failedChecks >= maxChecks) {
          state.paused = true;
          log('Watch', `Server still offline after ${maxChecks} checks, stopping. Use the join action to start again`);
          if (discord && discord.events && discord.events.disconnect) {
            notify(`Server offline after ${maxChecks} checks, bot stopped`, 'disconnect');
          }
          return;
        }
        log('Watch', `Server offline, check ${state.failedChecks}${maxChecks > 0 ? `/${maxChecks}` : ''}, next in ${checkInterval / 1000}s`);
        scheduleReconnect(checkInterval);
        return;
      }
      state.failedChecks = 0;
    }
    if (generation !== reconnectGen || state.paused) return;
    createBot();
  }, delay);
}

function joinServer() {
  if (state.connected && !state.paused) return 'already-connected';
  state.paused = false;
  cancelReconnect();
  state.attempts = 0;
  state.failedChecks = 0;
  log('Api', 'Join requested');
  createBot();
  return 'joining';
}

function reconnectServer() {
  state.paused = false;
  cancelReconnect();
  state.attempts = 0;
  state.failedChecks = 0;
  state.connected = false;
  state.connectedAt = null;
  log('Api', 'Reconnect requested');
  createBot();
  return 'reconnecting';
}

function leaveServer() {
  if (state.paused) return 'already-stopped';
  state.paused = true;
  cancelReconnect();
  const wasConnected = state.connected;
  state.connected = false;
  state.connectedAt = null;
  teardown();
  log('Api', 'Disconnect requested');
  if (wasConnected && discord && discord.events && discord.events.disconnect) {
    notify('Disconnected: requested through the API', 'disconnect');
  }
  return 'stopped';
}

function teardown() {
  stopTimers();
  clearTimeout(connectTimer);
  if (!bot) return;
  try {
    bot.removeAllListeners();
    bot.on('error', () => {});
    bot.end();
  } catch (err) {
    log('Cleanup', err.message);
  }
  bot = null;
}

function setupAuth(target) {
  const auth = utils['auto-auth'];
  const password = process.env.AUTH_PASSWORD || (auth && auth.password);
  if (!auth || !auth.enabled || !password) return;
  let done = false;
  target.on('messagestr', (message) => {
    if (done) return;
    const text = message.toLowerCase();
    if (text.includes(auth['register-trigger'])) {
      done = true;
      target.chat(auth['register-command'].replaceAll('{password}', password));
      log('Auth', 'Register sent');
    } else if (text.includes(auth['login-trigger'])) {
      done = true;
      target.chat(auth['login-command'].replaceAll('{password}', password));
      log('Auth', 'Login sent');
    }
  });
}

function startModules(target) {
  const registry = minecraftData(server.version);
  const moves = new Movements(target, registry);
  const { GoalBlock } = goals;

  if (position.enabled) {
    target.pathfinder.setMovements(moves);
    target.pathfinder.setGoal(new GoalBlock(position.x, position.y, position.z));
  }

  if (utils['anti-afk'].enabled) {
    if (utils['anti-afk'].sneak) target.setControlState('sneak', true);
    every('AntiAfk', () => pulse(target, 'jump', utils['anti-afk']['jump-duration']), utils['anti-afk'].interval);
  }

  if (movement['circle-walk'].enabled) {
    let angle = 0;
    every('CircleWalk', () => {
      const here = target.entity.position;
      const x = Math.floor(here.x + Math.cos(angle) * movement['circle-walk'].radius);
      const z = Math.floor(here.z + Math.sin(angle) * movement['circle-walk'].radius);
      target.pathfinder.setMovements(moves);
      target.pathfinder.setGoal(new GoalBlock(x, Math.floor(here.y), z));
      angle += (movement['circle-walk']['angle-step'] * Math.PI) / 180;
    }, movement['circle-walk'].speed);
  }

  if (movement['look-around'].enabled) {
    every('LookAround', () => {
      target.look(Math.random() * Math.PI * 2, ((Math.random() - 0.5) * movement['look-around']['pitch-range'] * Math.PI) / 180, true);
    }, movement['look-around'].interval);
  }

  if (movement['random-jump'].enabled) {
    every('RandomJump', () => pulse(target, 'jump', movement['random-jump']['jump-duration']), movement['random-jump'].interval);
  }

  if (modules['avoid-mobs']) {
    every('AvoidMobs', () => {
      const near = Object.values(target.entities).some((e) =>
        e.position &&
        (e.type === 'mob' || (e.type === 'player' && e.username !== target.username)) &&
        target.entity.position.distanceTo(e.position) < avoid['safe-distance']
      );
      if (near) pulse(target, 'back', avoid['back-duration']);
    }, avoid.interval);
  }

  if (modules.combat) {
    if (combat['attack-mobs']) {
      every('Combat', () => {
        const mob = Object.values(target.entities).find((e) =>
          e.type === 'mob' && e.position && target.entity.position.distanceTo(e.position) < combat['attack-range']
        );
        if (mob) target.attack(mob);
      }, combat['attack-interval']);
    }

    if (combat['auto-eat']) {
      let eating = false;
      target.on('health', async () => {
        if (eating || target.food >= combat['eat-below']) return;
        const food = target.inventory.items().find((item) => registry.itemsByName[item.name]?.food);
        if (!food) return;
        eating = true;
        try {
          await target.equip(food, 'hand');
          await target.consume();
        } catch (err) {
          log('AutoEat', err.message);
        } finally {
          eating = false;
        }
      });
    }
  }

  if (modules.beds) {
    every('Beds', async () => {
      const time = target.time.timeOfDay;
      if (time < beds['night-start'] || time > beds['night-end'] || target.isSleeping) return;
      const bed = target.findBlock({ matching: (block) => target.isABed(block), maxDistance: beds['search-distance'] });
      if (bed) await target.sleep(bed).catch(() => {});
    }, beds.interval);
  }

  if (modules.chat && chat.respond) {
    target.on('chat', (username, message) => {
      if (username !== target.username && greeting.test(message)) {
        target.chat(chat.reply.replaceAll('{player}', username));
      }
    });
  }

  if (utils['chat-log']) {
    target.on('chat', (username, message) => log('Chat', `${username}: ${message}`));
  }

  if (utils['periodic-rejoin'] && utils['periodic-rejoin'].enabled) {
    setupRejoin(target, utils['periodic-rejoin']);
  }

  startup.list.forEach((command, index) => {
    timers.push(setTimeout(() => {
      if (bot === target && state.connected) target.chat(command);
    }, startup.delay + index * startup.gap));
  });
}

function createBot() {
  teardown();
  log('Bot', `Connecting to ${serverHost}:${serverPort}`);

  try {
    bot = mineflayer.createBot({
      username: account.username,
      password: account.password || undefined,
      auth: account.type,
      host: serverHost,
      port: serverPort,
      version: server.version,
      checkTimeoutInterval: server['keepalive-timeout'],
      viewDistance: server['view-distance'] || (position.enabled ? 'short' : 'tiny')
    });
  } catch (err) {
    log('Bot', `Failed to create bot: ${err.message}`);
    scheduleReconnect();
    return;
  }

  const current = bot;
  current.loadPlugin(pathfinder);
  setupAuth(current);

  connectTimer = setTimeout(() => {
    if (!state.connected) {
      log('Bot', `No spawn within ${server['connect-timeout'] / 1000}s`);
      scheduleReconnect();
    }
  }, server['connect-timeout']);

  current.once('spawn', () => {
    clearTimeout(connectTimer);
    state.connected = true;
    state.connectedAt = Date.now();
    state.attempts = 0;
    log('Bot', 'Spawned');
    startModules(current);
    if (discord && discord.events && discord.events.connect) {
      notify(`Connected to \`${serverHost}\``, 'connect');
    }
  });

  current.on('end', (reason) => {
    const after = state.connectedAt ? ` after ${span(Date.now() - state.connectedAt)} connected` : '';
    log('Bot', `Disconnected: ${reason || 'unknown'}${after}`);
    state.connected = false;
    state.connectedAt = null;
    state.lastDisconnect = { reason: reason || 'unknown', at: new Date().toISOString() };
    stopTimers();
    clearTimeout(connectTimer);
    if (discord && discord.events && discord.events.disconnect && reason !== utils['periodic-rejoin'].reason) {
      notify(`Disconnected: ${reason || 'unknown'}`, 'disconnect');
    }
    if (bot === current) teardown();
    if (utils['auto-reconnect']) scheduleReconnect();
  });

  current.on('kicked', (reason) => {
    const text = typeof reason === 'string' ? reason : JSON.stringify(reason);
    state.lastKick = { reason: text.slice(0, 500), at: new Date().toISOString() };
    log('Kick', text);
  });

  current.on('error', (err) => log('Bot', err.message));
}

readline.createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
  const input = line.trim();
  if (input === 'status') {
    log('Console', `${currentStatus()} uptime=${uptime()}s`);
  } else if (input === 'join') {
    log('Console', joinServer());
  } else if (input === 'disconnect') {
    log('Console', leaveServer());
  } else if (input === 'reconnect') {
    log('Console', reconnectServer());
  } else if (!bot || !state.connected) {
    log('Console', 'Bot not connected');
  } else if (input.startsWith('say ')) {
    bot.chat(input.slice(4));
  } else if (input.startsWith('cmd ')) {
    bot.chat(`/${input.slice(4)}`);
  }
});

process.on('uncaughtException', (err) => {
  log('Fatal', err.message);
  if (!state.connected && !state.paused && utils['auto-reconnect']) scheduleReconnect();
});

process.on('unhandledRejection', (reason) => log('Fatal', String(reason)));
['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => process.exit(0)));

createBot();
