const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const dayjs = require("dayjs");
const relativeTime = require("dayjs/plugin/relativeTime");
const Table = require("cli-table");
const { getRandomInt } = require("./config/util");

dayjs.extend(relativeTime);

const { variables } = require("./config/variables");
const accounts = require("./config/accounts.json");

const isHeadless = true;
let changed = true;
let startTime;

const table = new Table({
  head: ["Account Name", "Next Streamer", "Watching", "Got Key?"],
  colWidths: [20, 20, 20, 20],
});

(async () => {
  const instances = await accounts.map(async (token) => {
    return await newInstance(token);
  });

  startTime = dayjs();

  Promise.all(instances).then((array) => {
    array.forEach((instance) => {
      setTimeout(async () => {
        await checkLogin(instance);
        const streamers = await getStreamers(instance);
        await selectStreamer(instance, streamers);
      }, 5000);
    });
  });
})();

async function newInstance(token) {
  var browser = await puppeteer.launch({
    headless: isHeadless,
    defaultViewport: null,
    ignoreDefaultArgs: ["--mute-audio"],
    args: ["--window-size=620,620"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 620, height: 620 });
  await page.setUserAgent(variables.userAgent);
  const cookie = { ...variables.cookie, value: token };
  await page.setCookie(cookie);
  page.authToken = token;
  return page;
}

async function checkLogin(instance) {
  try {
    await instance.goto(variables.profileURL, {
      waitUntil: "networkidle0",
      timeout: 0,
    });

    const bodyHTML = await instance.evaluate(() => document.body.innerHTML);
    const $ = cheerio.load(bodyHTML);
    const username = $(
      'div[data-a-target="profile-username-input"] > input'
    ).val();

    if (username) {
      instance.username = username;
      table.push([username, "", "", ""]);
    } else {
      table.push([instance.authToken, "is invalid", "", ""]);
    }
  } catch (error) {
    table.push([instance.authToken, "went wrong", "", ""]);
  }

  changed = true;
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
  changed = true;
  return streamers;
}

async function selectStreamer(instance, streamers) {
  const accountIndex = table.findIndex((a) => a[0] === instance.username);

  let last_refresh = dayjs();
  let next_refresh = dayjs().add(1, "hour");

  while (true) {
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
    const notification = $(
      'div[data-test-selector="onsite-notifications__badge"]'
    );

    table[accountIndex][2] = watching;
    table[accountIndex][1] = next_streamer;

    if (notification.length) {
      table[accountIndex][3] = "YES!";
    } else {
      table[accountIndex][3] = "Not yet";
    }

    changed = true;
    await instance.waitFor(sleep);
  }
}

setInterval(
  () => {
    console.clear();

    const timeRunning = dayjs(startTime).fromNow();

    if (table.length > 0) {
      console.log(`Running since ${timeRunning}...\n`);
      // console.log(table);

      console.log(table.toString());

      if (table.length !== accounts.length) {
        console.log(
          `Still trying to load ${
            accounts.length - table.length
          } other account(s)...`
        );
      }
    } else {
      console.log("Loading accounts...");
    }

    changed = false;
  },
  changed ? 1000 : 5000
);
