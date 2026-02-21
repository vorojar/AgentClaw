const serverInput = document.getElementById("server");
const apikeyInput = document.getElementById("apikey");
const saveBtn = document.getElementById("save");
const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");

// Load saved config
chrome.storage.local.get(["serverUrl", "apiKey"], (data) => {
  serverInput.value = data.serverUrl || "ws://localhost:3100";
  apikeyInput.value = data.apiKey || "";
});

// Save config
saveBtn.addEventListener("click", () => {
  chrome.storage.local.set({
    serverUrl: serverInput.value.trim(),
    apiKey: apikeyInput.value.trim(),
  });
  saveBtn.textContent = "Saved!";
  setTimeout(() => {
    saveBtn.textContent = "Save";
  }, 1500);
});

// Poll connection status via badge
function updateStatus() {
  chrome.action.getBadgeText({}, (text) => {
    const isOn = text === "ON";
    dot.className = `dot ${isOn ? "on" : "off"}`;
    statusText.textContent = isOn ? "Connected" : "Disconnected";
  });
}

updateStatus();
setInterval(updateStatus, 2000);
