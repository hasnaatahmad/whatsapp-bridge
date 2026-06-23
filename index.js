const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const qrcodeImage = require('qrcode');
const express = require('express');

const app = express();
app.use(express.json());

const chromiumPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
console.log(`Using Chromium at: ${chromiumPath}`);

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: chromiumPath,
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

let isClientReady = false;

client.on('ready', () => {
  console.log('WhatsApp bridge is ready!');
  isClientReady = true;
});

client.on('disconnected', () => {
  console.log('WhatsApp client disconnected.');
  isClientReady = false;
});

client.initialize();

// Health check endpoint
app.get('/', (req, res) => {
  res.send(`WhatsApp bridge is running. Chromium path: ${chromiumPath}. Check /qr to scan or /status to check connection.`);
});

// View the QR code as an actual scannable image
app.get('/qr', async (req, res) => {
  if (lastQr) {
    try {
      const qrImageDataUrl = await qrcodeImage.toDataURL(lastQr, { width: 400, margin: 2 });
      res.send(`
        <html>
          <body style="background:#111; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; font-family:sans-serif; color:white;">
            <h2>Scan this with WhatsApp (Linked Devices)</h2>
            <img src="${qrImageDataUrl}" style="background:white; padding:16px; border-radius:8px;" />
            <p>This page refreshes every 20 seconds in case the code expires.</p>
            <script>setTimeout(() => location.reload(), 20000)</script>
          </body>
        </html>
      `);
    } catch (e) {
      res.status(500).send('Error generating QR image: ' + e.message);
    }
  } else {
    res.send(`
      <html>
        <body style="background:#111; color:white; font-family:sans-serif; text-align:center; padding-top:100px;">
          <h2>No QR code yet, or already connected.</h2>
          <p>Check <a href="/status" style="color:#4af">/status</a> to see connection state.</p>
          <p>This page refreshes every 5 seconds.</p>
          <script>setTimeout(() => location.reload(), 5000)</script>
        </body>
      </html>
    `);
  }
});

app.get('/status', async (req, res) => {
  res.json({ isClientReady });
});

// Quick browser-triggerable test (visit this URL directly to send a test message)
app.get('/test-send', async (req, res) => {
  try {
    if (!isClientReady) {
      return res.status(503).json({ error: 'WhatsApp client is not ready yet. Wait a moment and try again, or check /status.' });
    }

    const groupName = req.query.group;
    if (!groupName) {
      return res.send('Add ?group=YourGroupName to the URL, e.g. /test-send?group=Accounting Group');
    }

    const chats = await client.getChats();
    const group = chats.find(chat => chat.name === groupName);

    if (!group) {
      const allGroups = chats.filter(c => c.isGroup).map(c => c.name);
      return res.status(404).json({ error: 'Group not found', availableGroups: allGroups });
    }

    await group.sendMessage('✅ Test message from the automation bridge. If you see this, the connection works!');
    res.json({ success: true, message: 'Test message sent!' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// This is the endpoint n8n will call
app.post('/send', async (req, res) => {
  try {
    if (!isClientReady) {
      return res.status(503).json({ error: 'WhatsApp client is not ready yet.' });
    }

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
