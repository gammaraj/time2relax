// main.js
const { app, BrowserWindow, ipcMain, powerMonitor } = require('electron');
const path = require('path');
const { join } = require('path');
const { readFileSync, writeFileSync } = require('fs');
const activeWindows = require('active-win');

let mainWindow;
let activityTimer;
let breakTimer;
let lastActivityTime = Date.now();
let timerStartTime = null;
let timerPausedTime = null;
let isTimerRunning = false;

const settingsPath = join(app.getPath('userData'), 'settings.json'); 

// Default settings (in milliseconds)
const defaultSettings = {
  workDuration: 5 * 60 * 1000, // 45 minutes
  inactivityThreshold: 60 * 1000, // 1 minute
  resetThreshold: 10 * 60 * 1000, // 10 minutes
  checkInterval: 1000, // Check activity every second
};

let settings = loadSettings();

function loadSettings() {
  try {
    const data = readFileSync(settingsPath, 'utf-8');
    console.log(data);
    return JSON.parse(data);
  } catch (error) {
    console.warn('No settings file found. Using default settings.');
    return defaultSettings;
  }
}
ipcMain.on('request-settings', (event) => {
  event.reply('settings-loaded', settings); 
});

ipcMain.on('save-settings', (event, newSettings) => {
  try {
    writeFileSync(settingsPath, JSON.stringify(newSettings));
    settings = newSettings; // Update settings in memory
    console.log('Settings saved successfully!');
  } catch (error) {
    console.error('Error saving settings:', error);
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  startActivityMonitoring();
}
function startActivityMonitoring() {
  // Add event listeners for different types of system activity
  powerMonitor.on('suspend', () => {
    pauseTimer();
  });

  powerMonitor.on('resume', () => {
    const currentTime = Date.now();
    handleActivity(currentTime);
  });

  // Use setInterval with a more comprehensive check
  activityTimer = setInterval(() => {
    const idleTime = powerMonitor.getSystemIdleTime();
    const currentTime = Date.now();
   
    // Detect activity if idle time is less than threshold
    if (idleTime < 1) { 
      handleActivity(currentTime);
    } else {
      handleInactivity(currentTime, idleTime * 1000);
    }
  }, settings.checkInterval);
}

function handleActivity(currentTime) {
  if (!isTimerRunning && !timerPausedTime) {
    // Start new timer
    startTimer();
  } else if (timerPausedTime) {
    const pauseDuration = currentTime - timerPausedTime;
    if (pauseDuration >= settings.resetThreshold) {
      // Reset and start new timer if pause was long
      resetTimer();
      startTimer();
    } else {
      // Resume existing timer if pause was short
      resumeTimer();
    }
  }
  lastActivityTime = currentTime;
}

function handleInactivity(currentTime, idleTime) {
  if (isTimerRunning && idleTime >= settings.inactivityThreshold) {
    pauseTimer();
  }
}

function startTimer() {
  console.log('Starting timer', settings.workDuration);
  timerStartTime = Date.now();
  isTimerRunning = true;
  timerPausedTime = null;
 
  breakTimer = setTimeout(() => {
    console.log('Break time triggered');
    notifyBreakTime();
  }, settings.workDuration);
 
  mainWindow.webContents.send('timer-update', {
    status: 'started',
    remainingTime: settings.workDuration
  });
}

function pauseTimer() {
  if (isTimerRunning) {
    isTimerRunning = false;
    timerPausedTime = Date.now();
    clearTimeout(breakTimer);
    
    const elapsedTime = timerPausedTime - timerStartTime;
    const remainingTime = settings.workDuration - elapsedTime;
    
    mainWindow.webContents.send('timer-update', {
      status: 'paused',
      remainingTime
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
  
  mainWindow.webContents.send('timer-update', {
    status: 'resumed',
    remainingTime
  });
}

function resetTimer() {
  clearTimeout(breakTimer);
  timerStartTime = null;
  timerPausedTime = null;
  isTimerRunning = false;
  
  mainWindow.webContents.send('timer-update', {
    status: 'reset',
    remainingTime: settings.workDuration
  });
}

function notifyBreakTime() {
  mainWindow.webContents.send('break-time');
  resetTimer();
}

// IPC handlers for settings updates
ipcMain.on('update-settings', (event, newSettings) => {
  Object.assign(settings, newSettings);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

