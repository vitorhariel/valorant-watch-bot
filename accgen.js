const axios = require("axios");
const faker = require("faker");
const Database = require("better-sqlite3");
const imaps = require("imap-simple");
const simpleParser = require("mailparser").simpleParser;
const _ = require("lodash");

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

let db;

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

(async () => {
  try {
    db = initiateDb();
    const apiKey = "afa5e6f00afb0ede17af5979c863335e";
    const password = "Supremo0@";
    const data = {
      region: "NA1",
    };

    const randomUser = faker
      .fake("{{internet.userName}}{{random.number}}")
      .replace(".", "")
      .replace("_", "");
    data.username = randomUser;
    data.email = `${randomUser}@valorantgamer.club`;
    data.password = password;

    const riotAccount = await newRiot(apiKey, data);

    if (!riotAccount) {
      throw "Riot account registration error";
    }

    const twitchAccount = await newTwitch(apiKey, data, true);

    if (!twitchAccount) {
      throw "Twitch account registration error";
    }

    await initiateLinkAccount(twitchAccount, riotAccount);
    await confirmLastTwitchAccount();

    await db.close();
  } catch (error) {
    if (error.response) {
      if (error.response.data.error) {
        console.log(error.response.data.error);
      } else {
        console.log(error);
      }
    } else {
      console.log(error);
    }
  }
})();

function initiateDb() {
  const db = new Database("database.db");

  const stmt = db.prepare(
    "CREATE TABLE IF NOT EXISTS riot (username TEXT PRIMARY KEY, password TEXT, email TEXT, region TEXT)"
  );
  const stmt2 = db.prepare(
    "CREATE TABLE IF NOT EXISTS twitch (username TEXT PRIMARY KEY, password TEXT, email TEXT, region TEXT, token TEXT, dropped INTEGER DEFAULT 0, comments TEXT, FOREIGN KEY(username) REFERENCES riot(username))"
  );

  stmt.run();
  stmt2.run();

  return db;
}

async function newRiot(apiKey, data) {
  const requestId = await initiateCaptcha(apiKey, 1);
  const response = await pollForRequestResults(apiKey, requestId);

  if (!response.startsWith("OK|")) throw response;

  const captcha_answer = response.replace("OK|", "");

  try {
    const riotResponse = await createRiotAccount(data, captcha_answer);

    if (riotResponse.status === 200) {
      console.log(
        `Account RIOT ${riotResponse.data.account.accountId} created`
      );
      const stmt = db.prepare(
        "INSERT INTO riot(username, password, email, region)VALUES (?, ?, ?, ?)"
      );
      stmt.run(data.username, data.password, data.email, data.region);
      return data;
    }
  } catch (error) {
    if (error.response) {
      const { fields } = error.response.data;

      if (fields) {
        for (let key in fields) {
          console.log(`Failed with ${fields[key]} on key ${key}`);
        }
      }
    } else {
      console.log(error);
    }
    return false;
  }
}

async function newTwitch(apiKey, data, manual) {
  let captcha_answer;
  if (!manual) {
    const requestId = await initiateCaptcha(apiKey, 2);
    const response = await pollForRequestResults(apiKey, requestId);
    if (!response.startsWith("OK|")) throw Error(response);
    captcha_answer = response.replace("OK|", "");
  } else {
    console.log("Waiting for captcha answer");
    let browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        "--window-size=350,600",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 350, height: 600 });

    await page.goto(
      "https://client-api.arkoselabs.com/fc/api/nojs/?bootstrap=0&fb_type=1&lang=en&litejs=1&pkey=E5554D43-23CC-1982-971D-6A2262A2CA24&r=us-east-1&session=5605ea5e4682a6b25.4855365301&gametype=",
      {
        waitUntil: "networkidle0",
      }
    );

    await page.waitForSelector("#victoryScreen", { timeout: 0 });

    const verificationCode = await page.$("#verification-code");
    const answer = await page.evaluate((x) => x.value, verificationCode);

    await browser.close();

    captcha_answer = `${answer}|metabgclr=transparent|guitextcolor=%23000000|metaiconclr=%23757575|meta=3|pk=E5554D43-23CC-1982-971D-6A2262A2CA24|at=40|ht=1|atp=2|cdn_url=https://cdn.arkoselabs.com/fc|lurl=https://audio-eu-west-1.arkoselabs.com|surl=https://client-api.arkoselabs.com`;
  }
  try {
    const twitchResponse = await createTwitchAccount(data, captcha_answer);

    if (twitchResponse.status === 200) {
      console.log(`Account TWITCH ${twitchResponse.data.access_token} created`);

      const stmt = db.prepare(
        "INSERT INTO twitch(username, password, email, region, token)VALUES (?, ?, ?, ?, ?)"
      );
      stmt.run(
        data.username,
        data.password,
        data.email,
        data.region,
        twitchResponse.data.access_token
      );
      return twitchResponse.data.access_token;
    }
  } catch (error) {
    console.log(error);
    return false;
  }
}

async function initiateCaptcha(apiKey, type) {
  const params = {
    key: apiKey,
  };

  if (type === 1) {
    params.method = "userrecaptcha";
    params.googlekey = "6Lc3HAsUAAAAACsN7CgY9MMVxo2M09n_e4heJEiZ";
    params.pageurl =
      "https://signup.br.leagueoflegends.com/pt/signup/index#/registration";
  } else if (type === 2) {
    params.method = "funcaptcha";
    params.publickey = "E5554D43-23CC-1982-971D-6A2262A2CA24";
    params.surl = "https://client-api.arkoselabs.com";
    params.pageurl = "https://www.twitch.tv/signup";
  }

  const response = await axios({
    method: "post",
    url: "http://2captcha.com/in.php",
    params,
  });

  const responseId = response.data.replace("OK|", "");
  console.log(`Requesting answer for captcha ${responseId}`);

  return responseId;
}

async function pollForRequestResults(api, id) {
  while (true) {
    const response = await requestCaptchaResults(api, id);

    if (response.data) {
      if (response.data.length > 30) {
        return response.data;
      }

      switch (response.data) {
        case "ERROR_CAPTCHA_UNSOLVABLE":
          return response.data;

        case "ERROR_ZERO_BALANCE":
          return response.data;
      }
    }

    await timeout(5000);
  }
}

async function requestCaptchaResults(apiKey, requestId) {
  const response = await axios({
    method: "post",
    url: "http://2captcha.com/res.php",
    params: {
      key: apiKey,
      id: requestId,
      action: "get",
    },
  });

  return response;
}

async function createRiotAccount(data, captcha_answer) {
  console.log(`Creating RIOT account ${data.username}`);

  const payload = {
    ...data,
    confirm_password: data.password,
    date_of_birth: "2000-08-12",
    tou_agree: true,
    locale: "en",
    newsletter: false,
    campaign: "league_of_legends",
    token: `Captcha ${captcha_answer}`,
  };

  const response = await axios({
    method: "post",
    url: "https://signup-api.leagueoflegends.com/v1/accounts",
    data: payload,
  });

  return response;
}

async function createTwitchAccount(data, captcha_answer) {
  console.log(`Creating TWITCH account ${data.username}`);

  const payload = {
    ...data,
    birthday: {
      day: 12,
      month: 8,
      year: 2000,
    },
    client_id: "kimne78kx3ncx6brgo4mv6wki5h1ko",
    include_verification_code: true,
    arkose: {
      token: captcha_answer,
    },
  };

  const response = await axios({
    method: "post",
    url: "https://passport.twitch.tv/register",
    data: payload,
  });

  return response;
}

async function initiateLinkAccount(token, { username, password }) {
  let browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--window-size=600,600", "--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 600, height: 600 });
  const cookie = { ...twitchCookie, value: token };
  await page.setCookie(cookie);

  await page.goto("https://www.twitch.tv/settings/connections", {
    waitUntil: "networkidle0",
  });

  await page.waitForSelector(
    "div:nth-child(5) div.connection-component__header.tw-align-items-center.tw-flex.tw-flex-row > button"
  );

  const connectButton = await page.$(
    "div:nth-child(5) div.connection-component__header.tw-align-items-center.tw-flex.tw-flex-row > button"
  );

  await connectButton.click();

  await timeout(1000);

  const [popup] = await Promise.all([
    new Promise(async (resolve) => {
      page.once("popup", resolve);

      await page.waitForSelector("#password-input");
      const twitch_password_input = await page.$("#password-input");
      await twitch_password_input.type(password);

      await page.$eval(
        "div.ReactModalPortal form > div > div:nth-child(2) > button",
        (el) => el.click()
      );
    }),
  ]);

  await popup.waitForSelector('input[name="username"]');
  const username_input = await popup.$('input[name="username"]');
  const password_input = await popup.$('input[name="password"]');

  await username_input.type(username);
  await password_input.type(password);

  await timeout(500);
  await popup.waitForSelector(
    "div.grid.grid-direction__column.grid-page-web__wrapper > div > button"
  );

  await popup.$eval(
    "div.grid.grid-direction__column.grid-page-web__wrapper > div > button",
    (el) => el.click()
  );

  await timeout(1500);

  await popup.$eval("button", (el) => el.click());

  await page.waitForSelector(
    "svg.tw-svg__asset.tw-svg__asset--inherit.tw-svg__asset--notificationsuccess"
  );

  const success_svg = await page.$(
    "svg.tw-svg__asset.tw-svg__asset--inherit.tw-svg__asset--notificationsuccess"
  );

  if (success_svg) {
    console.log("Accounts linked");
    await browser.close();
    return true;
  }
}

async function confirmLastTwitchAccount() {
  var config = {
    imap: {
      user: "admin@valorantgamer.club",
      password: "vitor1208hariel",
      host: "mail.valorantgamer.club",
      port: 143,
      tls: false,
      authTimeout: 3000,
    },
  };

  imaps.connect(config).then((connection) => {
    return connection.openBox("INBOX").then(() => {
      let searchCriteria = ["UNSEEN", ["HEADER", "SUBJECT", "Twitch"]];
      let fetchOptions = {
        bodies: ["HEADER", "TEXT", ""],
      };
      return connection
        .search(searchCriteria, fetchOptions)
        .then((messages) => {
          messages.forEach((item) => {
            let all = _.find(item.parts, { which: "" });
            let id = item.attributes.uid;
            let idHeader = "Imap-Id: " + id + "\r\n";
            simpleParser(idHeader + all.body, async (err, mail) => {
              let verify_link = mail.text
                .match(
                  /(https?:\/\/(.+?\.)?twitch\.tv(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/gim
                )[1]
                .slice(0, -1);
              let browser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                args: [
                  "--window-size=350,600",
                  "--no-sandbox",
                  "--disable-setuid-sandbox",
                ],
              });

              const page = await browser.newPage();
              await page.setViewport({ width: 350, height: 600 });

              await page.goto(verify_link, {
                waitUntil: "networkidle0",
              });
            });
            connection.addFlags(item.attributes.uid, ["\\Seen"], (err) => {
              if (!err) {
                console.log("Account verified");
              } else {
                console.log(JSON.stringify(err, null, 2));
              }
            });
            return connection.end();
          });
        });
    });
  });
}

const timeout = (millis) =>
  new Promise((resolve) => setTimeout(resolve, millis));
