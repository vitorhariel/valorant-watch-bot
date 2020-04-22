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

module.exports = {
  getRandomInt,
  twitchCookie,
};
