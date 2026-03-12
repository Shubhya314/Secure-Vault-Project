// ==========================================
// 🔐 AUTH.JS — Shared Authentication Helper
// ==========================================
// Include this file on EVERY protected page (dashboard, myfiles, encrypt, etc.)
// It handles: JWT token management, auth checks, and loading overlay.

// ==========================================
// 1. TOKEN HELPERS
// ==========================================

// Get the JWT token from storage
function getToken() {
    return sessionStorage.getItem("vault_token") || localStorage.getItem("vault_token");
}

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
    const token = getToken();

    // Add the Authorization header with the token
    if (!options.headers) options.headers = {};
    if (token) {
        options.headers["Authorization"] = "Bearer " + token;
    }

    // Make the actual request
    const response = await fetch(url, options);

    // If server says 401 (not logged in) or 403 (token expired)
    if (response.status === 401 || response.status === 403) {
        alert("⏱️ Session expired. Please login again.");
        sessionStorage.clear();
        localStorage.clear();
        window.location.href = "login.html";
        return null; // Stop here
    }

    return response;
}

// ==========================================
// 3. AUTH CHECK — Runs when page loads
// ==========================================
// Call this at the top of every protected page.
// If user is not logged in, it redirects to login.

function checkAuth() {
    const token = getToken();
    const email = getEmail();

    if (!token || !email) {
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
        logoutBtn.addEventListener("click", () => {
            if (confirm("Log out?")) {
                sessionStorage.clear();
                localStorage.clear();
                window.location.href = "login.html";
            }
        });
    }
}
