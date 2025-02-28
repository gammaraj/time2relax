const { ipcRenderer } = require("electron");
const quotes = require("./quotes");

const timerLabel = document.getElementById('timerLabel');
const workDurationInput = document.getElementById("workDuration");
const inactivityThresholdInput = document.getElementById("inactivityThreshold");
const resetThresholdInput = document.getElementById("resetThreshold");

function updateTimerLabel(text, color) {
  timerLabel.textContent = text;
  timerLabel.style.color = color;
}

ipcRenderer.on("initial-work-duration", (event, workDuration) => {
  updateTimerDisplay(workDuration);
});

ipcRenderer.on("settings-loaded", (event, loadedSettings) => {
  if (loadedSettings) {
    workDurationInput.value = loadedSettings.workDuration / (60 * 1000);
    inactivityThresholdInput.value =
      loadedSettings.inactivityThreshold / (60 * 1000);
    resetThresholdInput.value = loadedSettings.resetThreshold / (60 * 1000);
  }
});

ipcRenderer.send("request-settings");

function getRandomQuote() {
  const randomIndex = Math.floor(Math.random() * quotes.length);
  return quotes[randomIndex];
}

let timerDisplay = document.getElementById("timer");
//  updateTimerDisplay(10);
let statusDisplay = document.getElementById("status");

function formatTime(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Periodic update to show countdown
function updateTimerDisplay(remainingTime) {
  timerDisplay.textContent = formatTime(remainingTime);
  timerDisplay.style.color = 'blue'; // Set the color to black for work timer
  updateTimerLabel('Work time - Let\'s do this!', timerDisplay.style.color); // Revert the timer label
}

let timerInterval;

ipcRenderer.on('break-timer-update', (event, { remainingBreakTime }) => {
  updateBreakTimerDisplay(remainingBreakTime);
});

// Listen for timer updates from the main process
ipcRenderer.on("timer-update", (event, { remainingTime }) => {
  updateTimerDisplay(remainingTime);
});

ipcRenderer.on("timer-update", (event, data) => {
  console.log("Timer update received:", data);

  // Clear any existing interval
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  // Start a new interval to update timer display
  if (data.status === "started" || data.status === "resumed") {
    let remainingTime = data.remainingTime;

    timerInterval = setInterval(() => {
      remainingTime -= 1000;
      updateTimerDisplay(remainingTime);

      if (remainingTime <= 0) {
        clearInterval(timerInterval);
      }
    }, 1000);
  }

  // Update status text
  switch (data.status) {
    case "started":
      statusDisplay.textContent = "Timer Started";
      break;
    case "paused":
      statusDisplay.textContent = "Timer Paused";
      break;
    case "resumed":
      statusDisplay.textContent = "Timer Resumed";
      break;
    case "reset":
      statusDisplay.textContent = "Timer Reset";
      break;
  }
});
/*
const notification = new Notification("Break Time!", {
    body: getRandomQuote(),
  });
*/

ipcRenderer.on("break-time", () => {
  const notification = new Notification("Break Time!", {
    body: getRandomQuote(),
    requireInteraction: true,
  });
});

function saveSettings() {
  const workDuration = parseInt(workDurationInput.value) * 60 * 1000;
  const inactivityThreshold =
    parseInt(inactivityThresholdInput.value) * 60 * 1000;
  const resetThreshold = parseInt(resetThresholdInput.value) * 60 * 1000;

  ipcRenderer.send("save-settings", {
    workDuration,
    inactivityThreshold,
    resetThreshold,
  });

  alert("Settings saved!");
}

function updateBreakTimerDisplay(remainingBreakTime) {
  const minutes = Math.floor(remainingBreakTime / 60000);
  const seconds = Math.floor((remainingBreakTime % 60000) / 1000);
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const timerDisplay = document.getElementById('timer');
  timerDisplay.textContent = formattedTime;
  timerDisplay.style.color = 'green'; // Set the color to green
  updateTimerLabel('Break Time - You have earned it!', 'green'); // Update the timer label

}