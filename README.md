# ChatGPT-Api-Emulation

A reusable ChatGPT automation wrapper. **Text goes in, replies come out.**  
No Discord. No fuss. Just a clean API you can plug into any project.

---

## What This Actually Does

The original project used Electron (a full Chromium browser in a Node.js wrapper) to automate the ChatGPT *website* — like a robot sitting at a keyboard typing prompts and reading the responses. This keeps all that machinery but throws away the Discord layer, replacing it with a simple HTTP API and a CLI tool.

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
ai-runner/
├── src/
│   ├── server.js              ← HTTP API server (main entry point)
│   ├── cli.js                 ← Command-line tool for quick queries
│   ├── brain/
│   │   └── brain.js           ← Spawns Electron, manages IPC connection
│   └── electron/
│       ├── main.js            ← Electron app that controls the ChatGPT window
│       └── system_prompt.txt  ← Edit this to give the AI a persona or task
├── package.json
└── README.md
```

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
Edit `src/electron/system_prompt.txt` to give the AI specific instructions.  
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

---

### Option B: Command Line

```bash
node src/cli.js "Write me a haiku about JavaScript"
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

## Adapting to Your Project

### Change the AI's personality
Edit `src/electron/system_prompt.txt`. Examples:

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
const { startBrain, sendPrompt } = require('./src/brain/brain');

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
| `brain.js` | Spawns the Electron process. Connects to it over a local TCP socket (IPC). Sends prompts and maps responses back using random IDs. |
| `electron/main.js` | The actual Chromium browser window. Opens chat.openai.com, injects the system prompt, then sits waiting for prompts to arrive over IPC. When a prompt arrives, it types it into the ChatGPT box and presses Enter. It watches a network request (`lat/r`) that ChatGPT makes when it finishes generating — that's the signal to read the response and send it back. |
| `system_prompt.txt` | Plain text instructions sent to ChatGPT as the very first message. Gives the AI its "role" for this session. |

---

## Limitations

- **Requires a ChatGPT account** — the browser window must be logged in
- **One prompt at a time** — prompts are queued sequentially (ChatGPT can't handle parallel requests)
- **Depends on ChatGPT's DOM** — if OpenAI changes their website layout, the selectors in `main.js` may need updating
- **Needs Electron** — this isn't a lightweight API call; it runs a full browser in the background

---

## Troubleshooting

**"INSERT_FAIL" in logs**  
The input box selector changed. Open `electron/main.js` and update the `sels` array in `fastDomInsert()`.

**Brain never gets to READY**  
You're probably not logged in to ChatGPT. Check the Electron window that opened.

**Port already in use**  
Change the port: `PORT=3001 npm start`
