// main.js
const { app, BrowserWindow, ipcMain, powerMonitor, Tray } = require("electron");
const path = require("path");
const { join } = require("path");
const { readFileSync, writeFileSync } = require("fs");
const activeWindows = require("active-win");
const fs = require("fs");

let mainWindow;
let activityTimer;
let breakTimer;
let lastActivityTime = Date.now();
let timerStartTime = null;
let timerPausedTime = null;
let isTimerRunning = false;
let isManuallyPaused = false; // Add this at the top with your other state variables
let tray = null;
let timerCompletedOnce = false;
let remainingTime = null;
let isInBreakMode = false; // New flag to track if we're in break mode
const settingsPath = join(app.getPath("userData"), "settings.json");

// Default settings (in milliseconds)
const defaultSettings = {
  workDuration: 5 * 60 * 1000, // 5 minutes
  inactivityThreshold: 60 * 1000, // 1 minute
  resetThreshold: 10 * 60 * 1000, // 10 minutes
  checkInterval: 1000, // Check activity every second
};

let settings = loadSettings();
console.log(settings);

function loadSettings() {
  try {
    const data = readFileSync(settingsPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.warn("No settings file found. Using default settings.");
    return defaultSettings;
  }
}

ipcMain.on("request-settings", (event) => {
  event.reply("settings-loaded", settings);
});

ipcMain.on("start-timer", () => {
  startTimer();
});

ipcMain.on("pause-timer", () => {
  pauseTimer(true); // Mark as manual pause
});

ipcMain.on("reset-timer", (event, startBreak = false) => {
  resetTimer(startBreak);
});

ipcMain.on("resume-timer", () => {
  isManuallyPaused = false; // Clear the manual pause flag
  resumeTimer();
});

// Add this to your main.js file, replacing the existing save-settings handler
ipcMain.on("save-settings", (event, newSettings) => {
  try {
    // Stop any running timers and clear timeouts
    isTimerRunning = false;
    timerStartTime = null;
    timerPausedTime = null;
    clearTimeout(breakTimer);
    clearInterval(activityTimer);

    // Update settings in memory
    writeFileSync(settingsPath, JSON.stringify(newSettings));
    settings = newSettings; // Update settings in memory
    console.log("Settings saved successfully!");

    // Reset all time-related variables
    startActivityMonitoring();

    // Send a message back to renderer to collapse the settings pane
    console.log(
      "Sending message to renderer to collapse the settings pane and update UI..."
    );
    event.reply("settings-saved", true);
    mainWindow.webContents.send("initial-work-duration", settings.workDuration);
    updateTimerState(); // Send initial button state
  } catch (error) {
    //console.error("Error saving settings:", error);
    console.error(error);

    // Notify renderer about the error
    event.reply("settings-saved", false);
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile("index.html");
  startActivityMonitoring();

  // Send initial workDuration to renderer
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("initial-work-duration", settings.workDuration);
    updateTimerState(); // Send initial button state
  });
}

function startActivityMonitoring() {
  // Add event listeners for system activity
  powerMonitor.on("suspend", () => {
    if (isTimerRunning) {
      pauseTimer();
    }
  });

  powerMonitor.on("resume", () => {
    const currentTime = Date.now();
    handleActivity(currentTime);
  });

  // In your startActivityMonitoring function, update the interval logic:
  activityTimer = setInterval(() => {
    const idleTime = powerMonitor.getSystemIdleTime(); // in seconds
    const currentTime = Date.now();

    console.log(
      `Idle Time: ${idleTime} seconds, Inactivity Threshold: ${
        settings.inactivityThreshold / 1000
      } seconds, Break Mode: ${isInBreakMode}, Manually Paused: ${isManuallyPaused}`
    );

    // First check if user is idle
    if (idleTime > settings.inactivityThreshold / 1000) {
      console.log("User is inactive");
      if (isTimerRunning) {
        pauseTimer(false); // Not a manual pause
      }
    } else {
      // User is active
      if (isInBreakMode) {
        // If in break mode, do nothing - wait for break to complete
        console.log("In break mode - waiting for break to complete");
      } else if (!isTimerRunning && !isManuallyPaused) {
        // Only auto-resume if not manually paused
        // Not in break mode and timer not running and not manually paused
        if (timerPausedTime) {
          // Timer was paused, check if we should resume or reset
          const pauseDuration = currentTime - timerPausedTime;
          if (pauseDuration >= settings.resetThreshold) {
            console.log("Long pause detected, resetting timer");
            resetTimer();
          } else {
            console.log("Short pause detected, resuming timer");
            resumeTimer();
          }
        } else if (!timerStartTime) {
          // No timer exists, start a new one
          console.log("No timer exists, starting new timer");
          startTimer();
        }
      }
      // If timer is running, just update last activity time
      lastActivityTime = currentTime;
    }
    // Send remaining time to renderer process
    if (isTimerRunning && mainWindow) {
      remainingTime = settings.workDuration - (Date.now() - timerStartTime);
      mainWindow.webContents.send("timer-update", { remainingTime });
      updateDockBadge(remainingTime);
      updateTrayTooltip(remainingTime);
      updateTrayTitle(remainingTime);
    }
  }, 1000);

  // Create tray icon
  const trayIconPath = !app.isPackaged
    ? path.join(__dirname, "./assets/timer-light.png")
    : path.join(process.resourcesPath, "assets/timer-light.png");

  fs.access(trayIconPath, fs.constants.F_OK, (err) => {
    if (!err) {
      if (!tray) {
        tray = new Tray(trayIconPath);
      }
      tray.setToolTip("Timer App");
    } else {
      console.log("Tray icon not found:", err);
    }
  });
}

function handleActivity(currentTime) {
  console.log(
    "Handle activity called, isInBreakMode:",
    isInBreakMode,
    "isManuallyPaused:",
    isManuallyPaused
  );

  // Don't process activity events if in break mode or manually paused
  if (isInBreakMode || isManuallyPaused) {
    console.log("In break mode or manually paused - ignoring activity event");
    return;
  }

  if (!isTimerRunning) {
    if (timerPausedTime) {
      // Timer was paused, decide whether to resume or reset
      const pauseDuration = currentTime - timerPausedTime;
      if (pauseDuration >= settings.resetThreshold) {
        console.log("Long pause detected, resetting timer");
        resetTimer();
      } else {
        console.log("Short pause detected, resuming timer");
        resumeTimer();
      }
    } else if (!timerStartTime) {
      // No timer exists, start a new one
      console.log("No timer exists, starting new timer");
      startTimer();
    }
  }

  lastActivityTime = currentTime;
}

function startTimer() {
  console.log("Starting timer", settings.workDuration);
  timerStartTime = Date.now();
  isTimerRunning = true;
  timerPausedTime = null;
  isInBreakMode = false;

  breakTimer = setTimeout(() => {
    console.log("Break time triggered");
    notifyBreakTime();
  }, settings.workDuration);

  mainWindow.webContents.send("timer-update", {
    status: "started",
    remainingTime: settings.workDuration,
  });

  updateTimerState();
}
function pauseTimer(isManual = false) {
  console.log("Timer paused, manual pause:", isManual);

  if (isTimerRunning) {
    isTimerRunning = false;
    timerPausedTime = Date.now();
    isManuallyPaused = isManual; // Set the flag
    clearTimeout(breakTimer);

    const elapsedTime = timerPausedTime - timerStartTime;
    const remainingTime = settings.workDuration - elapsedTime;

    mainWindow.webContents.send("timer-update", {
      status: "paused",
      remainingTime,
    });
  }

  updateTimerState();
}

function resumeTimer() {
  console.log("Timer resumed");

  if (timerPausedTime && !isTimerRunning) {
    const pauseDuration = Date.now() - timerPausedTime;
    timerStartTime += pauseDuration;
    timerPausedTime = null;
    isTimerRunning = true;
    isManuallyPaused = false; // Clear the manual pause flag

    const remainingTime = settings.workDuration - (Date.now() - timerStartTime);
    if (remainingTime <= 0) {
      // If no time left after resuming, trigger break immediately
      notifyBreakTime();
    } else {
      breakTimer = setTimeout(() => {
        notifyBreakTime();
      }, remainingTime);

      mainWindow.webContents.send("timer-update", {
        status: "resumed",
        remainingTime,
      });
    }
  }

  updateTimerState();
}

function resetTimer(startBreak = true) {
  console.log("Resetting timer...");
  isTimerRunning = false;
  timerStartTime = null;
  timerPausedTime = null;
  clearTimeout(breakTimer);

  mainWindow.webContents.send("timer-update", {
    status: "reset",
    remainingTime: settings.workDuration,
  });

  if (startBreak) {
    isInBreakMode = true; // Enter break mode
    timerCompletedOnce = true;

    // Start break timer with regular updates to the UI
    const breakEndTime = Date.now() + settings.resetThreshold;
    const breakInterval = setInterval(() => {
      const remainingBreakTime = breakEndTime - Date.now();

      if (remainingBreakTime <= 0) {
        clearInterval(breakInterval);
        isInBreakMode = false; // Exit break mode
        startTimer(); // Start a new work timer
      } else {
        mainWindow.webContents.send("break-timer-update", {
          remainingBreakTime,
        });
      }
    }, 1000);
  } else {
    isInBreakMode = false;
  }

  updateTimerState();
}

function notifyBreakTime() {
  console.log("Break time triggered");
  mainWindow.webContents.send("break-time");
  if (tray) {
    tray.setTitle("Break Time!"); // Update tray tooltip to "Break Time!"
  }
  resetTimer(); // This will start the break
  updateTrayTooltip(0); // Reset the tooltip
}

function updateDockBadge(remainingTime) {
  if (remainingTime < 0) remainingTime = 0;
  const minutes = Math.floor(remainingTime / 60000);
  const seconds = Math.floor((remainingTime % 60000) / 1000);
  const badgeText = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  if (process.platform === "darwin") {
    app.dock.setBadge(badgeText); // macOS
  } else if (process.platform === "win32" && mainWindow) {
    mainWindow.setOverlayIcon(null, badgeText); // Windows
  }
}

function updateTrayTooltip(remainingTime) {
  if (!tray) return;

  if (remainingTime < 0) remainingTime = 0;
  const minutes = Math.floor(remainingTime / 60000);
  const seconds = Math.floor((remainingTime % 60000) / 1000);
  let tooltipText = `Remaining Time: ${minutes}:${seconds
    .toString()
    .padStart(2, "0")}`;

  /*  if (remainingTime === 0) {
    tooltipText = "Break Time!";
  }
*/

  tray.setToolTip(tooltipText);
}

function updateTrayTitle(remainingTime) {
  if (!tray) return;

  if (remainingTime < 0) remainingTime = 0;
  const minutes = Math.floor(remainingTime / 60000);
  const seconds = Math.floor((remainingTime % 60000) / 1000);
  const titleText = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  tray.setTitle(titleText);
}

// IPC handlers for settings updates
ipcMain.on("update-settings", (event, newSettings) => {
  Object.assign(settings, newSettings);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function updateTimerState() {
  if (mainWindow) {
    mainWindow.webContents.send("timer-state-update", {
      isTimerRunning: isTimerRunning,
      isInBreakMode: isInBreakMode,
      isPaused: !isTimerRunning && timerPausedTime !== null,
    });
  }
}
