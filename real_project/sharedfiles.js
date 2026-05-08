document.addEventListener("DOMContentLoaded", () => {
  if (!checkAuth()) return;
  setupNavigation();

  const email = getEmail();
  const privateKeyBase64 = sessionStorage.getItem("vault_privateKey") || localStorage.getItem("vault_privateKey");
  const tableBody = document.getElementById("sharedTableBody");
  const searchInput = document.getElementById("searchInput");

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
      tableBody.innerHTML = `<tr><td colspan="4" style="color:red">Failed to load shared files</td></tr>`;
      hidePageLoader();
      return;
    }
    const files = await res.json();
    if (!files.length) {
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#999">No shared files yet</td></tr>`;
      hidePageLoader();
      return;
    }
    tableBody.innerHTML = files.map(file => `
      <tr>
        <td><strong>${file.fileName}</strong></td>
        <td>${formatFileSize(file.fileSize)}</td>
        <td>${file.sharedBy}</td>
        <td><button onclick="downloadSharedFile('${file.fileName.replace(/'/g, "\\'")}')" style="padding:8px 15px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;"><i class="fa-solid fa-download"></i> Download</button></td>
      </tr>`).join("");
    hidePageLoader();
  }

  window.downloadSharedFile = async function(fileName) {
    try {
      const reqOtp = await authFetch("http://localhost:5000/api/file/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fileName })
      });
      if (!reqOtp || !reqOtp.ok) throw new Error("Failed to send OTP");
      const otp = prompt("Enter OTP sent to your email to download shared file:");
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

      const blob = new Blob([decryptedBuffer]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert("✅ Shared file downloaded successfully!");
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
