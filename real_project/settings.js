document.addEventListener("DOMContentLoaded", async () => {
    // ✅ Auth check + Navigation (from auth.js)
    if (!checkAuth()) return;
    setupNavigation();

    const mfaBtn = document.getElementById("mfaToggleBtn");
    const email = getEmail();

    // Fetch initial status to set button color
    const statusRes = await authFetch(`http://localhost:5000/api/mfa/status/${email}`);
    if (!statusRes) return;
    const statusData = await statusRes.json();
    let isEnabled = statusData.mfaEnabled;

    const updateUI = (state) => {
        mfaBtn.textContent = state ? "Disable Email MFA" : "Enable Email MFA";
        mfaBtn.style.background = state ? "red" : "green";
    };
    updateUI(isEnabled);

    // ✅ Hide loader after settings loaded
    hidePageLoader();

    mfaBtn.addEventListener("click", async () => {
        try {
            const res = await authFetch("http://localhost:5000/api/mfa/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email, enabled: !isEnabled })
            });

            if (res && res.ok) {
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
