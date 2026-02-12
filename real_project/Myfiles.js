// ==========================================
// MY FILES - CORRECTED DECRYPTION
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
    const email = sessionStorage.getItem("vault_email") || localStorage.getItem("vault_email");
    const privateKeyBase64 = sessionStorage.getItem("vault_privateKey") || localStorage.getItem("vault_privateKey");
    const publicKey = sessionStorage.getItem("vault_publicKey") || localStorage.getItem("vault_publicKey");
    
    const fileTableBody = document.getElementById("fileTableBody");
    const searchInput = document.getElementById("searchInput");
    const logoutBtn = document.getElementById("logoutBtn");

    // Navigation
    const navMyFiles = document.getElementById("navMyFiles");
    const navEncrypt = document.getElementById("navEncrypt");
    const navActivity = document.getElementById("navActivity");
    const navSettings = document.getElementById("navSettings");

    if (navMyFiles) navMyFiles.addEventListener("click", () => window.location.href = "Myfiles.html");
    if (navEncrypt) navEncrypt.addEventListener("click", () => window.location.href = "dashencrypt.html");
    if (navActivity) navActivity.addEventListener("click", () => window.location.href = "activitylog.html");
    if (navSettings) navSettings.addEventListener("click", () => window.location.href = "settings.html");

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            if (confirm("Log out?")) {
                sessionStorage.clear();
                localStorage.clear();
                window.location.href = "login.html";
            }
        });
    }

    if (!email) {
        window.location.href = "login.html";
        return;
    }
    
    if (!privateKeyBase64) {
        alert("Session expired. Please login again.");
        window.location.href = "login.html";
        return;
    }

    // ==========================================
    // HELPER FUNCTIONS
    // ==========================================

    function base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    async function importPrivateKey(base64Key) {
        const keyBuffer = base64ToArrayBuffer(base64Key);
        return await crypto.subtle.importKey(
            "pkcs8",
            keyBuffer,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["decrypt"]
        );
    }

    async function decryptAESKey(encryptedAESKeyBase64, privateKey) {
        
        const encryptedBuffer = base64ToArrayBuffer(encryptedAESKeyBase64);
        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            privateKey,
            encryptedBuffer
        );
        
        return await crypto.subtle.importKey(
            "raw",
            decryptedBuffer,
            { name: "AES-GCM", length: 256 },
            true,
            ["decrypt"]
        );
    }

    async function decryptFileStream(encryptedArrayBuffer, aesKey) {
    const data = new Uint8Array(encryptedArrayBuffer);
    const decryptedChunks = [];
    let offset = 0;

    while (offset < data.length) {
        const iv = data.slice(offset, offset + 12);
        offset += 12;

        const chunkLength = new DataView(data.buffer, offset, 4).getUint32(0);
        offset += 4;

        const encryptedChunk = data.slice(offset, offset + chunkLength);
        offset += chunkLength;

        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv, tagLength: 128 },
            aesKey,
            encryptedChunk
        );

        decryptedChunks.push(new Uint8Array(decrypted));
    }

    const total = decryptedChunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);

    let pos = 0;
    for (const c of decryptedChunks) {
        result.set(c, pos);
        pos += c.length;
    }

    return result.buffer;
}


    function formatFileSize(bytes) {
        if (!bytes) return "0 B";
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    }

    function getFileIcon(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        const iconMap = {
            'pdf': 'fa-solid fa-file-pdf',
            'doc': 'fa-solid fa-file-word',
            'docx': 'fa-solid fa-file-word',
            'jpg': 'fa-solid fa-file-image',
            'jpeg': 'fa-solid fa-file-image',
            'png': 'fa-solid fa-file-image',
            'gif': 'fa-solid fa-file-image',
            'mp4': 'fa-solid fa-file-video',
            'mkv': 'fa-solid fa-file-video',
            'avi': 'fa-solid fa-file-video',
            'mp3': 'fa-solid fa-file-audio',
            'txt': 'fa-solid fa-file-lines'
        };
        return iconMap[ext] || 'fa-solid fa-file';
    }

    function escapeFileName(fileName) {
        return fileName.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    function showLoadingModal(message) {
        const modal = document.createElement('div');
        modal.id = 'loadingModal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.9); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
            flex-direction: column;
        `;
        modal.innerHTML = `
            <div class="spinner" style="
                border: 4px solid rgba(255,255,255,0.3);
                border-top: 4px solid white;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: spin 1s linear infinite;
            "></div>
            <p id="loadingMessage" style="color: white; margin-top: 20px; font-size: 18px;">${message}</p>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    function updateLoadingMessage(message) {
        const msgEl = document.getElementById('loadingMessage');
        if (msgEl) msgEl.textContent = message;
    }

    function removeLoadingModal() {
        const modal = document.getElementById('loadingModal');
        if (modal) modal.remove();
    }

    function openFilePreviewModal(fileName, blobUrl, ext) {
        const modal = document.createElement('div');
        modal.id = 'filePreviewModal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.95); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
            flex-direction: column; padding: 20px;
        `;

        let content = '';
        
        if (['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(ext)) {
            content = `
                <video controls autoplay style="width: 90%; max-width: 1200px; max-height: 75vh; background: black; border-radius: 10px;">
                    <source src="${blobUrl}" type="video/${ext === 'mkv' ? 'x-matroska' : 'mp4'}">
                    Your browser does not support video playback.
                </video>
            `;
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            content = `<img src="${blobUrl}" style="max-width: 90%; max-height: 75vh; object-fit: contain; border-radius: 10px;">`;
        } else if (ext === 'pdf') {
            content = `<iframe src="${blobUrl}" style="width: 90%; max-width: 1200px; height: 80vh; border: none; background: white; border-radius: 10px;"></iframe>`;
        } else if (ext === 'txt') {
            content = `<iframe src="${blobUrl}" style="width: 90%; max-width: 800px; height: 80vh; border: none; background: white; padding: 20px; border-radius: 10px;"></iframe>`;
        } else if (['mp3', 'wav', 'ogg'].includes(ext)) {
            content = `
                <div style="background: white; padding: 40px; border-radius: 15px; text-align: center;">
                    <h2 style="margin-bottom: 20px; color: #333;">🎵 ${fileName}</h2>
                    <audio controls autoplay style="width: 100%; max-width: 500px;">
                        <source src="${blobUrl}" type="audio/${ext === 'mp3' ? 'mpeg' : ext}">
                    </audio>
                </div>
            `;
        } else {
            content = `
                <div style="background: white; padding: 40px; border-radius: 15px; text-align: center;">
                    <h2 style="margin-bottom: 20px; color: #333;">📄 ${fileName}</h2>
                    <p style="color: #666;">Preview not available for this file type.</p>
                </div>
            `;
        }

        modal.innerHTML = `
            <div style="margin-bottom: 15px; color: white; font-size: 18px; font-weight: bold;">
                ${fileName}
            </div>
            ${content}
            <div style="margin-top: 20px;">
                <button onclick="closeFilePreview()" style="
                    padding: 12px 30px; background: #dc2626; color: white;
                    border: none; border-radius: 8px; cursor: pointer;
                    font-size: 16px; font-weight: bold;">
                    ✕ Close
                </button>
            </div>
        `;

        document.body.appendChild(modal);

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeFilePreview();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    function closeFilePreview() {
        const modal = document.getElementById('filePreviewModal');
        if (modal) modal.remove();
    }

    window.closeFilePreview = closeFilePreview;

    // ==========================================
    // FILE OPERATIONS
    // ==========================================

    async function loadFiles() {
        try {
            const res = await fetch(`http://localhost:5000/api/files/${email}`);
            const files = await res.json();

            fileTableBody.innerHTML = "";

            if (!files || files.length === 0) {
                fileTableBody.innerHTML = `
                    <tr>
                        <td colspan="4" style="text-align: center; padding: 40px; color: #999;">
                            <i class="fa-solid fa-inbox" style="font-size: 50px;"></i>
                            <p style="font-size: 18px;">No files uploaded yet</p>
                        </td>
                    </tr>
                `;
                return;
            }

            files.forEach(file => {
                fileTableBody.innerHTML += createFileRow(file);
            });

        } catch (err) {
            console.error("Error loading files:", err);
            fileTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red;">Error loading files</td></tr>`;
        }
    }

    function createFileRow(file) {
        const fileName = file.fileName;
        const fileSize = formatFileSize(file.fileSize);
        const encryptedOn = new Date(file.encryptedOn).toLocaleDateString();
        const fileIcon = getFileIcon(fileName);

        return `
            <tr>
                <td>
                    <i class="${fileIcon}" style="margin-right: 10px; color: #6366f1;"></i>
                    <strong>${fileName}</strong>
                </td>
                <td>${fileSize}</td>
                <td>${encryptedOn}</td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="requestViewAccess('${escapeFileName(fileName)}')" 
                                style="padding: 8px 15px; background: #22c55e; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">
                            <i class="fa-solid fa-eye"></i> View
                        </button>
                        <button onclick="requestDownloadAccess('${escapeFileName(fileName)}')" 
                                style="padding: 8px 15px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">
                            <i class="fa-solid fa-download"></i> Download
                        </button>
                        <button onclick="requestDeleteAccess('${escapeFileName(fileName)}')" 
                                style="padding: 8px 15px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">
                            <i class="fa-solid fa-trash"></i> Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    // VIEW FILE
    window.requestViewAccess = async function(fileName) {
        try {
            const res = await fetch("http://localhost:5000/api/file/request-access", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, fileName })
            });

            if (res.ok) {
                alert("📧 OTP sent to your email!");
                const otp = prompt("Enter the 6-digit OTP to VIEW this file:");
                
                if (otp && otp.trim()) {
                    await viewFileWithOTP(fileName, otp.trim());
                }
            } else {
                alert("❌ Failed to send OTP");
            }
        } catch (err) {
            console.error(err);
            alert("❌ Error: " + err.message);
        }
    };

    async function viewFileWithOTP(fileName, otp) {
    const loadingModal = showLoadingModal("Retrieving encrypted file...");

    try {
        updateLoadingMessage("Downloading...");

        // 1️⃣ Fetch encrypted stream
        const streamRes = await fetch("http://localhost:5000/api/file/get-encrypted-stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, fileName, otp })
        });

        if (!streamRes.ok) {
            removeLoadingModal();
            const error = await streamRes.json();
            throw new Error(error.message || "Failed to fetch file");
        }

        // 2️⃣ Get encrypted AES key from exposed header
        const encryptedAESKey = streamRes.headers.get("X-Encrypted-AES-Key");

        if (!encryptedAESKey || encryptedAESKey.length < 300) {
            throw new Error("Corrupted AES key received");
        }

        // 3️⃣ Read encrypted file bytes
        const encryptedArrayBuffer = await streamRes.arrayBuffer();

        // 4️⃣ Import private key
        updateLoadingMessage("Decrypting keys...");
        const privateKey = await importPrivateKey(privateKeyBase64);

        // 5️⃣ Decrypt AES key
        const aesKey = await decryptAESKey(encryptedAESKey, privateKey);

        // 6️⃣ Decrypt file data
        updateLoadingMessage("Decrypting file...");
        const decryptedBuffer = await decryptFileStream(encryptedArrayBuffer, aesKey);

        removeLoadingModal();

        // 7️⃣ Determine correct MIME type
        const ext = fileName.split(".").pop().toLowerCase();
        let mimeType = "application/octet-stream";

        if (ext === "pdf") mimeType = "application/pdf";
        else if (["jpg", "jpeg"].includes(ext)) mimeType = "image/jpeg";
        else if (ext === "png") mimeType = "image/png";
        else if (ext === "gif") mimeType = "image/gif";
        else if (ext === "txt") mimeType = "text/plain";
        else if (ext === "mp4") mimeType = "video/mp4";
        else if (ext === "mp3") mimeType = "audio/mpeg";

        // 8️⃣ Create blob ONLY from decrypted data
        const blob = new Blob([decryptedBuffer], { type: mimeType });
        const url = URL.createObjectURL(blob);

        // 9️⃣ Open preview
        openFilePreviewModal(fileName, url, ext);

    } catch (err) {
        removeLoadingModal();
        console.error("View error:", err);
        alert("❌ Decryption failed: " + err.message);
    }
}



    // DOWNLOAD FILE
    window.requestDownloadAccess = async function(fileName) {
        try {
            const res = await fetch("http://localhost:5000/api/file/request-access", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, fileName })
            });

            if (res.ok) {
                alert("📧 OTP sent to your email!");
                const otp = prompt("Enter the 6-digit OTP to DOWNLOAD this file:");
                
                if (otp && otp.trim()) {
                    await downloadFileWithOTP(fileName, otp.trim());
                }
            } else {
                alert("❌ Failed to send OTP");
            }
        } catch (err) {
            console.error(err);
            alert("❌ Error: " + err.message);
        }
    };

  async function downloadFileWithOTP(fileName, otp) {
    const loadingModal = showLoadingModal("Preparing download...");

    try {
        // ✅ FETCH ENCRYPTED FILE
        const streamRes = await fetch("http://localhost:5000/api/file/get-encrypted-stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, fileName, otp })
        });

        if (!streamRes.ok) {
            removeLoadingModal();
            const err = await streamRes.json();
            throw new Error(err.message || "Download failed");
        }

        // ✅ READ AES KEY FROM HEADER
        const encryptedAESKey = streamRes.headers.get("X-Encrypted-AES-Key");

        if (!encryptedAESKey || encryptedAESKey.length < 300) {
            throw new Error("Corrupted AES key received");
        }

        // ✅ READ FILE DATA
        const encryptedArrayBuffer = await streamRes.arrayBuffer();

        // ✅ DECRYPT
        const privateKey = await importPrivateKey(privateKeyBase64);
        const aesKey = await decryptAESKey(encryptedAESKey, privateKey);
        const decryptedBuffer = await decryptFileStream(encryptedArrayBuffer, aesKey);

        removeLoadingModal();

        // ✅ DOWNLOAD
        const blob = new Blob([decryptedBuffer]);
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);

        alert("✅ File downloaded successfully!");

    } catch (err) {
        removeLoadingModal();
        console.error("Download error:", err);
        alert("❌ Download failed: " + err.message);
    }
}


    // DELETE FILE
    window.requestDeleteAccess = async function(fileName) {
        if (!confirm(`⚠️ Delete "${fileName}"? This cannot be undone!`)) return;

        try {
            const res = await fetch("http://localhost:5000/api/file/request-access", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, fileName })
            });

            if (res.ok) {
                alert("📧 OTP sent to your email!");
                const otp = prompt("Enter the 6-digit OTP to DELETE this file:");
                
                if (otp && otp.trim()) {
                    await deleteFileWithOTP(fileName, otp.trim());
                }
            } else {
                alert("❌ Failed to send OTP");
            }
        } catch (err) {
            console.error(err);
            alert("❌ Error: " + err.message);
        }
    };

    async function deleteFileWithOTP(fileName, otp) {
        try {
            const verifyRes = await fetch("http://localhost:5000/api/file/verify-access", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, fileName, otp })
            });

            if (verifyRes.ok) {
                const deleteRes = await fetch("http://localhost:5000/api/deleteFile", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, fileName })
                });

                if (deleteRes.ok) {
                    alert("✅ File deleted!");
                    loadFiles();
                } else {
                    alert("❌ Delete failed");
                }
            } else {
                alert("❌ Invalid OTP");
            }
        } catch (err) {
            console.error(err);
            alert("❌ Error: " + err.message);
        }
    }

    // Search
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const rows = fileTableBody.getElementsByTagName("tr");

            Array.from(rows).forEach(row => {
                const fileName = row.cells[0]?.textContent.toLowerCase() || "";
                row.style.display = fileName.includes(searchTerm) ? "" : "none";
            });
        });
    }

    // Real-time updates
    if (typeof io !== 'undefined') {
        try {
            const socket = io("http://localhost:5000");
            socket.on("fileUploaded", () => loadFiles());
            socket.on("fileDeleted", () => loadFiles());
        } catch (e) {
            console.log("Socket.io not available");
        }
    }

    loadFiles();
});