const DISCORD_API = "https://discord.com/api/v10";
const EPHEMERAL = 64;
const INTENTS = 1 | 512 | 32768; // GUILDS, GUILD_MESSAGES, MESSAGE_CONTENT
const LINKS_CATEGORY = "Solaris Links:";
const SOLARIS_API = "https://solaris.sdevs.workers.dev";
const SOLARIS_COLOR = 0xF5C400;

async function fetchSolaris(endpoint) {
  const response = await fetch(`${SOLARIS_API}${endpoint}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Solaris API returned HTTP ${response.status}`);
  return response.json();
}

function solarisEmbed(title, description, fields = []) {
  return {
    title,
    description,
    color: SOLARIS_COLOR,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: "Solaris API" }
  };
}

async function buildSolarisEmbed(subcommand) {
  if (subcommand === "health") {
    const data = await fetchSolaris("/api/health");
    return solarisEmbed("Solaris Health", data.status === "healthy" ? "Solaris is healthy." : "Solaris health check returned an unexpected status.", [
      { name: "Status", value: String(data.status ?? "Unknown"), inline: true },
      { name: "Service", value: String(data.service ?? "Solaris"), inline: true }
    ]);
  }

  if (subcommand === "status") {
    const data = await fetchSolaris("/api/status");
    return solarisEmbed("Solaris Status", `**${data.status ?? "Unknown"}**`, [
      { name: "Online Users", value: String(data.online ?? "Unknown"), inline: true },
      { name: "Version", value: String(data.version ?? "Unavailable"), inline: true },
      { name: "Worker Build", value: String(data.buildId ?? "Unavailable"), inline: false }
    ]);
  }

  if (subcommand === "online") {
    const data = await fetchSolaris("/api/status");
    const status = `Currently ${Number(data.online) || 0} People online`;
    return solarisEmbed("Solaris Online", status, [
      { name: "Online Users", value: String(data.online ?? "Unknown"), inline: true }
    ]);
  }

  if (subcommand === "stats") {
    const data = await fetchSolaris("/api/stats");
    return solarisEmbed("Solaris Statistics", "Live statistics from the Solaris API.", [
      { name: "Online Users", value: String(data.online ?? "Unknown"), inline: true },
      { name: "Published Games", value: String(data.sharedGames ?? "Unknown"), inline: true },
      { name: "Version", value: String(data.version ?? "Unavailable"), inline: false },
      { name: "Worker Build", value: String(data.buildId ?? "Unavailable"), inline: false }
    ]);
  }

  if (subcommand === "version") {
    const data = await fetchSolaris("/api/version");
    return solarisEmbed("Solaris Version", String(data.version ?? "Unavailable"), [
      { name: "Worker Build", value: String(data.buildId ?? "Unavailable"), inline: false }
    ]);
  }

  if (subcommand === "games") {
    const games = await fetchSolaris("/api/games");
    if (!Array.isArray(games) || games.length === 0) {
      return solarisEmbed("Solaris Community Games", "No published community games were found.");
    }
    const description = games.slice(0, 20).map((game, index) => {
      const name = String(game.name ?? "Untitled game");
      const category = String(game.category ?? "Uncategorised");
      const detail = String(game.description ?? "").slice(0, 180);
      return `**${index + 1}. ${name}** · ${category}${detail ? `\n${detail}` : ""}`;
    }).join("\n\n");
    const extra = games.length > 20 ? `\n\n…and ${games.length - 20} more.` : "";
    return solarisEmbed("Solaris Community Games", (description + extra).slice(0, 4096));
  }

  throw new Error("Unknown Solaris command.");
}

async function handleSolarisInteraction(interaction, env) {
  let embeds;
  try {
    const subcommand = interaction.data.options?.[0]?.name;
    embeds = [await buildSolarisEmbed(subcommand)];
  } catch (error) {
    embeds = [solarisEmbed("Solaris API Unavailable", error?.message || "The Solaris API could not be reached.")];
  }

  const response = await fetch(`${DISCORD_API}/webhooks/${env.DISCORD_APPLICATION_ID || interaction.application_id}/${interaction.token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeds, allowed_mentions: { parse: [] } })
  });
  if (!response.ok) {
    console.error("[solaris-command] Discord follow-up failed:", response.status, await response.text());
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function verifyDiscordRequest(request, publicKey) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp || !publicKey) return false;

  const body = await request.clone().text();
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body)
    );
  } catch {
    return false;
  }
}

function getOption(options, name) {
  return options?.find(option => option.name === name)?.value;
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // URL normalizes host casing and default ports; fragments do not identify a different resource.
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function validUrl(value) {
  return normalizeUrl(value) !== null;
}

export default {
  async fetch(request, env, executionCtx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("Solaris Links Bot is running.", {
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }

    if (url.pathname !== "/discord/interactions" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    if (!await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY)) {
      return new Response("Invalid request signature", { status: 401 });
    }

    const interaction = await request.json();
    if (interaction.type === 1) return json({ type: 1 });
    if (interaction.type !== 2) {
      return json({ type: 4, data: { content: "Unsupported interaction.", flags: EPHEMERAL } });
    }

    // Public Solaris information commands are available to everyone.
    if (interaction.data?.name === "solaris") {
      executionCtx.waitUntil(handleSolarisInteraction(interaction, env));
      return json({ type: 5 });
    }

    if (interaction.data?.name !== "links") {
      return json({ type: 4, data: { content: "Unknown command.", flags: EPHEMERAL } });
    }

    const userId = String(interaction.member?.user?.id ?? interaction.user?.id ?? "");
    const unrestrictedUserId = "1198867010361237584";
    const adminRequiredUserId = "1466633583715156100";

    if (userId !== unrestrictedUserId && userId !== adminRequiredUserId) {
      return json({
        type: 4,
        data: { content: "You are not authorised to use Solaris Bot slash commands.", flags: EPHEMERAL }
      });
    }

    const memberPermissions = BigInt(interaction.member?.permissions ?? "0");
    if (userId === adminRequiredUserId && (memberPermissions & 8n) !== 8n) {
      return json({
        type: 4,
        data: { content: "You need the **Administrator** permission to use these commands.", flags: EPHEMERAL }
      });
    }

    const subcommand = interaction.data.options?.[0];
    const stateId = env.BOT_STATE.idFromName("main");
    const state = env.BOT_STATE.get(stateId);
    const result = await state.fetch("https://bot-state/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: subcommand?.name,
        options: subcommand?.options ?? [],
        userId: interaction.member?.user?.id ?? interaction.user?.id
      })
    });
    const payload = await result.json();
    return json({
      type: 4,
      data: { content: payload.message ?? "Done.", flags: EPHEMERAL, allowed_mentions: { parse: [] } }
    });
  },

  async scheduled(_event, env) {
    const id = env.BOT_STATE.idFromName("main");
    await env.BOT_STATE.get(id).fetch("https://bot-state/gateway/ensure");
  }
};

export class BotState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.socket = null;
    this.heartbeatTimer = null;
    this.sequence = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.reconnectTimer = null;
    this.presenceTimer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/gateway/ensure") {
      this.connectGateway();
      return new Response("Gateway check started");
    }

    if (url.pathname === "/command" && request.method === "POST") {
      const { action, options, userId } = await request.json();
      return json(await this.handleAdminCommand(action, options, userId));
    }

    return new Response("Not found", { status: 404 });
  }

  async readLinks() {
    return (await this.ctx.storage.get("links")) ?? [];
  }

  async saveLinks(links) {
    await this.ctx.storage.put("links", links);
  }

  async handleAdminCommand(action, options, userId) {
    const url = String(getOption(options, "url") ?? "").trim();
    const links = await this.readLinks();

    if (action === "add") {
      const allowedAddUsers = new Set([
        "1198867010361237584",
        "1466633583715156100"
      ]);
      if (!allowedAddUsers.has(String(userId))) {
        return { message: "You are not authorised to add links to Solaris Links." };
      }
      if (!validUrl(url)) {
        return { message: "Please provide a valid HTTP(S) URL." };
      }
      const normalizedNewUrl = normalizeUrl(url);
      if (links.some(item => normalizeUrl(item.url) === normalizedNewUrl)) {
        return { message: "That URL is already in Solaris Links." };
      }
      links.push({ category: LINKS_CATEGORY, url });
      await this.saveLinks(links);
      return { message: `Added ${url} to **Solaris Links:**.` };
    }

    if (action === "remove") {
      if (!url) return { message: "Provide the URL to remove." };
      const index = links.findIndex(item => String(item.url).toLowerCase() === url.toLowerCase());
      if (index === -1) return { message: "I couldn't find that URL in Solaris Links." };
      const [removed] = links.splice(index, 1);
      await this.saveLinks(links);
      return { message: `Removed ${removed.url} from **Solaris Links:**.` };
    }

    if (action === "list") {
      if (!links.length) return { message: "No links have been added yet." };
      const text = `**Solaris Links:**\n${links.map(item => String(item.url)).join("\n")}`;
      return { message: text.length > 1900 ? text.slice(0, 1880) + "\n… (list shortened)" : text };
    }

    return { message: "Unknown subcommand." };
  }

  groupLinks(links) {
    return links.reduce((groups, item) => {
      (groups[item.category] ??= []).push(item);
      return groups;
    }, {});
  }

  async sendDiscord(path, body) {
    const response = await fetch(DISCORD_API + path, {
      method: "POST",
      headers: {
        authorization: `Bot ${this.env.DISCORD_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Discord API returned ${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  async dmLinks(userId) {
    const links = await this.readLinks();
    const content = links.length
      ? `**Solaris Links:**\n${links.map(item => String(item.url)).join("\n")}`
      : "The Solaris Links list is empty right now.";

    const channel = await this.sendDiscord("/users/@me/channels", { recipient_id: userId });
    const chunks = [];
    for (let i = 0; i < content.length; i += 1900) chunks.push(content.slice(i, i + 1900));
    for (const chunk of chunks) {
      await this.sendDiscord(`/channels/${channel.id}/messages`, { content: chunk });
    }
  }

  connectGateway() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    if (!this.env.DISCORD_TOKEN) return;

    const gatewayUrl = this.resumeUrl || "wss://gateway.discord.gg/?v=10&encoding=json";
    try {
      const ws = new WebSocket(gatewayUrl);
      this.socket = ws;

      console.log("[gateway] Connecting to Discord");
      ws.addEventListener("open", () => console.log("[gateway] WebSocket opened"));
      ws.addEventListener("message", event => {
        this.onGatewayMessage(event.data).catch(error => {
          console.error("[gateway] Message handler failed:", error?.stack || error);
          this.scheduleReconnect();
        });
      });
      ws.addEventListener("close", event => {
        console.error("[gateway] WebSocket closed:", event.code, event.reason);
        this.scheduleReconnect();
      });
      ws.addEventListener("error", event => {
        console.error("[gateway] WebSocket error:", event?.message || event);
        this.scheduleReconnect();
      });
    } catch (error) {
      console.error("[gateway] Connection setup failed:", error?.stack || error);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    this.socket = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connectGateway(), 5000);
  }

  sendGateway(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  async onGatewayMessage(raw) {
    const packet = JSON.parse(raw);
    if (packet.s !== null && packet.s !== undefined) this.sequence = packet.s;

    if (packet.op === 10) {
      console.log("[gateway] HELLO received");
      const interval = packet.d.heartbeat_interval;
      this.heartbeatTimer = setTimeout(() => this.heartbeat(interval), interval * 0.8);
      if (this.sessionId && this.resumeUrl) {
        this.sendGateway({
          op: 6,
          d: { token: this.env.DISCORD_TOKEN, session_id: this.sessionId, seq: this.sequence }
        });
      } else {
        this.sendGateway({
          op: 2,
          d: {
            token: this.env.DISCORD_TOKEN,
            intents: INTENTS,
            properties: { os: "cloudflare-workers", browser: "solaris-links-bot", device: "solaris-links-bot" }
          }
        });
      }
      return;
    }

    if (packet.op === 1) {
      this.sendGateway({ op: 1, d: this.sequence });
      return;
    }

    if (packet.op === 7 || packet.op === 9) {
      console.warn("[gateway] Reconnect requested, opcode:", packet.op, "resumable:", packet.d);
      this.scheduleReconnect();
      return;
    }

    if (packet.op === 11) return;

    if (packet.t === "READY") {
      console.log("[gateway] READY as", packet.d.user?.username);
      this.sessionId = packet.d.session_id;
      this.resumeUrl = packet.d.resume_gateway_url + "?v=10&encoding=json";
      await this.updatePresence();
      if (this.presenceTimer) clearInterval(this.presenceTimer);
      this.presenceTimer = setInterval(() => {
        this.updatePresence().catch(error => {
          console.error("[presence] Update failed:", error?.message || error);
        });
      }, 30_000);
      return;
    }

    if (packet.t === "MESSAGE_CREATE") {
      const message = packet.d;
      console.log("[gateway] MESSAGE_CREATE", {
        guild_id: message.guild_id,
        channel_id: message.channel_id,
        author_bot: message.author?.bot,
        content: message.content
      });
      if (message.author?.bot || !message.content) return;
      if (message.content.trim().toLowerCase() !== "!sites") return;
      if (
        message.guild_id !== "1570325151910731827" ||
        message.channel_id !== "1570329383414272042"
      ) {
        await this.sendDiscord(`/channels/${message.channel_id}/messages`, {
          content: "Please use this command in the Solaris server: https://discord.com/channels/1570325151910731827/1570329383414272042\n\nNeed to join? https://discord.gg/h45g6JCwpM",
          message_reference: { message_id: message.id },
          allowed_mentions: { parse: [] }
        }).catch(() => {});
        return;
      }
      try {
        await this.dmLinks(message.author.id);
        await this.sendDiscord(`/channels/${message.channel_id}/messages`, {
          content: "I sent you all the new domains!",
          message_reference: { message_id: message.id },
          allowed_mentions: { parse: [] }
        });
      } catch {
        await this.sendDiscord(`/channels/${message.channel_id}/messages`, {
          content: "I couldn't DM you. Please enable direct messages from server members and try again.",
          allowed_mentions: { parse: [] }
        }).catch(() => {});
      }
    }
  }

  async updatePresence() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;

    try {
      const data = await fetchSolaris("/api/status");
      if (!Number.isFinite(Number(data.online))) {
        throw new Error("Solaris API returned an invalid online count");
      }
      const status = `Currently ${Number(data.online)} People online`;

      this.sendGateway({
        op: 3,
        d: {
          since: null,
          activities: [{ name: status.slice(0, 128), type: 0 }],
          status: "online",
          afk: false
        }
      });
      console.log("[presence] Updated activity:", status);
    } catch (error) {
      console.error("[presence] Solaris API error:", error?.message || error);
    }
  }

  heartbeat(interval) {
    this.sendGateway({ op: 1, d: this.sequence });
    this.heartbeatTimer = setTimeout(() => this.heartbeat(interval), interval);
  }
}
