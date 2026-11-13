const DISCORD_API = "https://discord.com/api/v10";
const EPHEMERAL = 64;
const INTENTS = 1 | 512 | 32768; // GUILDS, GUILD_MESSAGES, MESSAGE_CONTENT

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

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
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
    if (interaction.type !== 2 || interaction.data?.name !== "links") {
      return json({ type: 4, data: { content: "Unknown command.", flags: EPHEMERAL } });
    }

    const memberPermissions = BigInt(interaction.member?.permissions ?? "0");
    if ((memberPermissions & 8n) !== 8n) {
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
        options: subcommand?.options ?? []
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
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/gateway/ensure") {
      this.connectGateway();
      return new Response("Gateway check started");
    }

    if (url.pathname === "/command" && request.method === "POST") {
      const { action, options } = await request.json();
      return json(await this.handleAdminCommand(action, options));
    }

    return new Response("Not found", { status: 404 });
  }

  async readLinks() {
    return (await this.ctx.storage.get("links")) ?? [];
  }

  async saveLinks(links) {
    await this.ctx.storage.put("links", links);
  }

  async handleAdminCommand(action, options) {
    const category = String(getOption(options, "category") ?? "").trim();
    const name = String(getOption(options, "name") ?? "").trim();
    const url = String(getOption(options, "url") ?? "").trim();
    const links = await this.readLinks();

    if (action === "add") {
      if (!category || !name || !validUrl(url)) {
        return { message: "Please provide a category, a name, and a valid HTTP(S) URL." };
      }
      const duplicate = links.some(item =>
        item.category.toLowerCase() === category.toLowerCase() &&
        item.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) return { message: "That link already exists in this category." };
      links.push({ category, name, url });
      await this.saveLinks(links);
      return { message: `Added **${name}** to **${category}**.` };
    }

    if (action === "remove") {
      if (!category || !name) return { message: "Provide the category and link name to remove." };
      const index = links.findIndex(item =>
        item.category.toLowerCase() === category.toLowerCase() &&
        item.name.toLowerCase() === name.toLowerCase()
      );
      if (index === -1) return { message: "I couldn't find that link." };
      const [removed] = links.splice(index, 1);
      await this.saveLinks(links);
      return { message: `Removed **${removed.name}** from **${removed.category}**.` };
    }

    if (action === "list") {
      const filter = String(getOption(options, "category") ?? "").trim();
      const selected = filter
        ? links.filter(item => item.category.toLowerCase() === filter.toLowerCase())
        : links;
      if (!selected.length) return { message: filter ? `No links found in **${filter}**.` : "No links have been added yet." };
      const grouped = this.groupLinks(selected);
      const lines = Object.entries(grouped).map(([group, items]) =>
        `**${group}**\n${items.map(item => `• [${item.name}](${item.url})`).join("\n")}`
      );
      const text = lines.join("\n\n");
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
    if (!links.length) {
      await this.sendDiscord("/users/@me/channels", { recipient_id: userId })
        .then(channel => this.sendDiscord(`/channels/${channel.id}/messages`, { content: "The link directory is empty right now." }));
      return;
    }

    const groups = this.groupLinks(links);
    const chunks = [];
    let current = "**Here are the links:**\n\n";
    for (const [category, items] of Object.entries(groups)) {
      const section = `**${category}**\n${items.map(item => `[ ${item.name} ](${item.url})`).join("\n")}\n\n`;
      if (current.length + section.length > 1850) {
        chunks.push(current);
        current = "";
      }
      current += section;
    }
    if (current.trim()) chunks.push(current);

    const channel = await this.sendDiscord("/users/@me/channels", { recipient_id: userId });
    for (const content of chunks) {
      await this.sendDiscord(`/channels/${channel.id}/messages`, { content });
    }
  }

  connectGateway() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    if (!this.env.DISCORD_TOKEN) return;

    const gatewayUrl = this.resumeUrl || "wss://gateway.discord.gg/?v=10&encoding=json";
    try {
      const ws = new WebSocket(gatewayUrl);
      this.socket = ws;

      ws.addEventListener("message", event => {
        this.onGatewayMessage(event.data).catch(() => this.scheduleReconnect());
      });
      ws.addEventListener("close", () => this.scheduleReconnect());
      ws.addEventListener("error", () => this.scheduleReconnect());
    } catch {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
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
      this.sendGateway({ op:  heartbeat: 1, d: this.sequence });
      return;
    }

    if (packet.op === 7 || packet.op === 9) {
      this.scheduleReconnect();
      return;
    }

    if (packet.op === 11) return;

    if (packet.t === "READY") {
      this.sessionId = packet.d.session_id;
      this.resumeUrl = packet.d.resume_gateway_url + "?v=10&encoding=json";
      return;
    }

    if (packet.t === "MESSAGE_CREATE") {
      const message = packet.d;
      if (message.author?.bot || !message.content) return;
      if (message.content.trim().toLowerCase() !== "!links") return;
      try {
        await this.dmLinks(message.author.id);
      } catch {
        await this.sendDiscord(`/channels/${message.channel_id}/messages`, {
          content: "I couldn't DM you. Please enable direct messages from server members and try again.",
          allowed_mentions: { parse: [] }
        }).catch(() => {});
      }
    }
  }

  heartbeat(interval) {
    this.sendGateway({ op: 1, d: this.sequence });
    this.heartbeatTimer = setTimeout(() => this.heartbeat(interval), interval);
  }
}
