### Setup

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Edit `config.yml` before starting, or provide secrets through environment variables.

```env
SERVER_HOST=example.com
SERVER_PORT=25565
AUTH_PASSWORD=
API_TOKEN=
DISCORD_WEBHOOK_URL=
PORT=
PUBLIC_URL=
```

* `SERVER_HOST`: Server address, overrides `server.host`
* `SERVER_PORT`: Server port, overrides `server.port`
* `AUTH_PASSWORD`: Authentication plugin password, overrides `utils.auto-auth.password`
* `API_TOKEN`: Token required by `/join` and `/disconnect`
* `DISCORD_WEBHOOK_URL` (optional): Discord webhook URL, overrides `discord.webhook`
* `PORT` (optional): Status server port (default: `5000`)
* `PUBLIC_URL` (optional): Public deployment URL for automatic self-pinging

### Routes

* `/`: Status page
* `/health`: JSON with status, uptime and position
* `/ping`: Returns `pong`
* `/join`: Starts the bot
* `/disconnect`: Stops the bot and keeps it offline until `/join` is called

When `API_TOKEN` is set, send it as `?token=...` or an `Authorization: Bearer` header. Without it, `/join` and `/disconnect` are open to anyone.

### Console

`say <text>` · `cmd <command>` · `status` · `join` · `disconnect` · `reconnect`

### Notes

After a disconnect, the bot pings the server and rejoins once it reports online (see `utils.server-watch` in `config.yml`). On Aternos, enable cracked mode and install ViaVersion, ViaBackwards, and ViaRewind if the server version differs from the bot.

---

**Not affiliated with Aternos, Mojang, or Microsoft. Automated clients may violate hosting terms. This bot does not bypass queue limits.**