import { Telegraf } from "telegraf"
import express from "express"
import dotenv from "dotenv"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

// Load environment variables
dotenv.config()

// Get current directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Initialize Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)

// Initialize Express app for API
const app = express()
const PORT = process.env.PORT2 || 3001

// Middleware
app.use(express.json())

// Store user chat IDs (in production, use a database)
const userChatIds = new Map()

// Store verification codes temporarily (in production, use a database)
const verificationCodes = new Map()

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    console.log('Data directory created/verified');
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Load saved chat IDs
async function loadChatIds() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'data', 'chat_ids.json'), 'utf8');
    const chatIds = JSON.parse(data);
    
    // Add each chat ID to the map
    for (const [username, chatId] of Object.entries(chatIds)) {
      userChatIds.set(username.toLowerCase(), chatId);
    }
    
    console.log(`Loaded ${Object.keys(chatIds).length} chat IDs`);
  } catch (error) {
    // File might not exist yet, that's okay
    console.log('No saved chat IDs found');
  }
}

// Save chat ID to file
async function saveChatId(username, chatId) {
  try {
    // Read existing chat IDs
    let chatIds = {};
    try {
      const data = await fs.readFile(path.join(__dirname, 'data', 'chat_ids.json'), 'utf8');
      chatIds = JSON.parse(data);
    } catch (error) {
      // File might not exist yet, that's okay
    }
    
    // Add or update this user's chat ID
    chatIds[username.toLowerCase()] = chatId;
    
    // Save updated chat IDs
    await fs.writeFile(
      path.join(__dirname, 'data', 'chat_ids.json'),
      JSON.stringify(chatIds, null, 2),
      'utf8'
    );
    
    console.log(`Saved chat ID for @${username}: ${chatId}`);
  } catch (error) {
    console.error('Error saving chat ID:', error);
  }
}

// Bot start command
bot.start(async (ctx) => {
  const username = ctx.from.username;
  const chatId = ctx.chat.id;
  
  if (username) {
    // Store the user's chat ID
    userChatIds.set(username.toLowerCase(), chatId);
    
    // Save to file for persistence
    await saveChatId(username, chatId);
    
    await ctx.reply(`Salom, ${ctx.from.first_name}! Men tasdiqlash kodlarini yuborish uchun botman. Ro'yxatdan o'tish jarayonida sizga kod yuboriladi.`);
  } else {
    await ctx.reply('Salom! Iltimos, Telegram profilingizda username o\'rnating, aks holda tizim sizni aniqlay olmaydi.');
  }
});

// Help command
bot.help((ctx) => ctx.reply('Men tasdiqlash kodlarini yuborish uchun botman. Ro\'yxatdan o\'tish jarayonida sizga kod yuboriladi.'));

// API endpoint to send verification code
app.post('/send-verification-code', async (req, res) => {
  try {
    const { telegram } = req.body;
    
    if (!telegram) {
      return res.status(400).json({ success: false, error: 'Telegram username is required' });
    }
    
    console.log(`Received request to send verification code to: ${telegram}`);
    
    // Generate a random 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store code with expiration (10 minutes)
    verificationCodes.set(telegram.toLowerCase(), {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });
    
    // Get chat ID for this username
    const chatId = userChatIds.get(telegram.toLowerCase());
    
    if (!chatId) {
      console.log(`Chat ID not found for username: ${telegram}`);
      return res.status(400).json({ 
        success: false, 
        error: 'Telegram username not found. Please start the bot first by sending /start to @ayhsdvbot' 
      });
    }
    
    console.log(`Found chat ID for ${telegram}: ${chatId}`);
    console.log(`Sending verification code: ${code}`);
    
    // Send code via Telegram
    try {
      await bot.telegram.sendMessage(
        chatId,
        `Sizning tasdiqlash kodingiz: ${code}\n\nBu kod 10 daqiqa davomida amal qiladi.`
      );
      
      console.log(`Verification code sent successfully to ${telegram}`);
      return res.json({ success: true });
    } catch (error) {
      console.error('Error sending Telegram message:', error);
      return res.status(500).json({ success: false, error: 'Failed to send Telegram message' });
    }
  } catch (error) {
    console.error('Error sending verification code:', error);
    return res.status(500).json({ success: false, error: 'Failed to send verification code' });
  }
});

// API endpoint to verify code
app.post('/verify-code', (req, res) => {
  try {
    const { telegram, code } = req.body;
    
    if (!telegram || !code) {
      return res.status(400).json({ success: false, error: 'Telegram username and code are required' });
    }
    
    console.log(`Verifying code for ${telegram}: ${code}`);
    
    // Get stored verification data
    const verificationData = verificationCodes.get(telegram.toLowerCase());
    
    if (!verificationData) {
      console.log(`No verification code found for ${telegram}`);
      return res.status(400).json({ success: false, error: 'No verification code found for this user' });
    }
    
    // Check if code is expired
    if (Date.now() > verificationData.expiresAt) {
      console.log(`Verification code expired for ${telegram}`);
      verificationCodes.delete(telegram.toLowerCase());
      return res.status(400).json({ success: false, error: 'Verification code has expired' });
    }
    
    // Check if code matches
    if (verificationData.code !== code) {
      console.log(`Invalid verification code for ${telegram}. Expected: ${verificationData.code}, Got: ${code}`);
      return res.status(400).json({ success: false, error: 'Invalid verification code' });
    }
    
    console.log(`Verification successful for ${telegram}`);
    
    // Code is valid, delete it from storage
    verificationCodes.delete(telegram.toLowerCase());
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Error verifying code:', error);
    return res.status(500).json({ success: false, error: 'Failed to verify code' });
  }
});

// API endpoint to register user
app.post("/register", async (req, res) => {
  try {
    const userData = req.body

    // Validate required fields
    const requiredFields = ["fullName", "studentId", "email", "phone", "telegram", "login", "password"]

    for (const field of requiredFields) {
      if (!userData[field]) {
        return res.status(400).json({ success: false, error: `${field} is required` })
      }
    }

    // In a real application, you would send this data to your main backend API
    // For this example, we'll just return success

    // Notify user via Telegram
    const chatId = userChatIds.get(userData.telegram.replace("@", "").toLowerCase())
    if (chatId) {
      await bot.telegram.sendMessage(
        chatId,
        `Tabriklaymiz, ${userData.fullName}! Siz muvaffaqiyatli ro'yxatdan o'tdingiz.\n\nLogin: ${userData.login}`,
      )
    }

    return res.json({ success: true, userId: Date.now() })
  } catch (error) {
    console.error("Error registering user:", error)
    return res.status(500).json({ success: false, error: "Failed to register user" })
  }
})

// Start Express server and Telegram bot
async function startServer() {
  try {
    // Ensure data directory exists
    await ensureDataDir();
    
    // Load saved chat IDs
    await loadChatIds();
    
    // Start Express server
    app.listen(PORT, () => {
      console.log(`Bot API server running on port ${PORT}`);
    });
    
    // Start Telegram bot
    await bot.launch();
    console.log('Telegram bot started successfully');
    
    // Enable graceful stop
    process.once('SIGINT', () => {
      console.log('Stopping bot and server...');
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      console.log('Stopping bot and server...');
      bot.stop('SIGTERM');
    });
    
    console.log('Bot server is now running. Press Ctrl+C to stop.');
  } catch (error) {
    console.error('Error starting server:', error);
  }
}

// Start the server
startServer();

// Keep the process alive
process.stdin.resume();
