// ================== Utility Conversions (KEPT SAME) ==================
function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

// ================== RSA Public Key Import (KEPT SAME) ==================
async function importPublicKey(base64Key) {
    const keyBuffer = base64ToArrayBuffer(base64Key);
    return await crypto.subtle.importKey(
        "spki",
        keyBuffer,
        { name: "RSA-OAEP", hash: "SHA-256" },
        true,
        ["encrypt"]
    );
}

// ================== MAIN UI LOGIC ==================
document.addEventListener("DOMContentLoaded", () => {
    const encryptBtn = document.getElementById("encryptBtn");
    const textInput = document.getElementById("encryptText");
    const fileInput = document.getElementById("encryptFile");
    const status = document.getElementById("encryptStatus");
    const dropZone = document.getElementById("dropZone");
    const fileNameDisplay = document.getElementById("fileNameDisplay");

    // ✅ 1. GLOBAL FIX: Prevent browser from opening files in new tab
    window.addEventListener("dragover", (e) => e.preventDefault(), false);
    window.addEventListener("drop", (e) => e.preventDefault(), false);

    // ✅ 2. Drag & Drop Zone Logic (KEPT SAME)
    if (dropZone) {
        dropZone.addEventListener("click", () => fileInput.click());

        fileInput.addEventListener("change", () => {
            if (fileInput.files.length > 0) showFileName(fileInput.files[0].name);
        });

        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add("dragover");
        });

        dropZone.addEventListener("dragleave", (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove("dragover");
        });

        dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove("dragover");

            const droppedFiles = e.dataTransfer.files;
            if (droppedFiles.length > 0) {
                fileInput.files = droppedFiles;
                showFileName(droppedFiles[0].name);
            }
        });
    }

    function showFileName(name) {
        if(fileNameDisplay) {
            fileNameDisplay.innerHTML = `<i class="fa-solid fa-file"></i> ${name}`;
            fileNameDisplay.style.color = "green";
        }
    }

    // ✅ 3. ENCRYPT & UPLOAD LOGIC (UPDATED FOR LARGE FILES)
    if (encryptBtn) {
        encryptBtn.addEventListener("click", async () => {
            const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB Chunk Size

            try {
                // UI Reset
                status.style.color = "blue";
                status.textContent = "Initializing encryption...";
                
                // Get Input
                const text = textInput.value.trim();
                let file = fileInput.files[0];

                if (!text && !file) {
                    alert("Please enter text or choose a file.");
                    status.textContent = "";
                    return;
                }

                // If text is entered, convert it to a file object so we can use the same logic
                if (!file && text) {
                    file = new Blob([text], { type: 'text/plain' });
                    file.name = "text_data.txt";
                }

                // Check Session
                const email = sessionStorage.getItem("vault_email");
                
                if (!email ) {
                    alert("Session expired. Please login again.");
                    window.location.href = "login.html";
                    return;
                }

                // ===============================================
                // STEP A: PREPARE KEYS
                // ===============================================
                status.textContent = "🔐 Generating Keys...";
                
                // 1. Generate AES Key (One key for the whole file)
                const aesKey = await crypto.subtle.generateKey(
                    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
                );

                // 2. Encrypt AES Key with User's RSA Public Key
                
                const keyRes = await fetch(`http://localhost:5000/api/user/publickey/${email}`);
if (!keyRes.ok) throw new Error("Failed to fetch public key");

const { publicKey } = await keyRes.json();

// Import RSA Public Key
const rsaKey = await importPublicKey(publicKey);

// 2. Encrypt AES Key with User's RSA Public Key
const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);

const encryptedAESKeyBuffer = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaKey,
    rawAesKey
);

const encryptedAESKey = arrayBufferToBase64(encryptedAESKeyBuffer);

                // ===============================================
                // STEP B: INITIALIZE UPLOAD ON SERVER
                // ===============================================
                status.textContent = "📡 Connecting to Server...";
                
                const initRes = await fetch("http://localhost:5000/api/upload/init", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ fileName: file.name })
                });

                if (!initRes.ok) throw new Error("Failed to connect to server");
                const { serverFileName } = await initRes.json();

                // ===============================================
                // STEP C: CHUNK LOOP (THE "SLICING")
                // ===============================================
                const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                let uploadedChunks = 0;

                for (let i = 0; i < totalChunks; i++) {
                    const start = i * CHUNK_SIZE;
                    const end = Math.min(start + CHUNK_SIZE, file.size);
                    const chunkBlob = file.slice(start, end); // ✂️ Slice the file
                    const chunkBuffer = await chunkBlob.arrayBuffer();

                    // 1. Generate Unique IV for this chunk
                    const iv = crypto.getRandomValues(new Uint8Array(12));

                    // 2. Encrypt the Chunk
                    const encryptedChunk = await crypto.subtle.encrypt(
                        { name: "AES-GCM", iv: iv }, aesKey, chunkBuffer
                    );

                    // 3. Combine IV + Encrypted Data
                    // [IV (12 bytes)] + [Encrypted Data]
                    // 3. Combine IV + LENGTH + Encrypted Data
// [IV (12 bytes)] + [Length (4 bytes)] + [Encrypted Data]
const lengthBuffer = new Uint8Array(4);
new DataView(lengthBuffer.buffer).setUint32(0, encryptedChunk.byteLength);

const packet = new Uint8Array(12 + 4 + encryptedChunk.byteLength);
packet.set(iv, 0);                  // IV
packet.set(lengthBuffer, 12);       // Length
packet.set(new Uint8Array(encryptedChunk), 16); // Ciphertext + Auth Tag

                    // 4. Upload Chunk
                    const uploadRes = await fetch("http://localhost:5000/api/upload/chunk", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            serverFileName: serverFileName,
                            chunkData: arrayBufferToBase64(packet.buffer)
                        })
                    });

                    if (!uploadRes.ok) throw new Error(`Chunk ${i+1} upload failed`);

                    // 5. Update UI
                    uploadedChunks++;
                    const percent = Math.round((uploadedChunks / totalChunks) * 100);
                    status.innerHTML = `🚀 Uploading: <b>${percent}%</b>`;
                }

                // ===============================================
                // STEP D: FINALIZE
                // ===============================================
                status.textContent = "💾 Saving...";
                
                const finalRes = await fetch("http://localhost:5000/api/upload/finalize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: email,
                        fileName: file.name,
                        serverFileName: serverFileName,
                        fileSize: file.size,
                        encryptedAESKey: encryptedAESKey,
                        totalChunks: totalChunks
                    })
                });

                if (!finalRes.ok) throw new Error("Failed to finalize upload");

                // Success!
                status.style.color = "green";
                status.innerHTML = `✅ <b>${file.name}</b> Encrypted & Saved!`;
                alert("Upload Complete!");

                // Clear Inputs
                textInput.value = "";
                fileInput.value = "";
                if (fileNameDisplay) fileNameDisplay.textContent = "";

            } catch (err) {
                console.error(err);
                status.style.color = "red";
                status.textContent = "Error: " + err.message;
            }
        });
    }

    // Back Button Logic (KEPT SAME)
    const backBtn = document.getElementById("backToDashboard");
    if (backBtn) {
        backBtn.addEventListener("click", () => window.location.href = "dashboard.html");
    }
});