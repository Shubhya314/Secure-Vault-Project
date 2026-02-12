// Ensure cryptography.js is included in your HTML before this script!
// <script src="cryptography.js"></script>
// <script src="login.js"></script>

document.addEventListener("DOMContentLoaded", () => {
    const emailEl = document.getElementById("email");
    const passwordEl = document.getElementById("password");
    const loginBtn = document.getElementById("loginBtn");
    const rememberMeEl = document.getElementById("rememberMe"); 

    // Helper: Toggle Password Visibility
    const toggleIcon = document.getElementById("togglePassword");
    if (toggleIcon) {
        toggleIcon.addEventListener("click", () => {
            const isPassword = passwordEl.type === "password";
            passwordEl.type = isPassword ? "text" : "password";
            toggleIcon.classList.toggle("fa-eye-slash");
            toggleIcon.classList.toggle("fa-eye");
        });
    }

    // MAIN LOGIN LOGIC
    if (loginBtn) {
        loginBtn.addEventListener("click", async (e) => {
            e.preventDefault(); // Stop form reload

            const email = emailEl.value.trim();
            const password = passwordEl.value;

            if (!email || !password) return alert("Please enter credentials.");

            loginBtn.innerText = "🔄 Checking...";
            loginBtn.disabled = true;

            try {
                // STEP 1: Check Password with Server
                const res = await fetch("http://localhost:5000/api/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password })
                });

                const data = await res.json();
                
                if (!res.ok) throw new Error(data.message || "Login failed");

                // STEP 2: Handle MFA (Email Code)
                if (data.mfaRequired) {
                    const token = prompt(`📧 SECURITY CHECK\n\nWe sent a code to ${email}.\n\nEnter the 6-digit code here:`);
                    
                    if (!token) {
                        loginBtn.innerText = "Login";
                        loginBtn.disabled = false;
                        return; // User cancelled
                    }

                    // Verify Code
                    const mfaRes = await fetch("http://localhost:5000/api/login/verify-mfa", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email, token })
                    });

                    const mfaData = await mfaRes.json();
                    if (!mfaRes.ok) throw new Error(mfaData.message || "Invalid Code");

                    // Merge MFA data (keys) into main data object
                    Object.assign(data, mfaData);
                }

                // STEP 3: Decrypt Private Key
                // Uses the function from cryptography.js
                loginBtn.innerText = "🔓 Decrypting...";
                
                // IMPORTANT: We use the helper from cryptography.js now!
                // It returns a CryptoKey object, but we need to store it as Base64 for session.
                // So we decrypt it, then export it back to Base64 to save in storage.
                
                // 1. Decrypt (Unlocks the key using password)
                const privateKeyObject = await decryptPrivateKey(data.encryptedPrivateKey, password);
                
                // 2. Export (Converts key to string for storage)
                const privateKeyBuffer = await window.crypto.subtle.exportKey("pkcs8", privateKeyObject);
                const privateKeyString = buffToB64(privateKeyBuffer);

                // STEP 4: Save & Redirect
                const storage = rememberMeEl && rememberMeEl.checked ? localStorage : sessionStorage;
                
                storage.setItem("vault_email", email);
                storage.setItem("vault_publicKey", data.publicKey);
                storage.setItem("vault_privateKey", privateKeyString); // Save decrypted key for use in dashboard
                
                // Save encrypted version too (useful for other features)
                storage.setItem("vault_encrypted_privateKey", data.encryptedPrivateKey); 

                alert("✅ Login Successful!");
                window.location.href = "dashboard.html";

            } catch (err) {
                console.error(err);
                alert("❌ Login Error: " + err.message);
                loginBtn.innerText = "Login";
                loginBtn.disabled = false;
            }
        });
    }
});