// ==========================================
// 🔐 AUTH.JS — Shared Authentication Helper
// ==========================================
// Include this file on EVERY protected page (dashboard, myfiles, encrypt, etc.)
// It handles: JWT token management, auth checks, and loading overlay.

// ==========================================
// 1. TOKEN HELPERS
// ==========================================




// Get the user's email from storage
function getEmail() {
    return sessionStorage.getItem("vault_email") || localStorage.getItem("vault_email");
}

// ==========================================
// 2. AUTH FETCH — Replaces normal fetch()
// ==========================================
// This is just fetch() but it automatically adds your JWT token
// to every request. If the server says "not authorized", it
// redirects you to the login page.

async function authFetch(url, options = {}) {

    options.credentials = "include";

    const res = await fetch(url, options);

    if (res.status === 401 || res.status === 403) {

        sessionStorage.clear();
        localStorage.clear();

        alert("Session expired. Please login again.");

        window.location.href = "login.html";

        return null;
    }

    return res;
}

// ==========================================
// 3. AUTH CHECK — Runs when page loads
// ==========================================
// Call this at the top of every protected page.
// If user is not logged in, it redirects to login.

function checkAuth() {

    const email =
        sessionStorage.getItem("vault_email") ||
        localStorage.getItem("vault_email");

    if (!email) {

        window.location.href = "login.html";

        return false;
    }

    return true;
}

// ==========================================
// 4. LOADING OVERLAY
// ==========================================
// Shows a nice loading screen while the page fetches data.
// The HTML for this overlay must exist on the page (see loader.css).

function showPageLoader() {
    const loader = document.getElementById("pageLoader");
    if (loader) loader.style.display = "flex";
}

function hidePageLoader() {
    const loader = document.getElementById("pageLoader");
    if (loader) {
        loader.style.opacity = "0";
        setTimeout(() => {
            loader.style.display = "none";
            loader.style.opacity = "1";
        }, 300);
    }
}

// ==========================================
// 5. SHARED NAVIGATION HANDLERS
// ==========================================
// Sets up sidebar button clicks — same on every page

function setupNavigation() {
    const navMap = {
        "navDashboard": "dashboard.html",
        "navMyFiles": "Myfiles.html",
        "navSharedFiles": "sharedfiles.html",
        "navEncrypt": "dashencrypt.html",
        "navActivity": "activitylog.html",
        "navSettings": "settings.html",
        "backToDashboard": "dashboard.html"
    };

    Object.keys(navMap).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener("click", () => window.location.href = navMap[id]);
    });

    // Logout button
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            if (confirm("Log out?")) {
                try {
                    await authFetch("http://localhost:5000/api/logout", {
    method: "POST"
});
                } catch (e) {
                    console.log("Logout API unavailable");
                }
                sessionStorage.clear();
                localStorage.clear();
                window.location.href = "login.html";
            }
        });
    }
}
