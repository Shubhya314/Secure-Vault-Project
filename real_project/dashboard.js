document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ Dashboard JS Loaded");

  // --- Sidebar Logic ---
  const navMyFiles = document.getElementById("navMyFiles");
  const navEncrypt = document.getElementById("navEncrypt");
  const navActivity = document.getElementById("navActivity");
  const navSettings = document.getElementById("navSettings");
  const logoutBtn = document.getElementById("logoutBtn");

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

  // --- Dashboard Data Elements ---
  const totalFilesBox = document.querySelector(".box1 h4");
  const storageText = document.getElementById("storageText");
  const storageBar = document.getElementById("storageBar");
  const lastLoginText = document.getElementById("lastLoginText");
  const recentActivity = document.querySelector(".recent_act");

  // --- Check Session ---
  const email = sessionStorage.getItem("vault_email");
  if (!email) {
    // If no email is found, redirect to login
    window.location.href = "login.html";
    return;
  }

  // === 1. Load Storage & Login Info ===
  async function loadDashboardData() {
    try {
      // Fetch from Server
      const response = await fetch(`http://localhost:5000/api/dashboard/${email}`);
      
      // If server is unreachable, this throws an error
      if (!response.ok) throw new Error("Server Error");

      const data = await response.json();
      
      // Update Total Files
      if(totalFilesBox) totalFilesBox.textContent = data.totalFiles || 0;

      // Update Storage Text & Bar
      const usedMB = parseFloat(data.totalMB || 0);
      const maxGB = 200;
      let display = usedMB < 1024 
        ? `${usedMB.toFixed(2)} MB` 
        : `${(usedMB / 1024).toFixed(2)} GB`;
      
      if(storageText) storageText.textContent = `${display} / ${maxGB} GB`;

      if(storageBar) {
        const percent = Math.min((usedMB / (maxGB * 1024)) * 100, 100);
        storageBar.style.width = `${percent}%`;
        // Color coding: Green -> Yellow -> Red
        storageBar.style.background = percent < 60 ? "#22c55e" : (percent < 85 ? "#eab308" : "#ef4444");
      }

      // Update Last Login
      if(lastLoginText) {
         if (data.lastLogin) {
             const d = new Date(data.lastLogin);
             // Format: DD/MM/YYYY, HH:MM
             lastLoginText.textContent = d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
         } else {
             lastLoginText.textContent = "First Login";
         }
      }

    } catch (err) {
      console.error("Dashboard Load Error:", err);
      if(storageText) storageText.textContent = "Server Offline";
      if(lastLoginText) lastLoginText.textContent = "Server Offline";
    }
  }

  // === 2. Load Recent Activity (Fixed URL) ===
  async function loadRecentActivity() {
    try {
      if (!recentActivity) return;

      // ✅ FIX: The URL must be /api/activity/all/ to match server.js
      const res = await fetch(`http://localhost:5000/api/activity/all/${email}`);
      
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();

      recentActivity.innerHTML = ""; // Clear "Loading..." text

      if (!Array.isArray(data) || data.length === 0) {
        recentActivity.innerHTML = `<p style="color:grey; text-align:center;">No recent activity.</p>`;
        return;
      }

      // Create list items
      data.forEach(act => {
        const div = document.createElement("div");
        div.className = "just_recent";
        
        // Handle timestamp (server now sends 'created_at' as 'timestamp')
        const time = act.timestamp ? new Date(act.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "";
        
        div.innerHTML = `
          <div style="display:flex; gap:10px; align-items:center;">
             <i class="fa-solid fa-clock"></i> <span>${act.action}</span>
          </div>
          <div style="color:#666; font-size:0.9em;">${time}</div>
        `;
        recentActivity.appendChild(div);
      });

    } catch (err) {
      console.error("Activity Load Error:", err);
      if(recentActivity) recentActivity.innerHTML = `<p style="color:red; text-align:center;">Server Offline</p>`;
    }
  }

  // Initial Load
  loadDashboardData();
  loadRecentActivity();

  // Refresh data every 5 seconds (Live Updates)
  setInterval(() => {
    loadDashboardData();
    loadRecentActivity();
  }, 5000);
});