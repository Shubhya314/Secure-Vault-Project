// ==========================================
// 🔐 CORE CRYPTOGRAPHY (The "Brain")
// ==========================================

// 1. Generate a Random Salt (Adds randomness to passwords)
function generateSalt() {
    return window.crypto.getRandomValues(new Uint8Array(16));
}

// 2. Generate a Random IV (Initialization Vector for AES)
function generateIV() {
    return window.crypto.getRandomValues(new Uint8Array(12));
}

// 3. Convert Data Helpers
function buffToB64(buff) {
    return btoa(String.fromCharCode(...new Uint8Array(buff)));
}
function b64ToBuff(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// 4. Derive Key from Password (PBKDF2)
// This turns a simple password like "password123" into a strong encryption key
async function deriveKeyFromPassword(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

// 5. Encrypt the Private Key (So we can store it safely in DB)
// Returns: "SALT:IV:CIPHERTEXT"
async function encryptPrivateKey(privateKey, password) {
    // Export Key to raw bytes
    const keyData = await window.crypto.subtle.exportKey("pkcs8", privateKey);
    
    // Generate Security Params
    const salt = generateSalt();
    const iv = generateIV();
    
    // Lock it with Password
    const derivedKey = await deriveKeyFromPassword(password, salt);
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv }, derivedKey, keyData
    );

    // Pack it all into one string
    return `${buffToB64(salt)}:${buffToB64(iv)}:${buffToB64(encryptedBuffer)}`;
}

// 6. Decrypt the Private Key (Login)
async function decryptPrivateKey(packedString, password) {
    try {
        const parts = packedString.split(":");
        if (parts.length !== 3) throw new Error("Missing salt/iv");

        const salt = b64ToBuff(parts[0]);
        const iv = b64ToBuff(parts[1]);
        const ciphertext = b64ToBuff(parts[2]);

        const derivedKey = await deriveKeyFromPassword(password, salt);
        
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv }, derivedKey, ciphertext
        );

        return window.crypto.subtle.importKey(
            "pkcs8", decryptedBuffer, 
            { name: "RSA-OAEP", hash: "SHA-256" }, 
            true, ["decrypt"]
        );
    } catch (e) {
        throw new Error("Wrong Password or Corrupted Data");
    }
}