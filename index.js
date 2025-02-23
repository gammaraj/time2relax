// main.js
const { app, BrowserWindow, ipcMain, powerMonitor, Tray } = require("electron");
const path = require("path");
const { join } = require("path");
const { readFileSync, writeFileSync } = require("fs");
const activeWindows = require("active-win");
const fs = require("fs"); // Import the file system module

let mainWindow;
let activityTimer;
let breakTimer;
let lastActivityTime = Date.now();
let timerStartTime = null;
let timerPausedTime = null;
let isTimerRunning = false;
let tray = null;

const settingsPath = join(app.getPath("userData"), "settings.json");
console.log(settingsPath);

// Default settings (in milliseconds)
const defaultSettings = {
  workDuration: 5 * 60 * 1000, // 5 minutes
  inactivityThreshold: 60 * 1000, // 1 minute
  resetThreshold: 10 * 60 * 1000, // 10 minutes
  checkInterval: 1000, // Check activity every second
};

let settings = loadSettings();

function loadSettings() {
  try {
    const data = readFileSync(settingsPath, "utf-8");
    console.log(data);
    return JSON.parse(data);
  } catch (error) {
    console.warn("No settings file found. Using default settings.");
    return defaultSettings;
  }
}
ipcMain.on("request-settings", (event) => {
  event.reply("settings-loaded", settings);
});

ipcMain.on("save-settings", (event, newSettings) => {
  try {
    writeFileSync(settingsPath, JSON.stringify(newSettings));
    settings = newSettings; // Update settings in memory
    console.log("Settings saved successfully!");
  } catch (error) {
    console.error("Error saving settings:", error);
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
  // Add event listeners for different types of system activity
  powerMonitor.on("suspend", () => {
    pauseTimer();
  });

  powerMonitor.on("resume", () => {
    const currentTime = Date.now();
    handleActivity(currentTime);
  });

  // Use setInterval with a more comprehensive check
  activityTimer = setInterval(() => {
    const idleTime = powerMonitor.getSystemIdleTime();
    const currentTime = Date.now();

    if (idleTime > settings.inactivityThreshold) {
      handleInactivity(currentTime);
    } else {
      handleActivity(currentTime);
    }

    // Send remaining time to renderer process
    if (isTimerRunning) {
      const remainingTime =
        settings.workDuration - (Date.now() - timerStartTime);
      mainWindow.webContents.send("timer-update", { remainingTime });
      updateDockBadge(remainingTime); // Update dock/taskbar badge
      updateTrayTooltip(remainingTime); // Update tray tooltip
      updateTrayTitle(remainingTime); // Update tray title
    }
  }, 1000); // Check every second

  // Check if 'timer.png' exists before creating the tray icon
  //const trayIconPath = "./assets/timer-dark.png";
  //const trayIconPath = "./assets/timer-light.png";
  const trayIconPath = !app.isPackaged 
  ? path.join(__dirname, './assets/timer-light.png')
  : path.join(process.resourcesPath, 'assets/timer-light.png');

  try {
    fs.accessSync(trayIconPath, fs.constants.F_OK); // Check if the file exists
    console.log("File exists!");
    tray = new Tray(trayIconPath);
    tray.setToolTip("Timer App");
  } catch (err) {
    console.log("File does not exist:", err);
  }
}

function handleActivity(currentTime) {
  console.log("User is active");

  if (!isTimerRunning && !timerPausedTime && !timerStartTime) {
    // Only start new timer if no timer exists
    startTimer();
  } else if (timerPausedTime) {
    const pauseDuration = currentTime - timerPausedTime;
    if (pauseDuration >= settings.resetThreshold) {
      resetTimer();
      startTimer();
    } else {
      resumeTimer();
    }
  }
  lastActivityTime = currentTime;
}

function handleInactivity(currentTime, idleTime) {
  console.log("User is inactive");

  if (isTimerRunning && idleTime >= settings.inactivityThreshold) {
    pauseTimer();
  }
}

function startTimer() {
  console.log("Starting timer", settings.workDuration);
  timerStartTime = Date.now();
  isTimerRunning = true;
  timerPausedTime = null;

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
  const pauseDuration = Date.now() - timerPausedTime;
  timerStartTime += pauseDuration;
  timerPausedTime = null;
  isTimerRunning = true;

  const remainingTime = settings.workDuration - (Date.now() - timerStartTime);
  breakTimer = setTimeout(() => {
    notifyBreakTime();
  }, remainingTime);

  mainWindow.webContents.send("timer-update", {
    status: "resumed",
    remainingTime,
  });
}

function resetTimer() {
  clearTimeout(breakTimer);
  timerStartTime = null;
  timerPausedTime = null;
  isTimerRunning = false;

  mainWindow.webContents.send("timer-update", {
    status: "reset",
    remainingTime: settings.workDuration,
  });
}

function notifyBreakTime() {
  mainWindow.webContents.send("break-time");
  resetTimer();
}

// Function to update the dock/taskbar badge with remaining time
function updateDockBadge(remainingTime) {
  const minutes = Math.floor(remainingTime / 60000);
  const seconds = Math.floor((remainingTime % 60000) / 1000);
  const badgeText = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  if (process.platform === "darwin") {
    app.dock.setBadge(badgeText); // macOS
  } else if (process.platform === "win32") {
    mainWindow.setOverlayIcon(null, badgeText); // Windows
  }
}

// Function to update the tray tooltip with remaining time
function updateTrayTooltip(remainingTime) {
  const minutes = Math.floor(remainingTime / 60000);
  const seconds = Math.floor((remainingTime % 60000) / 1000);
  const tooltipText = `Remaining Time: ${minutes}:${seconds
    .toString()
    .padStart(2, "0")}`;
  tray.setToolTip(tooltipText);
}

// Function to update the tray title with remaining time
function updateTrayTitle(remainingTime) {
  const minutes = Math.floor(remainingTime / 60000);
  const seconds = Math.floor((remainingTime % 60000) / 1000);
  const titleText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  if (tray) {
    tray.setTitle(titleText); // This will display the time next to the tray icon on macOS
  }
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
