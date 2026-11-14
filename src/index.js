const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const yaml = require('js-yaml');
const mineflayer = require('mineflayer');
const minecraftData = require('minecraft-data');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const setupRejoin = require('./rejoin');

const config = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'config.yml'), 'utf8'));
const { server, dashboard, position, utils, movement, modules, combat, beds, chat, discord } = config;
const avoid = config['avoid-mobs'];
const startup = config['startup-commands'];
const greeting = new RegExp(`\\b(${chat.greetings.join('|')})\\b`, 'i');
const account = config.accounts && config.accounts[0];

if (!account || !account.username) {
  console.error('[Config] config.yml needs at least one account with a username');
  process.exit(1);
}

const PORT = process.env.PORT || dashboard.port;
const state = { connected: false, startedAt: Date.now(), attempts: 0 };

let bot = null;
let timers = [];
let reconnectTimer = null;
let connectTimer = null;

const log = (tag, message) => console.log(`[${tag}] ${message}`);
const uptime = () => Math.floor((Date.now() - state.startedAt) / 1000);
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = `
<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(config.name)}</title>
        <style>
            body {
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                background: #0f172a;
                color: #f8fafc;
                font-family: system-ui, sans-serif;
            }
            main {
                width: min(360px, 90vw);
                padding: 24px;
                background: #1e293b;
                border: 1px solid #334155;
                border-radius: 12px;
            }
            h1 {
                margin: 0 0 8px;
                font-size: 20px;
            }
            dt {
                margin-top: 16px;
                color: #94a3b8;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            dd {
                margin: 4px 0 0;
                color: #2dd4bf;
                font-size: 16px;
            }
        </style>
    </head>
    <body>
        <main>
            <h1>${escapeHtml(config.name)}</h1>
            <dl>
                <dt>Status</dt>
                <dd id="status">...</dd>
                <dt>Uptime</dt>
                <dd id="uptime">...</dd>
                <dt>Position</dt>
                <dd id="position">...</dd>
                <dt>Server</dt>
                <dd>${escapeHtml(server.host)}:${escapeHtml(server.port)}</dd>
            </dl>
        </main>
        <script>
            const $ = (id) => document.getElementById(id);
            const format = (s) => Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm ' + (s % 60) + 's';
            async function refresh() {
              try {
                const data = await (await fetch('/health')).json();
                $('status').textContent = data.status;
                $('uptime').textContent = format(data.uptime);
                $('position').textContent = data.position ? data.position.map(Math.round).join(', ') : 'unknown';
              } catch {
                $('status').textContent = 'offline';
              }
            }
            refresh();
            setInterval(refresh, ${dashboard['refresh-interval']});
        </script>
    </body>
</html>
`;

http.createServer((req, res) => {
  if (req.url === '/health') {
    const pos = bot && bot.entity ? bot.entity.position : null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: state.connected ? 'connected' : 'disconnected',
      uptime: uptime(),
      position: pos ? [pos.x, pos.y, pos.z] : null,
      reconnectAttempts: state.attempts
    }));
  } else if (req.url === '/ping') {
    res.end('pong');
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  }
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

function scheduleReconnect() {
  if (reconnectTimer) return;
  state.attempts++;
  const delay = reconnectDelay();
  log('Bot', `Reconnecting in ${delay / 1000}s (attempt ${state.attempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, delay);
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
  log('Bot', `Connecting to ${server.host}:${server.port}`);

  try {
    bot = mineflayer.createBot({
      username: account.username,
      password: account.password || undefined,
      auth: account.type,
      host: server.host,
      port: server.port,
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
    state.attempts = 0;
    log('Bot', 'Spawned');
    startModules(current);
    if (discord && discord.events && discord.events.connect) {
      notify(`Connected to \`${server.host}\``, 'connect');
    }
  });

  current.on('end', (reason) => {
    log('Bot', `Disconnected: ${reason || 'unknown'}`);
    state.connected = false;
    stopTimers();
    clearTimeout(connectTimer);
    if (discord && discord.events && discord.events.disconnect && reason !== utils['periodic-rejoin'].reason) {
      notify(`Disconnected: ${reason || 'unknown'}`, 'disconnect');
    }
    if (utils['auto-reconnect']) scheduleReconnect();
  });

  current.on('kicked', (reason) => {
    log('Kick', typeof reason === 'string' ? reason : JSON.stringify(reason));
  });

  current.on('error', (err) => log('Bot', err.message));
}

readline.createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
  const input = line.trim();
  if (input === 'status') {
    log('Console', `connected=${state.connected} uptime=${uptime()}s`);
  } else if (!bot || !state.connected) {
    log('Console', 'Bot not connected');
  } else if (input.startsWith('say ')) {
    bot.chat(input.slice(4));
  } else if (input.startsWith('cmd ')) {
    bot.chat(`/${input.slice(4)}`);
  } else if (input === 'reconnect') {
    bot.quit();
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
