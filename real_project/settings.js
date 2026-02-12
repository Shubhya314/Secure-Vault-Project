document.addEventListener("DOMContentLoaded", async () => {
    const mfaBtn = document.getElementById("mfaToggleBtn"); // Ensure this ID matches your HTML
    const email = sessionStorage.getItem("vault_email");

    // Fetch initial status to set button color
    const statusRes = await fetch(`http://localhost:5000/api/mfa/status/${email}`);
    const statusData = await statusRes.json();
    let isEnabled = statusData.mfaEnabled;

    const updateUI = (state) => {
        mfaBtn.textContent = state ? "Disable Email MFA" : "Enable Email MFA";
        mfaBtn.style.background = state ? "red" : "green";
    };
    updateUI(isEnabled);

    mfaBtn.addEventListener("click", async () => {
        try {
            const res = await fetch("http://localhost:5000/api/mfa/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email, enabled: !isEnabled })
            });

            if (res.ok) {
                isEnabled = !isEnabled;
                updateUI(isEnabled);
                alert(`MFA ${isEnabled ? 'Enabled' : 'Disabled'}!`);
            } else {
                alert("Failed to update MFA settings.");
            }
        } catch (err) {
            alert("Server Error connection failed.");
        }
    });
});

