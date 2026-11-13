const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;

if (!token || !appId) {
  console.error("Set DISCORD_TOKEN and DISCORD_APPLICATION_ID first.");
  process.exit(1);
}

const commands = [{
  name: "links",
  description: "Manage the Solaris Links directory",
  options: [
    {
      type: 1,
      name: "add",
      description: "Add a URL to Solaris Links",
      options: [
        { type: 3, name: "url", description: "Full HTTP or HTTPS URL", required: true }
      ]
    },
    {
      type: 1,
      name: "remove",
      description: "Remove a URL from Solaris Links",
      options: [
        { type: 3, name: "url", description: "Full URL to remove", required: true }
      ]
    },
    {
      type: 1,
      name: "list",
      description: "Show all URLs in Solaris Links"
    }
  ]
}];

// Remove outdated server-specific commands so Discord uses the current global definitions.
const guildId = "1570325151910731827";
const cleanup = await fetch(`https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`, {
  method: "PUT",
  headers: {
    authorization: `Bot ${token}`,
    "content-type": "application/json"
  },
  body: JSON.stringify([])
});

if (!cleanup.ok) {
  console.error("Could not clear outdated server commands:", cleanup.status, await cleanup.text());
  process.exit(1);
}

const response = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: "PUT",
  headers: {
    authorization: `Bot ${token}`,
    "content-type": "application/json"
  },
  body: JSON.stringify(commands)
});

const body = await response.text();
if (!response.ok) {
  console.error("Command registration failed:", response.status, body);
  process.exit(1);
}
console.log("Registered /links add, /links remove, and /links list.");
