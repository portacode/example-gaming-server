import { GameNetworkClient } from "./network/GameNetworkClient.js";
import { BabylonScene } from "./scene/BabylonScene.js";

const connectButton = document.getElementById("connectBtn");
const pingButton = document.getElementById("pingBtn");
const usernameInput = document.getElementById("usernameInput");
const roomStatus = document.getElementById("roomStatus");
const playerStatus = document.getElementById("playerStatus");
const logPanel = document.getElementById("log");
const canvas = document.getElementById("renderCanvas");
const loginModal = document.getElementById("loginModal");
const debugPanel = document.getElementById("debugPanel");
const debugToggle = document.getElementById("debugToggle");
const logoutButton = document.getElementById("logoutBtn");
const modalTitle = document.getElementById("modalTitle");
const modalCopy = document.getElementById("modalCopy");
const loginFormCard = document.getElementById("loginFormCard");
const loadingCard = document.getElementById("loadingCard");
const controlsCard = document.getElementById("controlsCard");
const reconnectCard = document.getElementById("reconnectCard");
const reconnectStatus = document.getElementById("reconnectStatus");

function log(message) {
  const line = document.createElement("div");
  line.textContent = message;
  logPanel.prepend(line);
}

function setConnectionState(status) {
  const state = typeof status === "string" ? status : status.state;
  const connected = state === "connected";
  const reconnecting = state === "reconnecting";
  const connecting = state === "connecting";
  const loading = state === "loading";
  const showModal = state !== "connected";

  connectButton.disabled = connecting || reconnecting || loading;
  pingButton.disabled = !connected;
  loginModal.dataset.visible = String(showModal);
  loginModal.dataset.mode = state;
  logoutButton.hidden = !connected;
  debugToggle.hidden = !connected;
  loadingCard.hidden = !loading;
  loginFormCard.hidden = reconnecting || loading;
  controlsCard.hidden = reconnecting || loading;
  reconnectCard.hidden = !reconnecting;

  if (loading) {
    modalTitle.textContent = "Loading World";
    modalCopy.textContent = "Preparing the environment and background assets before you enter the match.";
  } else if (state === "connecting") {
    modalTitle.textContent = "Joining Match";
    modalCopy.textContent = "Connecting to the server and reserving your seat.";
  } else if (state === "reconnecting") {
    modalTitle.textContent = "Reconnecting";
    modalCopy.textContent = "Your session is still reserved. Please wait while we reconnect you to the match.";
    reconnectStatus.textContent = `Reconnect attempt ${status.attempt}/${status.maxAttempts}...`;
  } else {
    modalTitle.textContent = "Enter The World";
    modalCopy.textContent = status.reason === "token_expired"
      ? "Your previous match could not be recovered because the reconnect token expired. You can safely join a new game now."
      : "Connect to a Colyseus room, render the scene in Babylon.js, and keep the debug tools tucked away until you need them.";
  }

  if (!connected) {
    setDebugOpen(false);
  }
}

function setDebugOpen(open) {
  debugPanel.dataset.open = String(open);
  debugToggle.textContent = open ? "Close Debug" : "Debug";
  debugToggle.setAttribute("aria-expanded", String(open));
}

function setBootLoadingState() {
  setConnectionState({ state: "loading" });
}

const sceneApp = new BabylonScene({
  canvas,
  onHeadingChange: (heading) => {
    network.sendAction({ type: "steer", heading });
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
  onConnectionChange: setConnectionState,
});

setBootLoadingState();

try {
  await sceneApp.init();
} catch (error) {
  log(`Scene initialization error: ${error}`);
  modalTitle.textContent = "World Load Failed";
  modalCopy.textContent = "The environment could not be prepared. Refresh and try again.";
  throw error;
}

setConnectionState({ state: "disconnected" });
setDebugOpen(false);

debugToggle.addEventListener("click", () => {
  const open = debugPanel.dataset.open === "true";
  setDebugOpen(!open);
});

logoutButton.addEventListener("click", () => {
  network.leave();
});

connectButton.addEventListener("click", async () => {
  const username = usernameInput.value.trim() || `Player_${Math.random().toString(36).slice(2, 7)}`;
  try {
    await network.connect(username);
  } catch (error) {
    log(`Connection error: ${error}`);
    setConnectionState({ state: "disconnected", reason: "connect_failed" });
  }
});

pingButton.addEventListener("click", () => {
  network.sendAction({ type: "ping" });
  log("Sent action: ping");
});
