import { GameNetworkClient } from "./network/GameNetworkClient.js";
import { BabylonScene } from "./scene/BabylonScene.js";

const loginForm = document.getElementById("loginForm");
const connectButton = document.getElementById("connectBtn");
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
const loadingStatus = document.getElementById("loadingStatus");
const loadingDetail = document.getElementById("loadingDetail");
const loadingBarFill = document.getElementById("loadingBarFill");
const loadingPercent = document.getElementById("loadingPercent");
const controlsCard = document.getElementById("controlsCard");
const reconnectCard = document.getElementById("reconnectCard");
const reconnectStatus = document.getElementById("reconnectStatus");
const toggleCollidersButton = document.getElementById("toggleCollidersBtn");
const viewportMeta = document.querySelector('meta[name="viewport"]');

function installViewportLock() {
  if (viewportMeta) {
    viewportMeta.setAttribute(
      "content",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=overlays-content",
    );
  }

  const syncViewportHeight = () => {
    const nextHeight = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty("--app-height", `${Math.round(nextHeight)}px`);
  };

  let lastTouchEndAt = 0;
  document.addEventListener("gesturestart", (event) => {
    event.preventDefault();
  }, { passive: false });
  document.addEventListener("gesturechange", (event) => {
    event.preventDefault();
  }, { passive: false });
  document.addEventListener("gestureend", (event) => {
    event.preventDefault();
  }, { passive: false });
  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEndAt < 300) {
      event.preventDefault();
    }
    lastTouchEndAt = now;
  }, { passive: false });

  syncViewportHeight();
  window.addEventListener("resize", syncViewportHeight);
  window.addEventListener("orientationchange", syncViewportHeight);
  window.visualViewport?.addEventListener("resize", syncViewportHeight);
  window.visualViewport?.addEventListener("scroll", syncViewportHeight);
}

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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function updateLoadingProgress(progress) {
  if (!progress) {
    return;
  }

  const boundedPercent = Math.max(0, Math.min(100, progress.percent ?? 0));
  loadingBarFill.style.width = `${boundedPercent}%`;
  loadingPercent.textContent = `${Math.round(boundedPercent)}%`;
  loadingStatus.textContent = progress.statusText ?? "Preparing the world before the game becomes interactive.";

  if (progress.totalBytes > 0) {
    loadingDetail.textContent = `${progress.activeLabel} • ${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)}`;
  } else {
    loadingDetail.textContent = progress.activeLabel ?? "Downloading assets...";
  }
}

function setDebugOpen(open) {
  debugPanel.dataset.open = String(open);
  debugToggle.textContent = open ? "Close Debug" : "Debug";
  debugToggle.setAttribute("aria-expanded", String(open));
}

function syncColliderButton() {
  const visible = sceneApp?.areWorldCollidersVisible?.() ?? false;
  const count = sceneApp?.getWorldColliderCount?.() ?? 0;
  toggleCollidersButton.textContent = visible
    ? `Hide World Colliders (${count})`
    : `Show World Colliders (${count})`;
}

function logWorldColliderStats() {
  const stats = sceneApp?.getWorldColliderStats?.();
  if (!stats) {
    return;
  }

  log(`World collider stats: attempted=${stats.attempted}, created=${stats.created}, failed=${stats.failed}`);
  if (stats.failedMeshes.length) {
    log(`World collider failures: ${stats.failedMeshes.join(", ")}`);
  }
}

function logWorldImportStats() {
  const stats = sceneApp?.getWorldImportStats?.();
  if (!stats) {
    return;
  }

  log(`World import stats: rootNodes=${stats.rootNodeCount}, childMeshes=${stats.childMeshCount}, sceneMeshes=${stats.sceneMeshCount}`);
  if (stats.rootNodeTypes.length) {
    log(`World root nodes: ${stats.rootNodeTypes.map((type, index) => `${type}:${stats.rootNodeNames[index] ?? "unnamed"}`).join(", ")}`);
  }
  if (stats.meshNames.length) {
    log(`World mesh names: ${stats.meshNames.join(", ")}`);
  }
  if (stats.sceneMeshNames.length) {
    log(`Scene mesh names: ${stats.sceneMeshNames.join(", ")}`);
  }
}

function logWorldRuntimeBounds() {
  const bounds = sceneApp?.getWorldMeshRuntimeBounds?.() ?? [];
  bounds.forEach((entry) => {
    log(
      `World mesh runtime bounds: ${entry.name} center=(${entry.center.x}, ${entry.center.y}, ${entry.center.z}) `
      + `min=(${entry.min.x}, ${entry.min.y}, ${entry.min.z}) max=(${entry.max.x}, ${entry.max.y}, ${entry.max.z})`,
    );
  });
}

function setBootLoadingState() {
  setConnectionState({ state: "loading" });
}

const sceneApp = new BabylonScene({
  canvas,
  onMovementChange: ({ heading, movementMode, jumping, velocity, position }) => {
    network.sendAction({
      type: "move",
      heading,
      movementMode,
      jumping,
      velocity,
      position,
    });
  },
  onLoadProgress: updateLoadingProgress,
});

window.__sceneApp = sceneApp;

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
installViewportLock();
updateLoadingProgress({
  percent: 0,
  activeLabel: "Starting downloads...",
  statusText: "Preparing the world before the game becomes interactive.",
  loadedBytes: 0,
  totalBytes: 0,
});

try {
  await sceneApp.init();
  updateLoadingProgress({
    percent: 100,
    activeLabel: "World ready",
    statusText: "Assets loaded. Finalizing the world.",
    loadedBytes: 0,
    totalBytes: 0,
  });
} catch (error) {
  log(`Scene initialization error: ${error}`);
  modalTitle.textContent = "World Load Failed";
  modalCopy.textContent = "The environment could not be prepared. Refresh and try again.";
  throw error;
}

const resumedSession = await network.reconnectFromStoredSession();
if (!resumedSession) {
  setConnectionState({ state: "disconnected" });
}

setDebugOpen(false);
syncColliderButton();
logWorldImportStats();
logWorldColliderStats();
logWorldRuntimeBounds();

debugToggle.addEventListener("click", () => {
  const open = debugPanel.dataset.open === "true";
  setDebugOpen(!open);
});

logoutButton.addEventListener("click", () => {
  network.leave();
});

toggleCollidersButton.addEventListener("click", () => {
  const nextVisible = !(sceneApp.areWorldCollidersVisible?.() ?? false);
  sceneApp.setWorldColliderDebugVisible(nextVisible);
  syncColliderButton();
  log(`${nextVisible ? "Showing" : "Hiding"} ${sceneApp.getWorldColliderCount?.() ?? 0} world collider mesh(es)`);
  logWorldColliderStats();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = usernameInput.value.trim() || `Player_${Math.random().toString(36).slice(2, 7)}`;
  try {
    await network.connect(username);
  } catch (error) {
    log(`Connection error: ${error}`);
    setConnectionState({ state: "disconnected", reason: "connect_failed" });
  }
});
