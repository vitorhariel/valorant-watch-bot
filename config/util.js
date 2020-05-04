const dayjs = require("dayjs");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const twitchCookie = {
  domain: ".twitch.tv",
  hostOnly: false,
  httpOnly: false,
  name: "auth-token",
  path: "/",
  sameSite: "no_restriction",
  secure: true,
  session: false,
  storeId: "0",
  id: 1,
};

const logConfig = {
  appenders: {
    console: {
      type: "console",
      layout: {
        type: "pattern",
        pattern: "%[[%x{time}]%] %m",
        tokens: {
          time: () => {
            return dayjs().format("HH:mm:ss");
          },
        },
      },
    },
    file: {
      type: "file",
      filename: "./public/app.log",
      maxLogSize: 32768,
      backups: 2,
      layout: {
        type: "pattern",
        pattern: "[%x{time}] %m",
        tokens: {
          time: () => {
            return dayjs().format("HH:mm:ss");
          },
        },
      },
    },
  },
  categories: {
    default: { appenders: ["console", "file"], level: "info" },
  },
};

function initiateDb() {
  const database = new Database("database.db");

  const stmt = database.prepare(
    "CREATE TABLE IF NOT EXISTS riot (username TEXT PRIMARY KEY, password TEXT, email TEXT, region TEXT)"
  );
  const stmt2 = database.prepare(
    "CREATE TABLE IF NOT EXISTS twitch (username TEXT PRIMARY KEY, password TEXT, email TEXT, region TEXT, token TEXT, dropped INTEGER DEFAULT 0, comments TEXT, FOREIGN KEY(username) REFERENCES riot(username))"
  );

  stmt.run();
  stmt2.run();

  return database;
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", file), "UTF-8")
  );
}

module.exports = {
  getRandomInt,
  twitchCookie,
  logConfig,
  initiateDb,
  readJson,
};
