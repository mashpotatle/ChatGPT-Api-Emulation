// cli.js — Run a single prompt from the command line and print the reply.
//
// Usage:
//   node cli.js "What is the capital of France?"
//   node cli.js "Write me a haiku about dogs"
//
// Great for shell scripts, piping into other tools, or just testing.

const brain = require('./brain/brain'); // was ./brain/brain — still correct

const prompt = process.argv.slice(2).join(' ').trim();

if (!prompt) {
    console.error('Usage: node cli.js "your question here"');
    process.exit(1);
}

(async () => {
    console.log('[CLI] Starting brain...');
    await brain.startBrain();

    console.log(`[CLI] Asking: ${prompt}\n`);
    const result = await brain.sendPrompt(prompt);

    console.log('─────────────────────────────────');
    console.log(result?.reply || '(no reply)');
    console.log('─────────────────────────────────');

    process.exit(0);
})();
