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

// Add this to your main.js file, replacing the existing save-settings handler
ipcMain.on("save-settings", (event, newSettings) => {
  try {
    writeFileSync(settingsPath, JSON.stringify(newSettings));
    settings = newSettings; // Update settings in memory
    console.log("Settings saved successfully!");
    
    // Send a message back to renderer to collapse the settings pane
    event.reply("settings-saved", true);
  } catch (error) {
    console.error("Error saving settings:", error);
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

  // Use setInterval for activity checks
  activityTimer = setInterval(() => {
    const idleTime = powerMonitor.getSystemIdleTime(); // in seconds
    const currentTime = Date.now();

    console.log(
      `Idle Time: ${idleTime} seconds, Inactivity Threshold: ${
        settings.inactivityThreshold / 1000
      } seconds, Break Mode: ${isInBreakMode}`
    );

    // First check if user is idle
    if (idleTime > settings.inactivityThreshold / 1000) {
      console.log("User is inactive");
      if (isTimerRunning) {
        pauseTimer();
      }
    } else {
      // User is active
      if (isInBreakMode) {
        // If in break mode, do nothing - wait for break to complete
        console.log("In break mode - waiting for break to complete");
      } else if (!isTimerRunning) {
        // Not in break mode and timer not running
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
  }, 1000); // Check every second

  // Create tray icon
  const trayIconPath = !app.isPackaged
    ? path.join(__dirname, "./assets/timer-light.png")
    : path.join(process.resourcesPath, "assets/timer-light.png");

  fs.access(trayIconPath, fs.constants.F_OK, (err) => {
    if (!err) {
      tray = new Tray(trayIconPath);
      tray.setToolTip("Timer App");
    } else {
      console.log("Tray icon not found:", err);
    }
  });
}

function handleActivity(currentTime) {
  console.log("Handle activity called, isInBreakMode:", isInBreakMode);
  
  // Don't process activity events if in break mode
  if (isInBreakMode) {
    console.log("In break mode - ignoring activity event");
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
}

function pauseTimer() {
  console.log("Timer paused");
  
  if (isTimerRunning) {
    isTimerRunning = false;
    timerPausedTime = Date.now();
    clearTimeout(breakTimer);

    const elapsedTime = timerPausedTime - timerStartTime;
    const remainingTime = settings.workDuration - elapsedTime;

    mainWindow.webContents.send("timer-update", {
      status: "paused",
      remainingTime,
    });
  }
}

function resumeTimer() {
  console.log("Timer resumed");
  
  if (timerPausedTime && !isTimerRunning) {
    const pauseDuration = Date.now() - timerPausedTime;
    timerStartTime += pauseDuration;
    timerPausedTime = null;
    isTimerRunning = true;

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
}

function resetTimer() {
  console.log("Resetting timer and starting break period...");
  isTimerRunning = false;
  timerStartTime = null;
  timerPausedTime = null;
  clearTimeout(breakTimer);
  isInBreakMode = true; // Enter break mode
  timerCompletedOnce = true;

  mainWindow.webContents.send("timer-update", {
    status: "reset",
    remainingTime: settings.workDuration,
  });

  // Start break timer with regular updates to the UI
  const breakEndTime = Date.now() + settings.resetThreshold;
  const breakInterval = setInterval(() => {
    const remainingBreakTime = breakEndTime - Date.now();
    
    if (remainingBreakTime <= 0) {
      clearInterval(breakInterval);
      isInBreakMode = false; // Exit break mode
      startTimer(); // Start a new work timer
    } else {
      mainWindow.webContents.send("break-timer-update", { remainingBreakTime });
    }
  }, 1000);
}

function notifyBreakTime() {
  console.log("Break time triggered");
  mainWindow.webContents.send("break-time");
  resetTimer(); // This will start the break
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
  const tooltipText = `Remaining Time: ${minutes}:${seconds.toString().padStart(2, "0")}`;
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