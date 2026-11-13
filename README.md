# Solaris Links Bot

A Discord link-directory bot running on Cloudflare Workers.

## Features

- `/links add`, `/links remove`, and `/links list` are restricted to members with Discord's Administrator permission.
- Slash-command replies are ephemeral.
- Anyone can send `!links` in a server text channel to receive the directory by DM.
- Link data is stored persistently in a Cloudflare Durable Object.
- The Gateway listener runs from a scheduled Worker trigger.

## 1. Discord application setup

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Create an application and add a Bot.
2. Copy the **Application ID**, **Bot Token**, and **Public Key**.
3. Under **Bot → Privileged Gateway Intents**, enable **Message Content Intent**.
4. Invite the bot with the `bot` and `applications.commands` scopes and the permissions to view channels, send messages, and send DMs.
5. Keep the bot token private. Never commit it to GitHub.

## 2. Cloudflare secrets

In the Cloudflare Worker settings, add these secrets:

- `DISCORD_TOKEN`: the bot token
- `DISCORD_PUBLIC_KEY`: the application's public key

The Worker is named `solaris-links-bot`. The `wrangler.jsonc` file configures its Durable Object and one-minute scheduled trigger.

## 3. Register slash commands

Run locally from this repository:

```bash
npm install
# Set these in your local shell, not in a committed file:
# DISCORD_TOKEN=...
# DISCORD_APPLICATION_ID=...
npm run register-commands
```

For PowerShell:

```powershell
$env:DISCORD_TOKEN="YOUR_BOT_TOKEN"
$env:DISCORD_APPLICATION_ID="YOUR_APPLICATION_ID"
npm run register-commands
```

## 4. Deploy

Connect this repository to Cloudflare Workers Builds. Use:

- Build command: `npm install`
- Deploy command: `npx wrangler deploy`

Then add the two Worker secrets listed above and deploy.

## 5. Important Gateway setting

The bot uses Discord's Gateway to read the exact `!links` message. **Message Content Intent must be enabled** in the Discord Developer Portal. If Discord has not approved the intent for an application that requires approval, the prefix command will not work.

## Commands

- `/links add category:<category> name:<name> url:<url>`
- `/links remove category:<category> name:<name>`
- `/links list [category:<category>]`
- `!links` — public server command; the response is sent by DM.

The directory starts empty. Add only links you are permitted to distribute and use.
