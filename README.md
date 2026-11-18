### Setup

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Edit `config.yml` before starting, or provide settings through environment variables. Every variable is optional and overrides the matching value in `config.yml`.

```env
# Server (overrides server.host and server.port)
SERVER_HOST=example.com
SERVER_PORT=25565

# Auth plugin password (overrides utils.auto-auth.password)
AUTH_PASSWORD=

# Discord webhook URL (overrides discord.webhook)
DISCORD_WEBHOOK_URL=

# Status server port (default 5000, leave unset on Railway)
PORT=

# Public deployment URL for self-pinging (not needed on Railway)
PUBLIC_URL=

# Toggles (accepted values: true, false, 1, 0, yes, no, on, off)
POSITION_ENABLED=false
UTILS_AUTO_AUTH_ENABLED=true
UTILS_ANTI_AFK_ENABLED=true
UTILS_ANTI_AFK_SNEAK=true
UTILS_CHAT_LOG=true
UTILS_AUTO_RECONNECT=true
UTILS_SERVER_WATCH_ENABLED=true
UTILS_PERIODIC_REJOIN_ENABLED=false
MOVEMENT_CIRCLE_WALK_ENABLED=false
MOVEMENT_LOOK_AROUND_ENABLED=true
MOVEMENT_RANDOM_JUMP_ENABLED=true
MODULES_AVOID_MOBS=false
MODULES_COMBAT=true
MODULES_BEDS=true
MODULES_CHAT=true
COMBAT_ATTACK_MOBS=true
COMBAT_AUTO_EAT=true
CHAT_RESPOND=false
DISCORD_ENABLED=false
DISCORD_EVENTS_CONNECT=true
DISCORD_EVENTS_DISCONNECT=true
```

Toggle names follow the path of the setting in `config.yml`, in uppercase, with dots and dashes turned into underscores. Invalid values are ignored.

### Dashboard

Open the app URL in a browser (`http://localhost:5000` locally) to get the dashboard.

* **Details** tab: server address, bot status (Online, Connecting, Offline), **Start** / **Stop** button, bot information and details (uptime, reconnect attempts, server check, last disconnect and kick), player stats (position, health, food, latency, dimension), the bot configuration, and the full `config.yml` settings grouped by section. Passwords and the Discord webhook are masked
* **Logs** tab: last 100 log lines with Refresh, Clear, Auto-scroll and Share

**Start** runs the `join` action and **Stop** runs `disconnect` (see below). The page updates live over a WebSocket, so nothing is polled. Uptime and connected time are counted in the browser from the start and connect timestamps. While at least one dashboard is open, player stats are pushed at most every `dashboardRefreshInterval` ms (and only when they changed). With no dashboard open, no live updates are processed.

### Routes

* `GET /` Dashboard (HTML)
* `GET /health` Bot Details as JSON (status, start and connect timestamps, server, player, last 100 log lines), used for health checks
* `GET /ws` WebSocket used by the dashboard for live updates (same-origin only)
* `GET /ping` Returns `pong`
* `POST /api` Controls the bot

```bash
curl -X POST https://your-app-domain.com/api \
  -H "Content-Type: application/json" \
  -d '{"action": "join"}'
```

**Actions**:

* `join`: Starts the bot
* `disconnect`: Stops the bot and keeps it offline until `join` or `reconnect` is called
* `reconnect`: Restarts the connection immediately

There is no token or login. Anyone who can reach the app URL can see the dashboard and start or stop the bot, so keep the URL private or put the app behind your own access control.

### Console

`say <text>` · `cmd <command>` · `status` · `join` · `disconnect` · `reconnect`

### Notes

After a disconnect, the bot pings the server and rejoins once it reports online. While the server is offline it checks every 5 minutes and stops after 30 failed checks, then stays stopped until `join` or `reconnect` is called (see `utils.server-watch` in `config.yml`).

On Aternos, enable cracked mode and install ViaVersion, ViaBackwards, and ViaRewind if the server version differs from the bot.

---

**Not affiliated with Aternos, Mojang, or Microsoft. Automated clients may violate hosting terms. This bot does not bypass queue limits.**
