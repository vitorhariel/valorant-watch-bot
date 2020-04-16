const variables = {
  baseURL: "https://twitch.tv/",
  profileURL: "https://www.twitch.tv/settings/profile",
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36",
  streamersUrl:
    "https://www.twitch.tv/directory/game/VALORANT?tl=c2542d6d-cd10-4532-919b-3d19f30a768b",
  cookie: {
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
  },
};

module.exports = {
  variables,
};
