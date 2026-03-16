import { GameNetworkClient } from "./network/GameNetworkClient.js";
import { BabylonScene } from "./scene/BabylonScene.js";

const connectButton = document.getElementById("connectBtn");
const pingButton = document.getElementById("pingBtn");
const usernameInput = document.getElementById("usernameInput");
const roomStatus = document.getElementById("roomStatus");
const playerStatus = document.getElementById("playerStatus");
const logPanel = document.getElementById("log");
const canvas = document.getElementById("renderCanvas");

function log(message) {
  const line = document.createElement("div");
  line.textContent = message;
  logPanel.prepend(line);
}

function setConnected(connected) {
  connectButton.disabled = connected;
  pingButton.disabled = !connected;
}

const sceneApp = new BabylonScene({
  canvas,
  onMove: ({ x, z }) => {
    network.sendAction({ type: "move", x, z });
  },
});

const network = new GameNetworkClient({
  onRoomState: (state) => {
    roomStatus.textContent = `Room ${state.roomId} | ${state.phase} | ${state.connectedPlayers}/${state.maxPlayers} connected`;
  },
  onPlayerView: (view) => {
    playerStatus.textContent = view.self
      ? `${view.self.username} at (${view.self.position.x.toFixed(1)}, ${view.self.position.z.toFixed(1)}) sees ${view.visiblePlayers.length} player(s)`
      : "No player view";
    sceneApp.applyView(view);
  },
  onLog: log,
  onConnectionChange: setConnected,
});

await sceneApp.init();
setConnected(false);

connectButton.addEventListener("click", async () => {
  const username = usernameInput.value.trim() || `Player_${Math.random().toString(36).slice(2, 7)}`;
  try {
    await network.connect(username);
  } catch (error) {
    log(`Connection error: ${error}`);
    setConnected(false);
  }
});

pingButton.addEventListener("click", () => {
  network.sendAction({ type: "ping" });
  log("Sent action: ping");
});
