const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const RecaptchaPlugin = require("puppeteer-extra-plugin-recaptcha-2");

const { variables } = require("./config/variables");

puppeteer.use(StealthPlugin());
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: "2captcha",
      token: "afa5e6f00afb0ede17af5979c863335e",
    },
    visualFeedback: true,
    throwOnError: true,
  })
);

const email = "05@valorantgamer.club";
const username = "saneValorant05";
const password = "Supremo0@";

(async () => {
  let browser = await puppeteer.launch({
    headless: false,
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

  console.log("Carregando página da riot...");
  await page.goto("https://signup.br.leagueoflegends.com/pt/signup/", {
    waitUntil: "networkidle0",
  });

  console.log("Inserindo dados...");
  await page.$eval('input[name="email"]', (el) => el.focus());
  await page.keyboard.sendCharacter(email);

  setTimeout(async () => {
    await page.mouse.click(600, 670);
  }, 1500);

  await page.waitForSelector('select[name="dob-day"]');

  await page.select('select[name="dob-day"]', "12");
  await page.select('select[name="dob-month"]', "8");
  await page.select('select[name="dob-year"]', "2000");

  setTimeout(async () => {
    await page.mouse.click(600, 530);
  }, 1500);

  await page.waitForSelector('input[name="username"]');

  await page.$eval('input[name="username"]', (el) => el.focus());
  await page.keyboard.press("Backspace");
  await page.keyboard.type(username);

  await page.$eval('input[name="password"]', (el) => el.focus());
  await page.keyboard.press("Backspace");
  await page.keyboard.type(password);

  await page.$eval('input[name="confirm_password"]', (el) => el.focus());
  await page.keyboard.press("Backspace");
  await page.keyboard.type(password);

  await page.$eval(".checkbox-indicator", (el) => el.click());

  setTimeout(async () => {
    await page.$eval("button", (el) => el.click());
  }, 2000);

  try {
    setTimeout(async () => {
      console.log("Resolvendo captcha...");
      let { captchas } = await page.findRecaptchas();
      let { solutions, error } = await page.getRecaptchaSolutions(captchas);

      await page.screenshot({ path: "erro1.png" });

      const answer = solutions[0].text;

      await page.$eval(
        "#g-recaptcha-response",
        (el, value) => (el.innerText = value),
        answer
      );

      await page.mouse.click(175, 590);

      setTimeout(async () => {
        console.log("Finalizando registro...");
        await page.$eval("button", (el) => el.click());
      }, 2000);

      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0" }),
      ]);

      if (await page.$(".download-button")) {
        console.log("Registrado com sucesso!");
      } else {
        console.log("Ocorreu um erro...");
        await page.screenshot("error.png");
      }
    }, 3000);
  } catch (error) {
    console.log(error);
  }
})();
