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

const config = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'config.yml'), 'utf8'));
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
const apiToken = process.env.API_TOKEN;
const LOG_LIMIT = 20;
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

let bot = null;
let timers = [];
let reconnectTimer = null;
let reconnectGen = 0;
let connectTimer = null;

const log = (tag, message) => {
  const line = `[${tag}] ${message}`;
  console.log(line);
  logs.push(`${new Date().toISOString()} ${line}`);
  if (logs.length > LOG_LIMIT) logs.shift();
};
const uptime = () => Math.floor((Date.now() - state.startedAt) / 1000);
const round = (value) => Math.round(value * 10) / 10;

function sendJson(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body, null, 2));
}

function authorized(req) {
  if (!apiToken) return true;
  const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(apiToken);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function currentStatus() {
  if (state.paused) return 'stopped';
  return state.connected ? 'connected' : 'disconnected';
}

function details() {
  const live = bot && state.connected ? bot : null;
  const pos = live && live.entity ? live.entity.position : null;
  return {
    name: config.name,
    status: currentStatus(),
    uptime: uptime(),
    connectedFor: state.connectedAt ? Math.floor((Date.now() - state.connectedAt) / 1000) : null,
    reconnectAttempts: state.attempts,
    account: { username: account.username, type: account.type },
    server: {
      host: serverHost,
      port: serverPort,
      version: server.version,
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
    lastKick: state.lastKick,
    features,
    logs
  };
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
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
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

http.createServer((req, res) => {
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
  if (pathname === '/' || pathname === '/health') return sendJson(res, 200, details());
  if (pathname === '/ping') return res.end('pong');
  sendJson(res, 404, { ok: false, error: 'not found' });
}).listen(PORT, dashboard.host, () => log('Server', `Listening on port ${PORT}`));

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
        if (state.failedChecks >= maxChecks) {
          state.paused = true;
          log('Watch', `Server still offline after ${maxChecks} checks, stopping. Use the join action to start again`);
          if (discord && discord.events && discord.events.disconnect) {
            notify(`Server offline after ${maxChecks} checks, bot stopped`, 'disconnect');
          }
          return;
        }
        log('Watch', `Server offline, check ${state.failedChecks}/${maxChecks}, next in ${checkInterval / 1000}s`);
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
    setTimeout(() => {
      if (bot === target && state.connected) target.chat(command);
    }, startup.delay + index * startup.gap);
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
      checkTimeoutInterval: server['keepalive-timeout']
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
    log('Bot', `Disconnected: ${reason || 'unknown'}`);
    state.connected = false;
    state.connectedAt = null;
    state.lastDisconnect = { reason: reason || 'unknown', at: new Date().toISOString() };
    stopTimers();
    clearTimeout(connectTimer);
    if (discord && discord.events && discord.events.disconnect && reason !== utils['periodic-rejoin'].reason) {
      notify(`Disconnected: ${reason || 'unknown'}`, 'disconnect');
    }
    if (utils['auto-reconnect']) scheduleReconnect();
  });

  current.on('kicked', (reason) => {
    const text = typeof reason === 'string' ? reason : JSON.stringify(reason);
    state.lastKick = { reason: text, at: new Date().toISOString() };
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
  if (utils['auto-reconnect']) {
    stopTimers();
    scheduleReconnect();
  }
});

process.on('unhandledRejection', (reason) => log('Fatal', String(reason)));
['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => process.exit(0)));

createBot();
