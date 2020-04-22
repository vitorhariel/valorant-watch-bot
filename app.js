const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const cheerio = require("cheerio");
const dayjs = require("dayjs");
const relativeTime = require("dayjs/plugin/relativeTime");
const Table = require("cli-table");
const { getRandomInt, twitchCookie } = require("./config/util");

puppeteer.use(StealthPlugin());
dayjs.extend(relativeTime);

const { variables } = require("./config/variables");
const accounts = require("./config/accounts.json");

const app = express();
const router = express.Router();
const server = http.createServer(app);
const io = socketio(server);

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));

const isHeadless = variables.headless;
const followChannels = variables.followChannels;
const lowAudio = variables.lowAudio;

let startTime;
let updateTimer = -1;
let lengthAccounts;
let instances = [];

const table = new Table({
  head: ["Account Name", "Token", "Next Streamer", "Watching", "Got Key?"],
  colWidths: [20, 20, 20, 20, 20],
});

let lastTable = JSON.stringify(table);
let filteredAccounts;

async function startBot() {
  startTime = dayjs();

  filteredAccounts = accounts.filter((account) => {
    return !account.dropped && !account.disabled;
  });
  lengthAccounts = filteredAccounts.length;

  startInstances(filteredAccounts);
}

startBot();

async function startInstances(accounts) {
  const startingInstances = await accounts.map(async (account) => {
    return await newInstance(account);
  });

  Promise.all(startingInstances)
    .then((array) => {
      array.forEach((instance, index) => {
        setTimeout(async () => {
          instances.push(instance);
          await checkLogin(instance);
          const streamers = await getStreamers(instance);
          await selectStreamer(instance, streamers);
        }, 5000 + index * 500);
      });
    })
    .catch(() => {});
}

async function newInstance({ username, token }) {
  var browser = await puppeteer.launch({
    headless: isHeadless,
    defaultViewport: null,
    args: [
      "--window-size=1200,820",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
    executablePath: variables.chromePath || null,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 820 });
  await page.setUserAgent(variables.userAgent);
  const cookie = { ...twitchCookie, value: token };
  await page.setCookie(cookie);
  page.username = username;
  page.token = token;
  return page;
}

async function checkLogin(instance) {
  await instance.goto(variables.profileURL, {
    waitUntil: "networkidle0",
    timeout: 0,
  });

  const bodyHTML = await instance.evaluate(() => document.body.innerHTML);
  const $ = cheerio.load(bodyHTML);
  const username = $(
    'div[data-a-target="profile-username-input"] > input'
  ).val();

  if (!instance.username && username) {
    const accountFileIndex = accounts.findIndex((account) => {
      return account.token === instance.token;
    });

    if (accountFileIndex !== -1) {
      accounts[accountFileIndex].username = username;
      instance.username = username;
      instance.valid = true;
    } else {
      const newAccount = {
        username,
        token: instance.token,
      };
      accounts.push(newAccount);
      instance.username = username;
      lengthAccounts += 1;
    }

    fs.writeFile(
      "./config/accounts.json",
      JSON.stringify(accounts, null, 2),
      () => {}
    );

    table.push([username, instance.token, "", "", ""]);
  } else if (!username) {
    instance.invalid = true;
    table.push(["invalid", instance.token, "", "", "is invalid"]);
  } else {
    table.push([username, instance.token, "", "", ""]);
  }
}

async function getStreamers(instance) {
  await instance.goto(variables.streamersUrl, {
    waitUntil: "networkidle0",
    timeout: 0,
  });

  const bodyHTML = await instance.evaluate(() => document.body.innerHTML);
  const $ = cheerio.load(bodyHTML);
  const jquery = $('a[data-test-selector*="ChannelLink"]');

  const streamers = new Array();
  for (var i = 0; i < jquery.length; i++) {
    streamers[i] = jquery[i].attribs.href.split("/")[1];
  }
  return streamers;
}

async function selectStreamer(instance, streamers) {
  if (!instance.invalid) {
    const accountTableIndex = table.findIndex(
      (account) => account[0] === instance.username
    );

    let alive = true;
    let last_refresh = dayjs();
    let next_refresh = dayjs().add(1, "hour");

    while (alive) {
      let watching;

      if (dayjs(next_refresh).isBefore(last_refresh)) {
        streamers = await getAllStreamer(instance);
        last_refresh = dayjs();
      }

      while (!watching) {
        watching = streamers[getRandomInt(0, streamers.length)];
      }

      const minute = getRandomInt(10, 15);
      const sleep = minute * 60000;

      let next_streamer = dayjs().add(minute, "minute").format("HH:mm:ss");

      await instance.goto(variables.baseURL + watching, { timeout: 0 });

      const bodyHTML = await instance.evaluate(() => document.body.innerHTML);
      const $ = cheerio.load(bodyHTML);

      table[accountTableIndex][2] = next_streamer;
      table[accountTableIndex][3] = watching;

      const btnNotification = await instance.$(
        'button[aria-label="Open Notifications"]'
      );
      await btnNotification.evaluate((btn) => {
        btn.click();
      });

      await instance.waitForSelector(
        'div[role="dialog"] .tw-loading-spinner__circle',
        { hidden: true }
      );

      const dropNotification = await instance.$(
        'span[title="You just received the VALORANT Drop for watching Riot Games play VALORANT."]'
      );

      const accountFileIndex = accounts.findIndex((account) => {
        return account.token === instance.token;
      });

      if (dropNotification) {
        accounts[accountFileIndex].dropped = true;

        fs.writeFile(
          "./config/accounts.json",
          JSON.stringify(accounts, null, 2),
          () => {}
        );

        table[accountTableIndex][2] = "--";
        table[accountTableIndex][3] = "--";
        table[accountTableIndex][4] = "YES!";

        alive = false;
        await instance.browser().close();
      } else {
        accounts[accountFileIndex].dropped = false;

        fs.writeFile(
          "./config/accounts.json",
          JSON.stringify(accounts, null, 2),
          () => {}
        );

        table[accountTableIndex][4] = "Not yet";

        await setLowestQuality(instance);
        await instance.waitFor(sleep);
      }
    }
  } else {
    await instance.browser().close();
  }
}

async function setLowestQuality(instance) {
  const btnFollow = await instance.$('button[data-a-target="follow-button"]');
  if (btnFollow && followChannels && getRandomInt(0, 10) % 2 === 0) {
    await btnFollow.evaluate((btn) => btn.click());
  }

  if (lowAudio) {
    instance.$eval("video", (video) => {
      setInterval(function () {
        if (video.volume !== 0.01) video.volume = 0.01;
      }, 1000);
    });
  }

  const btnMatureAccept = await instance.$(
    'button[data-a-target="player-overlay-mature-accept"]'
  );
  if (btnMatureAccept) {
    await btnMatureAccept.evaluate((btn) => btn.click());
  }

  await instance
    .$('button[data-a-target="player-settings-button"]')
    .then((btn) =>
      btn.evaluate((btn) => {
        btn.click();
      })
    )
    .catch((err) => {});

  await instance
    .$('button[data-a-target="player-settings-menu-item-quality"]')
    .then((btn) =>
      btn.evaluate((btn) => {
        btn.click();
      })
    )
    .catch((err) => {});

  await instance
    .$(
      'div[data-a-target="player-settings-menu"] > div.tw-pd-05:last-child input'
    )
    .then((btn) =>
      btn.evaluate((btn) => {
        btn.click();
      })
    )
    .catch((err) => {});
}

function addAccount(token) {
  const accountData = {
    token,
  };

  startInstances([accountData]);
}

function restartBot() {
  io.emit("restarting");
  new Promise((resolve, reject) => {
    instances.forEach(async (instance, index, array) => {
      await instance.browser().close();
      table.length = 0;
      if (index === array.length - 1) resolve();
    });
  }).then(() => startBot());
}

setInterval(() => {
  if (
    JSON.stringify(table) !== lastTable ||
    (updateTimer >= 60 && table.length > 0) ||
    updateTimer === -1
  ) {
    // console.clear();

    const timeRunning = dayjs(startTime).fromNow();

    if (table.length > 0) {
      console.log(`Running since ${timeRunning}...\n`);
      console.log(table.toString());

      if (table.length !== lengthAccounts) {
        console.log(
          `Still trying to load ${
            lengthAccounts - table.length
          } other account(s)...`
        );
      }
    } else {
      console.log("Loading accounts...");
    }

    io.emit("update", {
      table: table,
    });

    lastTable = JSON.stringify(table);
    updateTimer = 0;
  }
  updateTimer += 1;
}, 1000);

io.on("connection", (socket) => {
  socket.emit("update", {
    table: table,
  });

  socket.on("request_update", () => {
    socket.emit("update", {
      table: table,
    });
  });

  socket.on("request_restart", () => {
    console.log("Restarting...");
    restartBot();
  });

  socket.on("add_account", (token) => {
    addAccount(token);
  });
});

router.get("/", (req, res) => {
  res.render("index");
});

app.use(router);
server.listen(3000);
