document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ Dashboard JS Loaded");

  // ✅ Auth check — redirects to login if no token
  if (!checkAuth()) return;

  // ✅ Setup sidebar navigation (from auth.js)
  setupNavigation();

  // --- Dashboard Data Elements ---
  const totalFilesBox = document.querySelector(".box1 h4");
  const storageText = document.getElementById("storageText");
  const storageBar = document.getElementById("storageBar");
  const lastLoginText = document.getElementById("lastLoginText");
  const recentActivity = document.querySelector(".recent_act");
  const welcomeName = document.getElementById("welcomeName");

  // --- Set Welcome Name from Email ---
  const email = getEmail();
  if (welcomeName && email) {
    // Extract name part from email (e.g. "shubham" from "shubham@gmail.com")
    welcomeName.textContent = email.split("@")[0];
  }

  // === 1. Load Storage & Login Info ===
  async function loadDashboardData() {
    try {
      // ✅ Using authFetch instead of fetch — automatically adds JWT token
      const response = await authFetch(`http://localhost:5000/api/dashboard/${email}`);
      if (!response) return; // authFetch returns null if redirected to login

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
        storageBar.style.background = percent < 60 ? "#22c55e" : (percent < 85 ? "#eab308" : "#ef4444");
      }

      // Update Last Login
      if(lastLoginText) {
         if (data.lastLogin) {
             const d = new Date(data.lastLogin);
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

  // === 2. Load Recent Activity ===
  async function loadRecentActivity() {
    try {
      if (!recentActivity) return;

      // ✅ Using authFetch instead of fetch
      const res = await authFetch(`http://localhost:5000/api/activity/all/${email}`);
      if (!res) return;
      
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();

      recentActivity.innerHTML = "";

      if (!Array.isArray(data) || data.length === 0) {
        recentActivity.innerHTML = `<p style="color:grey; text-align:center;">No recent activity.</p>`;
        return;
      }

      data.forEach(act => {
        const div = document.createElement("div");
        div.className = "just_recent";
        
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

  // Initial Load — then hide the loading overlay
  Promise.all([loadDashboardData(), loadRecentActivity()]).then(() => {
    hidePageLoader(); // ✅ Hide loading overlay once data is loaded
  });

  // Refresh data every 5 seconds (Live Updates)
  setInterval(() => {
    loadDashboardData();
    loadRecentActivity();
  }, 5000);
});