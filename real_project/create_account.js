// Ensure cryptography.js is included in your HTML before this script!
// <script src="cryptography.js"></script>
// <script src="createaccount.js"></script>

document.addEventListener("DOMContentLoaded", () => {
    // Select Elements
    const usernameInput = document.querySelector("input[placeholder='Enter your username']");
    const emailInput = document.querySelector("input[placeholder='Enter your email']");
    const passwordInput = document.querySelector("input[placeholder='Enter your password']");
    const confirmInput = document.querySelector("input[placeholder='Confirm your password']");
    const signupBtn = document.querySelector("button");

    signupBtn.addEventListener("click", async (e) => {
        e.preventDefault(); // Stop form from refreshing

        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const confirm = confirmInput.value;

        // 1. Validation
        if (!email || !password || !confirm) return alert("Please fill all fields.");
        if (password !== confirm) return alert("Passwords do not match!");

        // UI Feedback
        const originalText = signupBtn.innerText;
        signupBtn.innerText = "🔐 Generating Keys...";
        signupBtn.disabled = true;

        try {
            // 2. Generate RSA Key Pair (Public & Private)
            const keyPair = await window.crypto.subtle.generateKey(
                { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
                true,
                ["encrypt", "decrypt"]
            );

            // 3. Export Public Key (Safe to share)
            const pubBuffer = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
            const publicKeyString = buffToB64(pubBuffer);

            // 4. Encrypt Private Key (Uses the shared cryptography.js logic)
            // This ensures it saves as "SALT:IV:DATA"
            const encryptedPrivateKeyString = await encryptPrivateKey(keyPair.privateKey, password);

            // 5. Send to Server
            const res = await fetch("http://localhost:5000/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email,
                    password, 
                    publicKey: publicKeyString,
                    encryptedPrivateKey: encryptedPrivateKeyString
                })
            });

            const data = await res.json();
            
            if (res.ok) {
                alert("✅ Account created! Redirecting to login...");
                window.location.href = "login.html";
            } else {
                throw new Error(data.message || "Signup failed");
            }

        } catch (err) {
            console.error(err);
            alert("❌ Error: " + err.message);
            signupBtn.innerText = originalText;
            signupBtn.disabled = false;
        }
    });

    // ==========================================
    // 🔒 PASSWORD STRENGTH METER (Additive — no existing logic changed)
    // ==========================================
    const strengthPassword = document.getElementById("signupPassword");
    const strengthBar = document.getElementById("strengthBar");
    const strengthText = document.getElementById("strengthText");

    if (strengthPassword && strengthBar && strengthText) {
        strengthPassword.addEventListener("input", () => {
            const val = strengthPassword.value;
            let score = 0;

            if (val.length >= 6) score++;   // At least 6 chars
            if (val.length >= 10) score++;  // 10+ chars is better
            if (/[A-Z]/.test(val)) score++; // Has uppercase
            if (/[a-z]/.test(val)) score++; // Has lowercase
            if (/[0-9]/.test(val)) score++; // Has a number
            if (/[^A-Za-z0-9]/.test(val)) score++; // Has special char (!@#$...)

            // Map score to label + color
            const levels = [
                { label: "",             color: "transparent", width: "0%"   },
                { label: "🔴 Very Weak", color: "#ef4444",     width: "15%"  },
                { label: "🟠 Weak",      color: "#f97316",     width: "30%"  },
                { label: "🟡 Fair",      color: "#eab308",     width: "50%"  },
                { label: "🟢 Good",      color: "#22c55e",     width: "70%"  },
                { label: "🟢 Strong",    color: "#16a34a",     width: "85%"  },
                { label: "💪 Very Strong",color: "#15803d",     width: "100%" }
            ];

            const level = levels[score] || levels[6];

            strengthBar.style.width = level.width;
            strengthBar.style.background = level.color;
            strengthText.textContent = val.length > 0 ? level.label : "";
            strengthText.style.color = level.color;
        });
    }
});
