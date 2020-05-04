const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs-extra");
const path = require("path");
const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const cheerio = require("cheerio");
const dayjs = require("dayjs");
const relativeTime = require("dayjs/plugin/relativeTime");
const log4js = require("log4js");
const {
  getRandomInt,
  twitchCookie,
  logConfig,
  initiateDb,
  readJson,
} = require("./config/util");

fs.unlink("./public/app.log", async (err) => {});
fs.ensureDir("./public/screenshots").catch((err) => log.error(err));
fs.ensureFile("./config/accounts.json").catch((err) => log.error(err));

log4js.configure(logConfig);
const log = log4js.getLogger("app");

puppeteer.use(StealthPlugin());
dayjs.extend(relativeTime);

let variables = readJson("./config/variables.json");
let accounts = readJson("./config/accounts.json");

const app = express();
const router = express.Router();
const server = http.createServer(app);
const io = socketio(server);

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));

const isHeadless = variables.headless;
const followChannels = variables.followChannels;
const lowAudio = variables.lowAudio;

let startTime;
let updateTimer = -1;
let lengthAccounts;
let instances = [];
let started = [];

const db = initiateDb();
const table = [];

let lastTable = JSON.stringify(table);
let filteredAccounts;

async function getFilteredAccounts(accountsToFilter) {
  filteredAccounts = accountsToFilter.filter((account) => {
    return !account.dropped && !account.disabled;
  });
  lengthAccounts = filteredAccounts.length;
  return filteredAccounts;
}

async function startBot() {
  startTime = dayjs();

  const filteredAccounts = await getFilteredAccounts(accounts);
  startInstances(filteredAccounts);
}

async function startInstances(accounts) {
  accounts.forEach((account, index) => {
    setTimeout(async () => {
      if (instances.length < variables.maxInstances) {
        if (
          !instances.some((i) => i.token === account.token) &&
          started.indexOf(account.token) === -1
        ) {
          started.push(account.token);
          const instance = await newInstance(account);
          instances.push(instance);
          await checkLogin(instance);
          const streamers = await getStreamers(instance);
          await selectStreamer(instance, streamers);
        }
      }
    }, index * 4000);
  });
}

async function newInstance({ username, token }) {
  log.info(`Creating instance for ${token}`);

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

  browser.on("disconnected", () => {
    log.info(`Instance ${token} with username ${username} was disconnected`);
    io.emit("browser_disconnected", token);
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
  log.info(`Checking login for ${instance.token}`);

  await instance
    .goto(variables.profileUrl, {
      waitUntil: "networkidle0",
      timeout: 0,
    })
    .catch(() => {});

  const bodyHTML = await instance.evaluate(() => document.body.innerHTML);
  const $ = cheerio.load(bodyHTML);
  const username = $(
    'div[data-a-target="profile-username-input"] > input'
  ).val();

  const accountFileIndex = accounts.findIndex((account) => {
    return account.token === instance.token;
  });

  if (!instance.username && username) {
    if (accountFileIndex !== -1) {
      accounts[accountFileIndex].username = username;
      accounts[accountFileIndex].disabled = false;
      instance.username = username;
      instance.valid = true;
    } else {
      log.info(
        `Saving new user ${instance.token} with username ${
          instance.username || username
        }`
      );
      const newAccount = {
        username,
        token: instance.token,
        disabled: false,
      };
      accounts.push(newAccount);
      instance.username = username;
    }

    table.push([username, instance.token, "", "", ""]);
  } else if (!username) {
    log.warn(`Token ${token} is invalid`);
    instance.invalid = true;
    table.push(["invalid", instance.token, "", "", "is invalid"]);
  } else {
    accounts[accountFileIndex].disabled = false;
    table.push([username, instance.token, "", "", ""]);
  }

  fs.writeFile(
    "./config/accounts.json",
    JSON.stringify(accounts, null, 2),
    () => {}
  );
}

async function getStreamers(instance) {
  log.info(`[${instance.username}] going to streamers page`);

  await instance
    .goto(variables.streamersUrl, {
      waitUntil: "networkidle0",
      timeout: 0,
    })
    .catch(() => {});

  const bodyHTML = await instance
    .evaluate(() => document.body.innerHTML)
    .catch(() => {});
  const $ = cheerio.load(bodyHTML);
  const jquery = $('a[data-test-selector*="ChannelLink"]');

  const streamers = new Array();
  for (var i = 0; i < jquery.length; i++) {
    streamers[i] = jquery[i].attribs.href.split("/")[1];
  }
  return streamers;
}

async function selectStreamer(instance, streamers) {
  try {
    if (!instance.invalid) {
      const accountTableIndex = table.findIndex(
        (account) => account[0] === instance.username
      );
      const accountInstanceIndex = instances.findIndex(
        (i) => i.token === instance.token
      );

      let alive = true;
      let last_refresh = dayjs();
      let next_refresh = dayjs().add(1, "hour");

      while (alive) {
        let watching;

        if (variables.fixedStream) {
          watching = variables.fixedStreamName;
        } else {
          if (dayjs(next_refresh).isBefore(last_refresh)) {
            streamers = await getAllStreamer(instance);
            last_refresh = dayjs();
          }

          while (!watching) {
            watching = streamers[getRandomInt(0, streamers.length)];
            instances[accountInstanceIndex].watching = watching;
          }
        }

        const minute = getRandomInt(10, 15);
        const sleep = minute * 60000;

        let next_streamer = dayjs().add(minute, "minute").format("HH:mm:ss");

        log.info(`[${instance.username}] selecting streamer ${watching}`);
        await instance
          .goto(variables.baseUrl + watching, { timeout: 0 })
          .catch(() => {});

        const bodyHTML = await instance
          .evaluate(() => document.body.innerHTML)
          .catch(() => {});
        const $ = cheerio.load(bodyHTML);

        table[accountTableIndex][2] = next_streamer;
        table[accountTableIndex][3] = watching;

        let btnNotification = await instance
          .$(
            "div.tw-flex.tw-flex-column.tw-flex-nowrap.tw-full-height > nav > div > div.tw-align-items-center.tw-flex.tw-flex-grow-1.tw-flex-shrink-1.tw-full-width.tw-justify-content-end > div:nth-child(3) > div > div.tw-relative > div > div:nth-child(1) > div > button"
          )
          .catch(() => {});

        log.info(`[${instance.username}] checking for drop`);
        await btnNotification
          .evaluate((btn) => {
            btn.click();
          })
          .catch(() => {});

        await instance
          .waitForSelector('div[role="dialog"] .tw-loading-spinner__circle', {
            hidden: true,
          })
          .catch(() => {});

        const dropNotification = await instance
          .$('span[title*="VALORANT Drop"]')
          .catch(() => {});

        const accountFileIndex = accounts.findIndex((account) => {
          return account.token === instance.token;
        });

        if (dropNotification) {
          log.info(`[${instance.username}] got a key!`);
          accounts[accountFileIndex].dropped = true;

          fs.writeFile(
            "./config/accounts.json",
            JSON.stringify(accounts, null, 2),
            () => {}
          );

          table[accountTableIndex][2] = "";
          table[accountTableIndex][3] = "";
          table[accountTableIndex][4] = "YES!";

          if (variables.enableDb) {
            const stmt = db.prepare(
              "UPDATE twitch SET dropped = 1, comments = '' WHERE token = ?"
            );

            stmt.run(instance.token);
          }

          alive = false;
          instances.splice(accountInstanceIndex, 1);
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

          await new Promise((resolve) => {
            instances[accountInstanceIndex].forceSkipStreamer = resolve;
            setTimeout(resolve, sleep);
          });
        }
      }
    } else {
      await instance.browser().close();
    }
  } catch (error) {}
}

async function setLowestQuality(instance) {
  const btnFollow = await instance.$('button[data-a-target="follow-button"]');
  if (btnFollow && followChannels && getRandomInt(0, 10) % 2 === 0) {
    log.info(`[${instance.username}] following streamer ${instance.watching}`);
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
    log.info(`[${instance.username}] accepting mature stream warning`);

    await btnMatureAccept.evaluate((btn) => btn.click());
  }

  log.info(`[${instance.username}] setting lowest quality for stream`);
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
  log.info(`Adding new account ${token}`);
  const accountData = {
    token,
  };

  lengthAccounts += 1;
  startInstances([accountData]);
}

function restartBot() {
  log.warn(`Restarting bot...`);
  io.emit("restarting");
  table.length = 0;
  new Promise((resolve, reject) => {
    instances.forEach(async (instance, index, array) => {
      await instance.waitForNavigation();
      await instance.browser().close();
      table.length = 0;
      if (index === array.length - 1) resolve();
    });
  }).then(() => startBot());
}

async function screenshot(token) {
  const accountTableIndex = instances.findIndex(
    (instance) => instance.token === token
  );

  const screenshot_id = token;
  const path = `public/screenshots/${screenshot_id}.png`;

  log.info(`[${instances[accountTableIndex].username}] taking screenshot`);
  fs.unlink(path, async (err) => {
    await instances[accountTableIndex]
      .screenshot({
        path,
      })
      .then(() => io.emit("deliver_screenshot", { screenshot_id, token }));
  });
}

async function skipStreamer(token) {
  const accountTableIndex = instances.findIndex(
    (instance) => instance.token === token
  );

  instances[accountTableIndex].forceSkipStreamer();

  setTimeout(() => {
    io.emit("deliver_skip_streamer", {
      token,
      username: instances[accountTableIndex].username,
    });
  }, 1500);
}

async function deleteAccount(token, noDisable) {
  const accountFileIndex = accounts.findIndex((account) => {
    return account.token === token;
  });

  const accountInstanceIndex = instances.findIndex(
    (instance) => instance.token === token
  );

  if (noDisable) {
    log.info(
      `Closing account ${token} with username ${
        instances[accountInstanceIndex].username
          ? instances[accountFileIndex].username
          : null
      } due to limit`
    );
  } else {
    accounts[accountFileIndex].disabled = true;

    log.info(
      `Disabling account ${token} with username ${
        instances[accountInstanceIndex].username
          ? instances[accountFileIndex].username
          : null
      }`
    );
  }

  fs.writeFile(
    "./config/accounts.json",
    JSON.stringify(accounts, null, 2),
    () => {}
  );

  await instances[accountInstanceIndex].browser().close();
  instances.splice(accountInstanceIndex, 1);
  table.splice(accountInstanceIndex, 1);
  lengthAccounts -= 1;
  io.emit("deliver_delete", token);
}

async function saveChanges(data) {
  variables = {
    headless: variables.headless,
    ...data,
  };

  fs.writeFile(
    "./config/variables.json",
    JSON.stringify(variables, null, 2),
    () => {}
  );

  io.emit("deliver_config_changes");
}

async function checkIfMoreInstancesThanMaximum() {
  if (instances.length > variables.maxInstances) {
    const removed = instances[instances.length - 1];

    deleteAccount(removed.token, true);
  }
}

setInterval(async () => {
  if (
    JSON.stringify(table) !== lastTable ||
    (updateTimer >= 60 && table.length > 0) ||
    updateTimer === -1
  ) {
    io.emit("update", {
      table,
    });

    if (instances.length < variables.maxInstances) {
      const filteredAccounts = await getFilteredAccounts(accounts);

      startInstances(filteredAccounts);
    }

    lastTable = JSON.stringify(table);
    updateTimer = 0;
  }
  variables = readJson("./config/variables.json");
  checkIfMoreInstancesThanMaximum();
  updateTimer += 1;
}, 1000);

io.on("connection", (socket) => {
  socket.emit("update", {
    table: table.length >= 1 ? table : [],
  });

  socket.on("request_update", () => {
    socket.emit("update", {
      table: table.length >= 1 ? table : [],
    });
  });

  socket.on("request_restart", () => {
    restartBot();
  });

  socket.on("add_account", (token) => {
    addAccount(token);
  });

  socket.on("request_screenshot", (token) => {
    screenshot(token);
  });

  socket.on("request_skip_streamer", (token) => {
    skipStreamer(token);
  });

  socket.on("request_delete", (token) => {
    deleteAccount(token);
  });

  socket.on("request_config_changes", (data) => {
    saveChanges(data);
  });
});

router.get("/", (req, res) => {
  res.render("index", { name: "index" });
});

router.get("/config", (req, res) => {
  variables = readJson("./config/variables.json");
  res.render("config", { name: "config", variables });
});

log.info("Listening on http://localhost:3000");

startBot();
app.use(router);
server.listen(3000);
