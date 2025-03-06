const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const path = require("path");

module.exports = {
  packagerConfig: {
    icon: path.resolve(
      __dirname,
      process.platform === "win32"
        ? "./assets/icons/win/icon"
        : process.platform === "darwin"
        ? "./assets/icons/mac/icon"
        : "./assets/icons/png/icon"
    ),
    asar: true,
    extraResource: ["./assets/"],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "your_app_name",
        iconUrl: path.resolve(__dirname, "./assets/icons/win/icon.ico"),
        setupIcon: path.resolve(__dirname, "./assets/icons/win/icon.ico"),
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    {
      name: "@electron-forge/maker-deb",
      config: {},
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {},
    },
    {
      name: "@electron-forge/maker-dmg",
      config: {
        icon: path.resolve(__dirname, "./assets/icons/mac/icon.icns"),
      },
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      options: FuseV1Options,
    }),
  ],
};