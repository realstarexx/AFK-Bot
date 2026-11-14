### Setup
Requires Node.js 18 or newer.
```
npm install
npm start
```

Edit `config.yml` before starting. The bot uses the first entry in `accounts`. Secrets can also be set through environment variables instead of the file: `AUTH_PASSWORD` for the auth plugin password and `DISCORD_WEBHOOK_URL` for the webhook.
The status page runs on `PORT` (default 5000) with `/health` and `/ping` endpoints. Set `PUBLIC_URL` to the public address of the deployment to enable the self-ping every 10 minutes. On Aternos, enable cracked mode and install ViaVersion, ViaBackwards and ViaRewind if the server version differs from the bot.

### Console
`say <text>`, `cmd <command>`, `status`, `reconnect`.

#### Not affiliated with Aternos, Mojang or Microsoft. Use at your own risk, as automated clients may violate a host's terms. The bot does not bypass queue limits. Licensed under MIT.
