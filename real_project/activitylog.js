document.addEventListener("DOMContentLoaded", () => {
    // Check Session Storage FIRST, then Local Storage
const email = sessionStorage.getItem("vault_email") || localStorage.getItem("vault_email");
const publicKey = sessionStorage.getItem("vault_publicKey") || localStorage.getItem("vault_publicKey");
    const tableBody = document.getElementById("logTableBody");
    const logoutBtn = document.getElementById("logoutBtn");

    if (!email) {
        window.location.href = "login.html";
        return;
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            sessionStorage.clear();
            window.location.href = "login.html";
        });
    }

    // Helper: Parse messy User-Agent string
    function parseDevice(userAgent) {
        if (!userAgent) return "Unknown";
        let browser = "Unknown Browser";
        let os = "Unknown OS";

        if (userAgent.includes("Win")) os = "Windows";
        else if (userAgent.includes("Mac")) os = "MacOS";
        else if (userAgent.includes("Linux")) os = "Linux";
        else if (userAgent.includes("Android")) os = "Android";
        else if (userAgent.includes("iPhone")) os = "iPhone";

        if (userAgent.includes("Chrome")) browser = "Chrome";
        else if (userAgent.includes("Firefox")) browser = "Firefox";
        else if (userAgent.includes("Safari")) browser = "Safari";
        else if (userAgent.includes("Edge")) browser = "Edge";

        return `${browser} on ${os}`;
    }

    // Helper: Get Icon
    function getActionIcon(action) {
        const lower = action.toLowerCase();
        if (lower.includes("login") || lower.includes("logged")) return `<i class="fa-solid fa-key icon-login"></i>`;
        if (lower.includes("encrypt") || lower.includes("upload")) return `<i class="fa-solid fa-cloud-arrow-up icon-upload"></i>`;
        if (lower.includes("delete")) return `<i class="fa-solid fa-trash icon-delete"></i>`;
        return `<i class="fa-solid fa-circle-info"></i>`;
    }

    async function fetchLogs() {
        try {
            const res = await fetch(`http://localhost:5000/api/activity/all/${email}`);
            const logs = await res.json();

            tableBody.innerHTML = "";
            if (logs.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center">No activity found.</td></tr>`;
                return;
            }

            logs.forEach(log => {
                const dateObj = new Date(log.timestamp);
                const date = dateObj.toLocaleDateString();
                const time = dateObj.toLocaleTimeString();
                const niceDevice = parseDevice(log.device);

                const row = `
                    <tr>
                        <td>${getActionIcon(log.action)} <strong>${log.action}</strong></td>
                        <td><span class="device-info">${niceDevice}</span></td>
                        <td>${log.ip_address}</td>
                        <td>${date} <span style="color:#999; font-size:12px;">${time}</span></td>
                    </tr>
                `;
                tableBody.innerHTML += row;
            });

            // ✅ 1. ADD THIS LINE HERE (Inside the try block, after the loop)
            renderCharts(logs);

        } catch (err) {
            console.error(err);
            tableBody.innerHTML = `<tr><td colspan="4" style="color:red; text-align:center">Error loading logs.</td></tr>`;
        }
    }

    // Load logs initially
    fetchLogs();

    // Listen for Real-time updates
    const socket = io("http://localhost:5000");
    socket.on("activityUpdate", () => {
        console.log("🔔 New activity! Refreshing table...");
        fetchLogs();
    });

    // ============================================================
    // ✅ 2. PASTE THIS WHOLE SECTION AT THE BOTTOM (Inside the bracket)
    // ============================================================
    
    let actionChartInstance = null;
    let volumeChartInstance = null;

    function renderCharts(logs) {
        // Only run if the elements exist (prevents errors if HTML is missing)
        if (!document.getElementById('actionChart') || !document.getElementById('volumeChart')) return;

        // 1. Process Data for Pie Chart
        let counts = { Login: 0, Encryption: 0, Deletion: 0, Other: 0 };

        logs.forEach(log => {
            const act = log.action.toLowerCase();
            if (act.includes("login") || act.includes("logged")) counts.Login++;
            else if (act.includes("encrypt") || act.includes("upload")) counts.Encryption++;
            else if (act.includes("delete")) counts.Deletion++;
            else counts.Other++;
        });

        // 2. Process Data for Bar Chart
        const days = {};
        logs.forEach(log => {
            const date = new Date(log.timestamp).toLocaleDateString();
            days[date] = (days[date] || 0) + 1;
        });

        const sortedDates = Object.keys(days).sort((a, b) => new Date(a) - new Date(b)).slice(-7);
        const dateCounts = sortedDates.map(date => days[date]);

        // 3. Render Pie Chart
        const ctx1 = document.getElementById('actionChart').getContext('2d');
        if (actionChartInstance) actionChartInstance.destroy();

        actionChartInstance = new Chart(ctx1, {
            type: 'doughnut',
            data: {
                labels: ['Login', 'Encryption', 'Deletion', 'Other'],
                datasets: [{
                    data: [counts.Login, counts.Encryption, counts.Deletion, counts.Other],
                    backgroundColor: ['#22c55e', '#3b82f6', '#ef4444', '#94a3b8'],
                    hoverOffset: 4
                }]
            }
        });

        // 4. Render Bar Chart
        const ctx2 = document.getElementById('volumeChart').getContext('2d');
        if (volumeChartInstance) volumeChartInstance.destroy();

        volumeChartInstance = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: sortedDates,
                datasets: [{
                    label: 'Actions per Day',
                    data: dateCounts,
                    backgroundColor: '#6366f1',
                    borderRadius: 5
                }]
            },
            options: {
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    }

}); // <--- End of DOMContentLoaded