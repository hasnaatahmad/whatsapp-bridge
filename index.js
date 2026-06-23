const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
app.use(express.json());

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  }
});

let lastQr = null;

client.on('qr', (qr) => {
  console.log('Scan this QR code with WhatsApp:');
  qrcode.generate(qr, { small: true });
  lastQr = qr;
});

client.on('ready', () => {
  console.log('WhatsApp bridge is ready!');
});

client.initialize();

// Health check endpoint
app.get('/', (req, res) => {
  res.send('WhatsApp bridge is running. Check /qr to scan or /status to check connection.');
});

// View the QR code as text (since Render logs can be hard to read)
app.get('/qr', (req, res) => {
  if (lastQr) {
    res.send(`<pre>Scan this with WhatsApp (Linked Devices):\n\n${lastQr}</pre><p>If this doesn't render as a scannable code, check the Render logs instead, the QR renders better there.</p>`);
  } else {
    res.send('No QR code yet, or already connected. Check /status.');
  }
});

app.get('/status', async (req, res) => {
  try {
    const state = await client.getState();
    res.json({ state });
  } catch (e) {
    res.json({ state: 'not ready', error: e.message });
  }
});

// This is the endpoint n8n will call
app.post('/send', async (req, res) => {
  try {
    const { groupName, message } = req.body;

    if (!groupName || !message) {
      return res.status(400).json({ error: 'groupName and message are required' });
    }

    const chats = await client.getChats();
    const group = chats.find(chat => chat.name === groupName);

    if (!group) {
      return res.status(404).json({ error: 'Group not found', availableGroups: chats.filter(c => c.isGroup).map(c => c.name) });
    }

    await group.sendMessage(message);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bridge server running on port ${PORT}`));
