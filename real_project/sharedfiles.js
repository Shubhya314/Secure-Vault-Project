document.addEventListener("DOMContentLoaded", () => {
  if (!checkAuth()) return;
  setupNavigation();

  const email = getEmail();
  const privateKeyBase64 = sessionStorage.getItem("vault_privateKey") || localStorage.getItem("vault_privateKey");
  const tableBody = document.getElementById("sharedTableBody");
  const searchInput = document.getElementById("searchInput");

  function openFilePreviewModal(fileName, blobUrl, ext) {
    const modal = document.createElement('div');
    modal.id = 'sharedFilePreviewModal';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.95); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      flex-direction: column; padding: 20px;`;

    let content = '';
    if (['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(ext)) {
      content = `<video controls autoplay style="width: 90%; max-width: 1200px; max-height: 75vh; background: black; border-radius: 10px;"><source src="${blobUrl}" type="video/${ext === 'mkv' ? 'x-matroska' : 'mp4'}"></video>`;
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      content = `<img src="${blobUrl}" style="max-width: 90%; max-height: 75vh; object-fit: contain; border-radius: 10px;">`;
    } else if (ext === 'pdf' || ext === 'txt') {
      content = `<iframe src="${blobUrl}" style="width: 90%; max-width: 1200px; height: 80vh; border: none; background: white; border-radius: 10px;"></iframe>`;
    } else if (['mp3', 'wav', 'ogg'].includes(ext)) {
      content = `<div style="background: white; padding: 40px; border-radius: 15px; text-align: center;"><h2 style="margin-bottom: 20px; color: #333;">🎵 ${fileName}</h2><audio controls autoplay style="width: 100%; max-width: 500px;"><source src="${blobUrl}" type="audio/${ext === 'mp3' ? 'mpeg' : ext}"></audio></div>`;
    } else {
      content = `<div style="background: white; padding: 40px; border-radius: 15px; text-align: center;"><h2 style="margin-bottom: 20px; color: #333;">📄 ${fileName}</h2><p style="color: #666;">Preview not available for this file type.</p></div>`;
    }

    modal.innerHTML = `<div style="margin-bottom: 15px; color: white; font-size: 18px; font-weight: bold;">${fileName}</div>${content}<div style="margin-top: 20px;"><button id="closeSharedPreviewBtn" style="padding: 12px 30px; background: #dc2626; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold;">✕ Close</button></div>`;
    document.body.appendChild(modal);

    document.getElementById("closeSharedPreviewBtn").addEventListener("click", () => modal.remove());
  }

  function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes.buffer;
  }

  async function importPrivateKey(base64Key) {
    return crypto.subtle.importKey("pkcs8", base64ToArrayBuffer(base64Key), { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]);
  }

  async function decryptAESKey(encryptedAESKeyBase64, privateKey) {
    const decryptedBuffer = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, base64ToArrayBuffer(encryptedAESKeyBase64));
    return crypto.subtle.importKey("raw", decryptedBuffer, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }

  async function decryptFileStream(encryptedArrayBuffer, aesKey) {
    const data = new Uint8Array(encryptedArrayBuffer);
    const decryptedChunks = [];
    let offset = 0;
    while (offset < data.length) {
      const iv = data.slice(offset, offset + 12); offset += 12;
      const chunkLength = new DataView(data.buffer, offset, 4).getUint32(0); offset += 4;
      const encryptedChunk = data.slice(offset, offset + chunkLength); offset += chunkLength;
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, aesKey, encryptedChunk);
      decryptedChunks.push(new Uint8Array(decrypted));
    }
    const total = decryptedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(total);
    let pos = 0;
    for (const chunk of decryptedChunks) { result.set(chunk, pos); pos += chunk.length; }
    return result.buffer;
  }

  function formatFileSize(bytes) {
    if (!bytes) return "0 B";
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
  }

  async function loadSharedFiles() {
    const res = await authFetch(`http://localhost:5000/api/shares/received/${encodeURIComponent(email)}`);
    if (!res || !res.ok) {
      tableBody.innerHTML = `<tr><td colspan="5" style="color:red">Failed to load shared files</td></tr>`;
      hidePageLoader();
      return;
    }
    const files = await res.json();
    if (!files.length) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#999">No shared files yet</td></tr>`;
      hidePageLoader();
      return;
    }
    const formatExpiry = (expiresAt) => {
      if (!expiresAt) return "No expiry";
      const d = new Date(expiresAt);
      if (isNaN(d.getTime())) return "Unknown";
      return d.toLocaleString();
    };

    tableBody.innerHTML = files.map(file => `
      <tr>
        <td><strong>${file.fileName}</strong></td>
        <td>${formatFileSize(file.fileSize)}</td>
        <td>${file.sharedBy}</td>
        <td>${formatExpiry(file.expiresAt)}</td>
        <td><button onclick="viewSharedFile('${file.fileName.replace(/'/g, "\\'")}')" style="padding:8px 15px;background:#22c55e;color:#fff;border:none;border-radius:6px;cursor:pointer;"><i class="fa-solid fa-eye"></i> View Only</button></td>
      </tr>`).join("");
    hidePageLoader();
  }

  window.viewSharedFile = async function(fileName) {
    try {
      const reqOtp = await authFetch("http://localhost:5000/api/file/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fileName })
      });
      if (!reqOtp || !reqOtp.ok) throw new Error("Failed to send OTP");
      const otp = prompt("Enter OTP sent to your email to view shared file:");
      if (!otp) return;

      const streamRes = await authFetch("http://localhost:5000/api/shared/get-encrypted-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fileName, otp: otp.trim() })
      });
      if (!streamRes || !streamRes.ok) throw new Error("Failed to fetch shared file stream");

      const encryptedAESKey = streamRes.headers.get("X-Encrypted-AES-Key");
      const encryptedBuffer = await streamRes.arrayBuffer();
      const privateKey = await importPrivateKey(privateKeyBase64);
      const aesKey = await decryptAESKey(encryptedAESKey, privateKey);
      const decryptedBuffer = await decryptFileStream(encryptedBuffer, aesKey);

      const ext = fileName.split(".").pop().toLowerCase();
      let mimeType = "application/octet-stream";
      if (ext === "pdf") mimeType = "application/pdf";
      else if (["jpg", "jpeg"].includes(ext)) mimeType = "image/jpeg";
      else if (ext === "png") mimeType = "image/png";
      else if (ext === "gif") mimeType = "image/gif";
      else if (ext === "txt") mimeType = "text/plain";
      else if (ext === "mp4") mimeType = "video/mp4";
      else if (ext === "mp3") mimeType = "audio/mpeg";

      const blob = new Blob([decryptedBuffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      openFilePreviewModal(fileName, url, ext);
    } catch (err) {
      console.error(err);
      alert("❌ " + err.message);
    }
  };

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase();
      Array.from(tableBody.querySelectorAll("tr")).forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none";
      });
    });
  }

  loadSharedFiles();
});
