const { ipcRenderer } = require("electron");
const quotes = require("./quotes");

const timerLabel = document.getElementById("timerLabel");
const workDurationInput = document.getElementById("workDuration");
const inactivityThresholdInput = document.getElementById("inactivityThreshold");
const resetThresholdInput = document.getElementById("resetThreshold");
const pauseResumeBtn = document.getElementById('pauseButton');
const resetButton = document.getElementById('resetButton');

const workTimerLabelColor = getComputedStyle(document.documentElement).getPropertyValue('--work-timer-label-color');
const breaktimeTimerLabelColor = getComputedStyle(document.documentElement).getPropertyValue('--break-timer-label-color');
const workTimerLabelText = "Work time - Let's do this!";
const breakTimerLabelText = "Break Time - You have earned it!";
const workTimerColor = getComputedStyle(document.documentElement).getPropertyValue('--work-timer-color');
const breaktimeTimerColor = getComputedStyle(document.documentElement).getPropertyValue('--break-timer-color');

function updateTimerLabel(text, color) {
  timerLabel.textContent = text;
  timerLabel.style.color = color;
}

ipcRenderer.on("initial-work-duration", (event, workDuration) => {
  updateTimerDisplay(workDuration);
});

ipcRenderer.on('timer-state-update', (event, data) => {
  if (data.isInBreakMode) {
    pauseResumeBtn.disabled = true;
    pauseResumeBtn.textContent = 'Break';
  } else if (data.isPaused) {
    pauseResumeBtn.disabled = false;
    pauseResumeBtn.textContent = 'Resume';
  } else if (data.isTimerRunning) {
    pauseResumeBtn.disabled = false;
    pauseResumeBtn.textContent = 'Pause';
  } else {
    pauseResumeBtn.disabled = false;
    pauseResumeBtn.textContent = 'Start';
  }
});

pauseResumeBtn.addEventListener('click', () => {
  if (pauseResumeBtn.textContent === 'Pause') {
    ipcRenderer.send('pause-timer');
  } else if (pauseResumeBtn.textContent === 'Resume') {
    ipcRenderer.send('resume-timer');
  } else if (pauseResumeBtn.textContent === 'Start') {
    ipcRenderer.send('start-timer');
  }
});

resetButton.addEventListener('click', () => {
  ipcRenderer.send('reset-timer');
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
  timerDisplay.style.color = workTimerColor; 
  updateTimerLabel(workTimerLabelText, workTimerLabelColor); // Revert the timer label
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

// Save settings to main process
function saveSettings() {
  const workDuration = parseInt(workDurationInput.value) * 60 * 1000;
  const inactivityThreshold = parseInt(inactivityThresholdInput.value) * 60 * 1000;
  const resetThreshold = parseInt(resetThresholdInput.value) * 60 * 1000;
  
  const newSettings = {
    workDuration,
    inactivityThreshold,
    resetThreshold,
    checkInterval: 1000 // Keep default check interval
  };
  
  ipcRenderer.send('save-settings', newSettings);
}


// Handle settings saved confirmation
ipcRenderer.on('settings-saved', (event, success) => {
  const settingsStatus = document.getElementById('settingsStatus');

  if (success) {
    // Collapse settings pane using your existing classes
    settingsContent.classList.remove('expanded');
    chevron.classList.remove('rotated');
    
    console.log('Settings saved successfully!');
    // Show success status
    settingsStatus.textContent = 'Settings saved successfully!';
    settingsStatus.className = 'mt-2 text-center text-green-500 font-bold';
  } else {
    console.log('Error saving settings!');
    settingsStatus.textContent = 'Error saving settings!';
    settingsStatus.className = 'mt-2 text-center text-red-500 font-bold';
  }


  // Show the element
  settingsStatus.classList.remove('hidden');
  
  // Hide after 3 seconds
  setTimeout(() => {
    settingsStatus.classList.add('hidden');
  }, 3000);
});




function updateBreakTimerDisplay(remainingBreakTime) {
  const minutes = Math.floor(remainingBreakTime / 60000);
  const seconds = Math.floor((remainingBreakTime % 60000) / 1000);
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const timerDisplay = document.getElementById('timer');
  timerDisplay.textContent = formattedTime;
  timerDisplay.style.color = breaktimeTimerColor; 
  updateTimerLabel(breakTimerLabelText, breaktimeTimerLabelColor); // Update the timer label

}

// Make saveSettings available globally so the onclick attribute works
window.saveSettings = saveSettings;