import speakeasy from "speakeasy";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import mysql from "mysql2";
import nodemailer from "nodemailer";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs"; 
import path from "path"; 
import { fileURLToPath } from "url"; 
import crypto from "crypto"; // ✅ Added for decryption

// ✅ Setup directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, "uploads");
const TEMP_DIR = path.join(__dirname, "temp"); // ✅ For decrypted files

// Ensure Upload & Temp Folders Exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

dotenv.config({ path: "./.env" });

const app = express();
app.use(cors());

// ✅ CRITICAL: Support Large Payloads for Chunks
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));

// ✅ Setup HTTP + WebSocket server
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ✅ Database Connection with Pool (More Reliable)
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD, 
  database: process.env.DB_DATABASE || "project_backend",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test database connection
db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ DB Connection Error:", err.message);
    console.error("Make sure MySQL is running and database exists!");
  } else {
    console.log("✅ MySQL Connected to 'project_backend'");
    connection.release();
  }
});

// ✅ Email Configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// ✅ JWT Secret Key (used to sign/verify tokens)
const JWT_SECRET = process.env.JWT_SECRET || "securevault_jwt_secret_key_2026";
const JWT_EXPIRES_IN = "24h"; // Token valid for 24 hours

// ✅ JWT Middleware — checks if user is logged in
// Think of this as a "security guard" that checks your ticket before letting you in
function authenticateToken(req, res, next) {
    // 1. Read the token from the request header
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // "Bearer <token>" → extract <token>

    // 2. No token? You're not logged in!
    if (!token) {
        return res.status(401).json({ message: "Access denied. Please login first." });
    }

    // 3. Verify the token is real and not expired
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: "Session expired. Please login again." });
        }
        // 4. Token is valid! Attach user info to the request
        req.user = decoded; // Contains { userId, email }
        next(); // Let the request continue
    });
}

// ✅ WebSocket Connection
io.on("connection", (socket) => {
  console.log("⚡ Dashboard connected:", socket.id);
});

// ✅ Helper: Log Activity
function logActivity(userId, action, req = null) {
  let ip = "Unknown";
  let device = "Unknown";

  if (req) {
    ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
    if (ip.includes("::ffff:")) ip = ip.split("::ffff:")[1];
    device = req.headers["user-agent"] || "Unknown Device";
  }

  const sql = "INSERT INTO activity_logs (user_id, action, ip_address, device) VALUES (?, ?, ?, ?)";
  db.query(sql, [userId, action, ip, device], (err) => {
    if (err) console.error("❌ Logging Error:", err);
    else {
      io.emit("activityUpdate", { userId, action, time: new Date() });
    }
  });
}

// ==========================================
// 🔐 DECRYPTION HELPER FUNCTIONS
// ==========================================

/**
 * Decrypt the AES key using RSA private key
 * @param {string} encryptedAESKeyBase64 - Base64 encoded encrypted AES key
 * @param {string} privateKeyPem - RSA private key in PEM format
 * @returns {Buffer} - Decrypted AES key
 */
function decryptAESKey(encryptedAESKeyBase64, privateKeyPem) {
    const encryptedBuffer = Buffer.from(encryptedAESKeyBase64, 'base64');
    const decryptedKey = crypto.privateDecrypt(
        {
            key: privateKeyPem,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
        },
        encryptedBuffer
    );
    return decryptedKey;
}

/**
 * Decrypt file chunks using AES-GCM
 * @param {string} encryptedFilePath - Path to encrypted file
 * @param {Buffer} aesKey - Decrypted AES key
 * @param {string} outputPath - Where to save decrypted file
 */
function decryptFile(encryptedFilePath, aesKey, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            const encryptedData = fs.readFileSync(encryptedFilePath);
            const decryptedChunks = [];
            
            let offset = 0;
            const CHUNK_OVERHEAD = 12 + 16; // IV (12 bytes) + Auth Tag (16 bytes)
            
            // Process each chunk
            while (offset < encryptedData.length) {
                // Read IV (first 12 bytes of chunk)
                const iv = encryptedData.slice(offset, offset + 12);
                offset += 12;
                
                // Find next IV position or end of file
                let nextChunkStart = encryptedData.indexOf(iv, offset + 100); // Look ahead
                let chunkEnd;
                
                if (nextChunkStart === -1 || offset + 5*1024*1024 + 100 < nextChunkStart) {
                    // This is likely the last chunk or we use max chunk size
                    const remainingSize = encryptedData.length - offset;
                    const maxChunkSize = 5 * 1024 * 1024 + 16; // 5MB + auth tag
                    chunkEnd = offset + Math.min(remainingSize, maxChunkSize);
                } else {
                    chunkEnd = nextChunkStart;
                }
                
                // Read encrypted chunk data (includes auth tag)
                const encryptedChunk = encryptedData.slice(offset, chunkEnd);
                offset = chunkEnd;
                
                try {
                    // Decrypt this chunk
                    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
                    
                    // Extract auth tag (last 16 bytes)
                    const authTag = encryptedChunk.slice(-16);
                    const ciphertext = encryptedChunk.slice(0, -16);
                    
                    decipher.setAuthTag(authTag);
                    
                    let decrypted = decipher.update(ciphertext);
                    decrypted = Buffer.concat([decrypted, decipher.final()]);
                    
                    decryptedChunks.push(decrypted);
                } catch (decryptErr) {
                    console.error('Chunk decryption error at offset', offset - chunkEnd, decryptErr);
                    // If this fails, try alternative chunk detection
                    continue;
                }
            }
            
            // Combine all decrypted chunks
            const finalDecrypted = Buffer.concat(decryptedChunks);
            fs.writeFileSync(outputPath, finalDecrypted);
            
            console.log(`✅ Decrypted file saved: ${outputPath} (${finalDecrypted.length} bytes)`);
            resolve(outputPath);
        } catch (err) {
            console.error('Decryption error:', err);
            reject(err);
        }
    });
}

/**
 * Convert base64 private key to PEM format
 */
function base64ToPem(base64Key, type = 'PRIVATE') {
    const pem = `-----BEGIN ${type} KEY-----\n${base64Key.match(/.{1,64}/g).join('\n')}\n-----END ${type} KEY-----`;
    return pem;
}

// ==========================================
// 1️⃣ AUTHENTICATION & LOGIN
// ==========================================

// Register User
app.post("/api/register", async (req, res) => {
  const { email, password, publicKey, encryptedPrivateKey } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Missing fields" });

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const sql = "INSERT INTO users (email, passwordHash, publicKey, encryptedPrivateKey) VALUES (?, ?, ?, ?)";
    
    db.query(sql, [email, passwordHash, publicKey, encryptedPrivateKey], (err, result) => {
      if (err) {
        console.error("Registration Error:", err);
        return res.status(500).json({ message: "Database error", error: err.message });
      }

      logActivity(result.insertId, "Account Created", req);
      res.json({ message: "User registered successfully" });
    });
  } catch (error) {
    console.error("Hash Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ✅ LOGIN - Only send OTP if MFA is enabled
app.post("/api/login", (req, res) => {
    const { email, password } = req.body;
    db.query("SELECT * FROM users WHERE email = ?", [email], async (err, result) => {
        if (err) return res.status(500).json({ message: "DB Error" });
        if (!result || result.length === 0) return res.status(400).json({ message: "User not found" });

        const user = result[0];
        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) return res.status(400).json({ message: "Invalid credentials" });

        // ✅ ONLY send Email OTP if user has enabled it in Settings
        if (user.mfa_enabled === 1) {
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            db.query("UPDATE users SET mfa_token = ?, mfa_expires = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?", [code, user.id], (updErr) => {
                if (updErr) return res.status(500).json({ message: "Failed to set OTP" });
                
                transporter.sendMail({
                    from: "Secure Vault", to: email, subject: "🔐 Login Code",
                    text: `Your Secure Vault login code is: ${code}`
                });
                res.json({ message: "Check email for code", mfaRequired: true });
            });
        } else {
            // ✅ MFA is OFF: Log in immediately
            db.query("UPDATE users SET last_login = NOW() WHERE id = ?", [user.id]);
            logActivity(user.id, "Login Successful (MFA Disabled)", req);

            // ✅ Generate JWT token (the "movie ticket")
            const token = jwt.sign(
                { userId: user.id, email: email },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES_IN }
            );

            res.json({
                message: "Success",
                mfaRequired: false,
                token: token,
                publicKey: user.publicKey,
                encryptedPrivateKey: user.encryptedPrivateKey
            });
        }
    });
});

// ✅ LOGIN Step 2: Verify OTP (only called if MFA is enabled)
app.post("/api/login/verify-mfa", (req, res) => {
    const { email, token } = req.body;
    const sql = "SELECT * FROM users WHERE email = ? AND mfa_token = ? AND mfa_expires > NOW()";
    
    db.query(sql, [email, token], (err, result) => {
        if (err) {
            console.error("MFA Verify Error:", err);
            return res.status(500).json({ message: "DB Error" });
        }
        if (!result || result.length === 0) return res.status(400).json({ message: "Invalid or expired code" });

        const user = result[0];
        
        // ✅ Clear OTP and update last_login
        db.query("UPDATE users SET mfa_token = NULL, last_login = NOW() WHERE id = ?", [user.id], (updateErr) => {
            if (updateErr) console.error("Last login update error:", updateErr);
        });
        
        logActivity(user.id, "Login Successful (MFA Verified)", req);

        // ✅ Generate JWT token after MFA verification
        const token = jwt.sign(
            { userId: user.id, email: email },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        console.log(`✅ User ${email} verified MFA and logged in`);
        res.json({
            message: "Success",
            token: token,
            publicKey: user.publicKey,
            encryptedPrivateKey: user.encryptedPrivateKey
        });
    });
});

// ==========================================
// 🔐 EMAIL MFA SETTINGS (Simplified)
// ==========================================

// ✅ Toggle Email MFA ON/OFF
app.post("/api/mfa/toggle", authenticateToken, (req, res) => {
    const { email, enabled } = req.body; 
    const status = enabled ? 1 : 0;

    db.query("UPDATE users SET mfa_enabled = ? WHERE email = ?", [status, email], (err) => {
        if (err) {
            console.error("❌ Toggle Error:", err);
            return res.status(500).json({ message: "Database Error" });
        }
        
        logActivity(null, `MFA ${enabled ? 'Enabled' : 'Disabled'} for ${email}`, req);
        res.json({ message: `MFA is now ${enabled ? 'Enabled' : 'Disabled'}` });
    });
});

// ✅ Get current MFA status
app.get("/api/mfa/status/:email", authenticateToken, (req, res) => {
    const { email } = req.params;
    db.query("SELECT mfa_enabled FROM users WHERE email = ?", [email], (err, results) => {
        if (err || !results.length) {
            return res.status(500).json({ message: "Error" });
        }
        res.json({ mfaEnabled: results[0].mfa_enabled === 1 });
    });
});

// ==========================================
// 📁 FILE UPLOAD (Chunked)
// ==========================================

const uploadSessions = {};

// Step 1: Initialize Upload
app.post("/api/upload/init", authenticateToken, (req, res) => {
    const { fileName } = req.body;
    const serverFileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    uploadSessions[serverFileName] = { chunks: [], fileName };
    
    console.log(`📤 Upload session started: ${serverFileName}`);
    res.json({ serverFileName });
});

// Step 2: Receive Chunks
app.post("/api/upload/chunk", authenticateToken, (req, res) => {
    const { serverFileName, chunkData } = req.body;
    
    if (!uploadSessions[serverFileName]) {
        return res.status(400).json({ message: "Invalid session" });
    }

    const chunk = Buffer.from(chunkData, 'base64');
    uploadSessions[serverFileName].chunks.push(chunk);
    
    res.json({ message: "Chunk received" });
});

// Step 3: Finalize Upload
app.post("/api/upload/finalize", authenticateToken, (req, res) => {
    const { email, fileName, serverFileName, fileSize, encryptedAESKey, totalChunks } = req.body;

    if (!uploadSessions[serverFileName]) {
        return res.status(400).json({ message: "Session not found" });
    }

    // Combine all chunks
    const allChunks = Buffer.concat(uploadSessions[serverFileName].chunks);
    const filePath = path.join(UPLOAD_DIR, serverFileName);
    fs.writeFileSync(filePath, allChunks);

    // Save to database
    db.query("SELECT id FROM users WHERE email = ?", [email], (err, users) => {
        if (err || !users.length) {
            delete uploadSessions[serverFileName];
            return res.status(400).json({ message: "User not found" });
        }

        const userId = users[0].id;
        const sql = "INSERT INTO files (user_id, fileName, stored_name, fileSize, encryptedAESKey) VALUES (?, ?, ?, ?, ?)";

        db.query(sql, [userId, fileName, serverFileName, fileSize, encryptedAESKey], (err2) => {
            delete uploadSessions[serverFileName];

            if (err2) {
                console.error("DB Save Error:", err2);
                return res.status(500).json({ message: "Save failed" });
            }

            logActivity(userId, `Uploaded: ${fileName}`, req);
            io.emit("fileUploaded", { userId, fileName });
            
            console.log(`✅ File saved: ${fileName}`);
            res.json({ message: "Upload complete" });
        });
    });
});

// ==========================================
// 📊 DASHBOARD STATS
// ==========================================

app.get("/api/dashboard/:email", authenticateToken, (req, res) => {
    const { email } = req.params;

    db.query("SELECT id, last_login FROM users WHERE email = ?", [email], (err, users) => {
        if (err || !users || users.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const userId = users[0].id;
        const lastLogin = users[0].last_login;

        db.query("SELECT COUNT(*) as count, IFNULL(SUM(fileSize), 0) as totalBytes FROM files WHERE user_id = ?", 
            [userId], (err2, stats) => {
            
            if (err2) {
                return res.status(500).json({ message: "Error fetching stats" });
            }

            const totalFiles = stats[0].count;
            const totalMB = (stats[0].totalBytes / (1024 * 1024)).toFixed(2);

            res.json({
                totalFiles,
                totalMB,
                lastLogin: lastLogin || "First Login"
            });
        });
    });
});

// ==========================================
// 📋 FILE LISTING
// ==========================================

app.get("/api/files/:email", authenticateToken, (req, res) => {
    const { email } = req.params;

    db.query("SELECT id FROM users WHERE email = ?", [email], (err, users) => {
        if (err || !users.length) {
            return res.status(404).json({ message: "User not found" });
        }

        const userId = users[0].id;
        
        // ✅ CRITICAL: Include encryptedAESKey
        db.query(
            `SELECT 
                fileName, 
                fileSize, 
                encryptedAESKey,
                stored_name,
                created_at as encryptedOn 
            FROM files 
            WHERE user_id = ? 
            ORDER BY created_at DESC`,
            [userId], 
            (err2, files) => {
                if (err2) {
                    console.error("Error fetching files:", err2);
                    return res.status(500).json({ message: "Error" });
                }
                
                res.json(files);
            }
        );
    });
});

// ✅ Fetch user's public key (safe to expose)
app.get("/api/user/publickey/:email", authenticateToken, (req, res) => {
    const { email } = req.params;

    db.query(
        "SELECT publicKey FROM users WHERE email = ?",
        [email],
        (err, result) => {
            if (err || result.length === 0) {
                return res.status(404).json({ message: "User not found" });
            }
            res.json({ publicKey: result[0].publicKey });
        }
    );
});

// ==========================================
// 🔐 FILE ACCESS OTP SYSTEM
// ==========================================

// Request OTP for file access
app.post("/api/file/request-access", authenticateToken, (req, res) => {
    const { email, fileName } = req.body;
    
    db.query("SELECT id FROM users WHERE email = ?", [email], (err, users) => {
        if (err || !users.length) {
            return res.status(404).json({ message: "User not found" });
        }

        const userId = users[0].id;
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        db.query("UPDATE users SET file_otp = ?, file_otp_expires = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?",
            [otp, userId], (err2) => {
            
            if (err2) {
                return res.status(500).json({ message: "Error generating OTP" });
            }

            transporter.sendMail({
                from: "Secure Vault",
                to: email,
                subject: "🔐 File Access Code",
                text: `Your access code for "${fileName}" is: ${otp}\n\nValid for 10 minutes.`
            });

            console.log(`📧 OTP sent to ${email} for file: ${fileName} (Code: ${otp})`);
            res.json({ message: "OTP sent" });
        });
    });
});

// ==========================================
// SERVER ENDPOINTS - ZERO-KNOWLEDGE ARCHITECTURE
// ==========================================
// Replace your /api/file/verify-access endpoint with this

// ✅ Verify OTP and Return ENCRYPTED File (Zero-Knowledge)
app.post("/api/file/verify-access", authenticateToken, (req, res) => {
    const { email, fileName, otp } = req.body;
    
    console.log(`🔐 Verify-access request for: ${fileName} by ${email}`);
    
    // Check OTP
    db.query("SELECT id FROM users WHERE email = ? AND file_otp = ? AND file_otp_expires > NOW()", [email, otp], (err, users) => {
        if (err) {
            console.error("OTP Verify Error:", err);
            return res.status(500).json({ message: "DB Error" });
        }
        if (!users || users.length === 0) {
            console.log("❌ Invalid or expired OTP");
            return res.status(403).json({ message: "Invalid or expired OTP" });
        }

        const userId = users[0].id;
        
        console.log("✅ OTP verified for user:", userId);

        // Get File Path
        db.query("SELECT stored_name, fileName FROM files WHERE user_id = ? AND fileName = ?", [userId, fileName], (err2, files) => {
            if (err2) {
                console.error("File Fetch Error:", err2);
                return res.status(500).json({ message: "DB Error" });
            }
            if (!files || files.length === 0) {
                console.log("❌ File not found");
                return res.status(404).json({ message: "File not found" });
            }

            const storedName = files[0].stored_name;
            const filePath = path.join(UPLOAD_DIR, storedName);

            // Check if file exists
            if (!fs.existsSync(filePath)) {
                console.error("❌ File not found on disk:", filePath);
                return res.status(404).json({ message: "File not found on disk" });
            }

            // Clear OTP (one-time use)
            db.query("UPDATE users SET file_otp = NULL, file_otp_expires = NULL WHERE id = ?", [userId], (clearErr) => {
                if (clearErr) console.error("Failed to clear OTP:", clearErr);
            });

            // ✅ CRITICAL: Return ENCRYPTED file (Zero-Knowledge)
            // The file is stored encrypted, we just stream it as-is
            // Client will decrypt it using their private key
            
            console.log(`📦 Sending encrypted file: ${fileName}`);
            
            // Get file stats
            const stats = fs.statSync(filePath);
            const fileSize = stats.size;

            // Set headers for encrypted file download
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', fileSize);
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}.encrypted"`);

            // Stream the ENCRYPTED file
            const fileStream = fs.createReadStream(filePath);
            
            fileStream.on('error', (streamErr) => {
                console.error("Stream error:", streamErr);
                if (!res.headersSent) {
                    res.status(500).json({ message: "Stream error" });
                }
            });

            fileStream.pipe(res);

            fileStream.on('end', () => {
                console.log(`✅ Encrypted file sent successfully: ${fileName}`);
                logActivity(userId, `Downloaded encrypted: ${fileName}`, req);
            });
        });
    });
});

// ==========================================
// OPTIONAL: Get File Info with Encrypted AES Key
// ==========================================
// This endpoint is already covered by /api/files/:email
// which should return encryptedAESKey for each file
// Make sure your existing endpoint includes this field!

// Example of what /api/files/:email should return:
/*
[
    {
        fileName: "video.mkv",
        fileSize: 1305944622,
        encryptedAESKey: "base64encodedencryptedkey...",  // ← CRITICAL!
        encryptedOn: "2026-02-07",
        stored_name: "1234567_video.mkv"
    }
]
*/

// ==========================================
// 📹 STREAM ENCRYPTED FILE (for client-side decryption)
// ==========================================

app.post("/api/file/get-encrypted-stream", authenticateToken, async (req, res) => {
    const { email, fileName, otp } = req.body;
    
    console.log(`📹 Encrypted stream request for: ${fileName} by ${email}`);
    
    try {
        // Get user
        const users = await new Promise((resolve, reject) => {
            db.query("SELECT id FROM users WHERE email = ?", [email], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });

        if (!users || users.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const userId = users[0].id;

        // Verify OTP
        if (!otp) {
            return res.status(403).json({ message: "OTP required" });
        }

        const otpCheck = await new Promise((resolve, reject) => {
            db.query("SELECT file_otp FROM users WHERE id = ? AND file_otp = ? AND file_otp_expires > NOW()",
                [userId, otp], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });

        if (!otpCheck || otpCheck.length === 0) {
            return res.status(403).json({ message: "Invalid or expired OTP" });
        }

        // Clear OTP
        db.query("UPDATE users SET file_otp = NULL WHERE id = ?", [userId]);

        // Get file info
        const files = await new Promise((resolve, reject) => {
            db.query("SELECT stored_name, fileName, fileSize, encryptedAESKey FROM files WHERE user_id = ? AND fileName = ?",
                [userId, fileName], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });

        if (!files || files.length === 0) {
            return res.status(404).json({ message: "File not found" });
        }

        const fileRecord = files[0];
        const encryptedFilePath = path.join(UPLOAD_DIR, fileRecord.stored_name);

        if (!fs.existsSync(encryptedFilePath)) {
            return res.status(404).json({ message: "File not found on disk" });
        }

        logActivity(userId, `Accessed: ${fileName}`, req);
        res.setHeader(
  "Access-Control-Expose-Headers",
  "X-Encrypted-AES-Key, X-File-Name, X-File-Size"
);
        // Stream the file as binary
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-File-Name', encodeURIComponent(fileRecord.fileName));
        res.setHeader('X-File-Size', fileRecord.fileSize);
        const encryptedAESKey = fileRecord.encryptedAESKey
    .replace(/\r?\n|\r/g, '')  // remove newlines
    .trim();                   // remove spaces

console.log("🔑 AES KEY LENGTH FROM DB:", encryptedAESKey.length);

if (!encryptedAESKey || encryptedAESKey.length < 300) {
    console.error("❌ Invalid AES key in DB");
    return res.status(500).json({ message: "Invalid AES key" });
}

res.setHeader('X-Encrypted-AES-Key', encryptedAESKey);

        
        const fileStream = fs.createReadStream(encryptedFilePath);
        fileStream.pipe(res);

    } catch (err) {
        console.error("Stream error:", err);
        res.status(500).json({ message: "Error: " + err.message });
    }
});

// ==========================================
// 🗑️ DELETE FILE
// ==========================================

app.delete("/api/deleteFile", authenticateToken, (req, res) => {
    const { email, fileName } = req.body;

    db.query("SELECT id FROM users WHERE email = ?", [email], (err, users) => {
        if (err || !users.length) {
            return res.status(404).json({ message: "User not found" });
        }

        const userId = users[0].id;

        db.query("SELECT stored_name FROM files WHERE user_id = ? AND fileName = ?",
            [userId, fileName], (err2, files) => {

            if (err2 || !files.length) {
                return res.status(404).json({ message: "File not found" });
            }

            const storedName = files[0].stored_name;
            const filePath = path.join(UPLOAD_DIR, storedName);

            // Delete from disk
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            // Delete from database
            db.query("DELETE FROM files WHERE user_id = ? AND fileName = ?",
                [userId, fileName], (err3) => {

                if (err3) {
                    return res.status(500).json({ message: "Delete failed" });
                }

                logActivity(userId, `Deleted: ${fileName}`, req);
                io.emit("fileDeleted", { userId, fileName });

                res.json({ message: "File deleted" });
            });
        });
    });
});

// ==========================================
// 📊 ACTIVITY LOGS
// ==========================================

app.get("/api/activity/all/:email", authenticateToken, (req, res) => {
    const { email } = req.params;

    db.query("SELECT id FROM users WHERE email = ?", [email], (err, users) => {
        if (err || !users.length) {
            return res.status(404).json({ message: "User not found" });
        }

        const userId = users[0].id;

        db.query("SELECT action, ip_address, device, created_at as timestamp FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
            [userId], (err2, logs) => {

            if (err2) {
                return res.status(500).json({ message: "Error" });
            }

            res.json(logs);
        });
    });
});

// ==========================================
// 🔑 PASSWORD RESET
// ==========================================

app.post("/api/forgot-password", (req, res) => {
    const { email } = req.body;
    
    db.query("SELECT id FROM users WHERE email = ?", [email], (err, users) => {
        if (err || !users.length) {
            return res.status(404).json({ message: "User not found" });
        }

        const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
        
        db.query("UPDATE users SET reset_token = ?, reset_expires = DATE_ADD(NOW(), INTERVAL 30 MINUTE) WHERE email = ?",
            [resetToken, email], (err2) => {
            
            if (err2) {
                return res.status(500).json({ message: "Error" });
            }

            console.log(`🔑 Reset code for ${email}: ${resetToken}`);
            
            transporter.sendMail({
                from: "Secure Vault",
                to: email,
                subject: "Password Reset Code",
                text: `Your password reset code is: ${resetToken}`
            });

            res.json({ message: "Reset code sent" });
        });
    });
});

app.post("/api/reset-password", async (req, res) => {
    const { email, token, newPassword, newPublicKey, newEncryptedPrivateKey } = req.body;
    
    db.query("SELECT id FROM users WHERE email = ? AND reset_token = ? AND reset_expires > NOW()",
        [email, token], async (err, users) => {
        
        if (err || !users.length) {
            return res.status(403).json({ message: "Invalid or expired token" });
        }

        const userId = users[0].id;
        const passwordHash = await bcrypt.hash(newPassword, 10);

        // Delete all files (zero-knowledge encryption)
        db.query("SELECT stored_name FROM files WHERE user_id = ?", [userId], (err2, files) => {
            if (files && files.length > 0) {
                files.forEach(file => {
                    const filePath = path.join(UPLOAD_DIR, file.stored_name);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                });
            }

            db.query("DELETE FROM files WHERE user_id = ?", [userId]);
        });

        // Update password and keys
        db.query("UPDATE users SET passwordHash = ?, publicKey = ?, encryptedPrivateKey = ?, reset_token = NULL WHERE id = ?",
            [passwordHash, newPublicKey, newEncryptedPrivateKey, userId], (updErr) => {
            
            if (updErr) {
                return res.status(500).json({ message: "Error" });
            }

            res.json({ message: "Password reset successful" });
        });
    });
});

// ==========================================
// 🔧 HEALTH CHECK
// ==========================================

app.get("/api/health", (req, res) => {
    db.query("SELECT 1", (err) => {
        if (err) {
            return res.status(500).json({ 
                status: "error", 
                message: "Database connection failed",
                error: err.message 
            });
        }
        res.json({ 
            status: "ok", 
            database: "connected",
            timestamp: new Date().toISOString()
        });
    });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Health Check: http://localhost:${PORT}/api/health`);
});