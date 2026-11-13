const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;

if (!token || !appId) {
  console.error("Set DISCORD_TOKEN and DISCORD_APPLICATION_ID first.");
  process.exit(1);
}

const commands = [{
  name: "links",
  description: "Manage the server link directory",
  options: [
    {
      type: 1,
      name: "add",
      description: "Add a link to a category",
      options: [
        { type: 3, name: "category", description: "Category name", required: true },
        { type: 3, name: "name", description: "Display name for the link", required: true },
        { type: 3, name: "url", description: "Full HTTP or HTTPS URL", required: true }
      ]
    },
    {
      type: 1,
      name: "remove",
      description: "Remove a link from a category",
      options: [
        { type: 3, name: "category", description: "Category name", required: true },
        { type: 3, name: "name", description: "Display name of the link", required: true }
      ]
    },
    {
      type: 1,
      name: "list",
      description: "List saved links",
      options: [
        { type: 3, name: "category", description: "Optional category to filter by", required: false }
      ]
    }
  ]
}];

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
