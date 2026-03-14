# ChatGPT-Api-Emulation

A reusable ChatGPT automation wrapper. **Text goes in, replies come out.**  
No API key. No fuss. Just a clean interface you can plug into any project.

---

## What This Actually Does

Uses Electron (a full Chromium browser in a Node.js wrapper) to automate the ChatGPT *website* — like a robot sitting at a keyboard typing prompts and reading the responses. Exposes that as an HTTP API, a CLI tool, and a Discord bot.

```
Your Code
    ↓  HTTP POST /ask { prompt: "..." }
[ server.js ]  ←→  [ brain.js ]  ←→  [ Electron window ]  ←→  ChatGPT website
                                                                        ↓
                                                                   AI response
```

---

## Project Structure

```
ChatGPT-Api-Emulation/
├── brain/
│   └── brain.js               ← Spawns Electron, manages IPC connection
├── electron/
│   ├── main.js                ← Electron app that controls the ChatGPT window
│   └── system_prompt.txt      ← Edit this to give the AI a persona or task
├── server.js                  ← HTTP API server (main entry point)
├── cli.js                     ← Command-line tool for quick queries
├── bot.js                     ← Discord bot (see Discord Bot section)
├── registerCommands.js        ← Run once to register Discord slash commands
├── test.js                    ← Test suite for the HTTP API
├── .env.example               ← Copy to .env for Discord bot config
├── package.json
└── README.md
```

---

## Requirements

- **Node.js** v18 or later
- **A ChatGPT account** — the browser window must be logged in
- **Windows users:** see the known issues section below

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Log in to ChatGPT

When you first run the app, a browser window will open at chat.openai.com.  
**You need to be logged in** — the app doesn't log in for you.  
Log in once, and your session will be saved for future runs.

### 3. (Optional) Set a system prompt

Edit `electron/system_prompt.txt` to give the AI specific instructions.  
This is injected as the first message every time the brain starts.

---

## Usage

### Option A: HTTP API Server

Start the server:

```bash
npm start
```

It will open a browser window, wait for ChatGPT to load, then tell you it's ready:

```
[Server] ✅ Ready! HTTP API listening on http://localhost:3000
```

Now send prompts with any HTTP tool:

**curl:**
```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2 + 2?"}'
```

**Response:**
```json
{ "reply": "2 + 2 equals 4." }
```

**Check if ready:**
```bash
curl http://localhost:3000/ready
# → { "ready": true }
```

**Run the test suite** (server must be running first):
```bash
npm test
```

---

### Option B: Command Line

```bash
node cli.js "Write me a haiku about JavaScript"
```

Output:
```
─────────────────────────────────
Curly braces dance,
Undefined haunts the runtime,
null !== undefined
─────────────────────────────────
```

---

### Option C: Discord Bot

See the **Discord Bot** section below.

---

## Adapting to Your Project

### Change the AI's personality

Edit `electron/system_prompt.txt`. Examples:

```
You are a code review assistant. Only discuss code quality, bugs, and best practices.
Always respond with: 1) What's good, 2) What's wrong, 3) How to fix it.
```

```
You are a creative writing partner. Be imaginative, descriptive, and encouraging.
Always suggest at least one unexpected twist.
```

### Use it from your own Node.js code

```js
const { startBrain, sendPrompt } = require('./brain/brain');

await startBrain();
const result = await sendPrompt('Summarise this: ...');
console.log(result.reply);
```

### Change the port

```bash
PORT=8080 npm start
```

---

## How the Code Works (Plain English)

| File | What it does |
|------|-------------|
| `server.js` | Starts the HTTP server and calls `startBrain()`. Listens for POST requests and passes the prompt to the brain. |
| `brain/brain.js` | Spawns the Electron process. Connects to it over a local TCP socket (IPC). Sends prompts and maps responses back using random IDs. |
| `electron/main.js` | The actual Chromium browser window. Opens chat.openai.com, injects the system prompt, then sits waiting for prompts to arrive over IPC. When a prompt arrives, it types it into the ChatGPT box and presses Enter. It watches a network request (`lat/r`) that ChatGPT makes when it finishes generating — that's the signal to read the response and send it back. |
| `electron/system_prompt.txt` | Plain text instructions sent to ChatGPT as the very first message. Gives the AI its "role" for this session. |

---

## Discord Bot

The `bot.js` file connects the same Electron brain to a Discord server instead of an HTTP API. @mention the bot and it replies.

### Additional setup

**1. Create a Discord application**

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable **Server Members Intent** and **Message Content Intent**
5. Copy your **Bot Token**
6. Go to **General Information** and copy your **Application ID**

**2. Invite the bot to your server**

In the Developer Portal go to **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands`, and permissions `Send Messages`, `Read Message History`, `Use Slash Commands`. Open the generated URL to invite the bot.

**3. Configure .env**

```bash
cp .env.example .env
```

Fill in `.env`:
```
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
ALLOWED_CHANNEL_ID=        # optional — leave blank to allow @mentions anywhere
```

**4. Register slash commands (once)**

```bash
npm run register
```

**5. Start the bot**

```bash
npm run discord
```

### Discord slash commands (owner only)

| Command | What it does |
|---|---|
| `/setchannel #channel` | Restrict the bot to one channel. Saved to `.env`. |
| `/getsystemprompt` | Download the current `system_prompt.txt` as a file. |
| `/updatesystemprompt` | Upload a new `system_prompt.txt` file. Restart to apply. |
| `/restart` | Restart via pm2 (only works if running with pm2). |

---

## Limitations

- **Requires a ChatGPT account** — the browser window must be logged in
- **One prompt at a time** — prompts are queued sequentially (ChatGPT can't handle parallel requests)
- **Depends on ChatGPT's DOM** — if OpenAI changes their website layout, the selectors in `main.js` may need updating
- **Needs Electron** — this isn't a lightweight API call; it runs a full browser in the background

---

## Troubleshooting

**TypeError: The "file" argument must be of type string**  
`require('electron')` returned a function instead of a path on your Node/Electron version. In `brain/brain.js`, change:
```js
const electron = require('electron');
```
to:
```js
const electron = require('electron');
const electronPath = typeof electron === 'string' ? electron : electron.toString();
```
Then use `electronPath` in the `spawn()` call instead of `electron`.

**"INSERT_FAIL" in logs**  
The input box selector changed. Open `electron/main.js` and update the `sels` array in `fastDomInsert()`.

**Brain never gets to READY**  
You're probably not logged in to ChatGPT. Check the Electron window that opened.

**Port already in use**  
Change the port: `PORT=3001 npm start`

**Discord bot stuck on "Network not ready" (Windows)**  
The network check uses `ping -c1` which is a Linux flag. On Windows, edit `bot.js` and change:
```js
exec('ping -c1 discord.com', ...)
```
to:
```js
exec('ping -n 1 discord.com', ...)
```

**discord.js GatewayIntentBits is undefined**  
You have discord.js v13 installed. Run `npm install discord.js@14` to get the correct version. Also make sure your entry file is not named `discord.js` — that name conflicts with the package itself. Use `bot.js` instead.
