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

# Protects POST /api (without it the route is open to anyone)
API_TOKEN=

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

### Routes

* `GET /` Bot Details (status, uptime, server, player, last 20 log lines)
* `GET /health` Same JSON, used for health checks
* `POST /api` Controls the bot

```bash
curl -X POST https://your-app-domain.com/api \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "join"}'
```

**Actions**:

* `join`: Starts the bot
* `disconnect`: Stops the bot and keeps it offline until `join` or `reconnect` is called
* `reconnect`: Restarts the connection immediately

Send the token as an `Authorization: Bearer` header. If `API_TOKEN` is not set, `/api` is open to anyone, so set it on any public deployment.

### Console

`say <text>` · `cmd <command>` · `status` · `join` · `disconnect` · `reconnect`

### Notes

After a disconnect, the bot pings the server and rejoins once it reports online. While the server is offline it checks every 5 minutes and stops after 30 failed checks, then stays stopped until `join` or `reconnect` is called (see `utils.server-watch` in `config.yml`).

On Aternos, enable cracked mode and install ViaVersion, ViaBackwards, and ViaRewind if the server version differs from the bot.

---

**Not affiliated with Aternos, Mojang, or Microsoft. Automated clients may violate hosting terms. This bot does not bypass queue limits.**
