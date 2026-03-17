const SKY_PRESETS = {
  "qwantani-afternoon": { // Very plain blue sky with bright sun
    label: "Qwantani",
    file: "/assets/world/sky/optimized/qwantani-afternoon.jpg",
  },
  "overcast-soil": { // Looks like the sky when its about to rain
    label: "Overcast",
    file: "/assets/world/sky/optimized/overcast-soil.jpg",
  },
  "rocky-ridge": { // Blue sky with little clouds and a yello sun rising on the horizon
    label: "Rocky Ridge",
    file: "/assets/world/sky/optimized/rocky-ridge.jpg",
  },
};

export const WORLD_SKY_PRESET = "overcast-soil";
const CAMERA_BETA_MIN = 0.62;
const CAMERA_BETA_MAX = 1.85;
const CAMERA_TRANSITION_BETA = 1.02;
const CAMERA_RADIUS_NEAR = 2.4;
const CAMERA_RADIUS_FAR = 8.5;
const CAMERA_TARGET_Y_NEAR = 1.48;
const CAMERA_TARGET_Y_FAR = 0.92;

export class BabylonScene {
  constructor({ canvas, onHeadingChange }) {
    this.canvas = canvas;
    this.onHeadingChange = onHeadingChange;
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.playerMeshes = new Map();
    this.selfPosition = null;
    this.selfSessionId = null;
    this.lastHeading = null;
    this.lastHeadingSentAt = 0;
    this.skyDome = null;
    this.cameraFocus = null;
  }

  async init() {
    this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.93, 0.97, 1, 1);

    await this.enablePhysics();
    await this.createEnvironment();

    this.engine.runRenderLoop(() => {
      this.updateCameraFraming();
      this.syncHeadingIntent();
      this.scene.render();
    });

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  applyView(view) {
    if (!this.scene) {
      return;
    }

    const visibleIds = new Set(view.visiblePlayers.map((player) => player.sessionId));

    for (const [sessionId, mesh] of this.playerMeshes.entries()) {
      if (!visibleIds.has(sessionId)) {
        mesh.dispose(false, true);
        this.playerMeshes.delete(sessionId);
      }
    }

    view.visiblePlayers.forEach((player) => {
      let mesh = this.playerMeshes.get(player.sessionId);
      if (!mesh) {
        mesh = this.createPlayerMesh(player.sessionId === view.self?.sessionId);
        this.playerMeshes.set(player.sessionId, mesh);
      }

      mesh.position.set(player.position.x, player.position.y, player.position.z);
    });

    if (view.self && this.camera) {
      this.selfSessionId = view.self.sessionId;
      this.selfPosition = {
        x: view.self.position.x,
        y: view.self.position.y,
        z: view.self.position.z,
      };
      this.updateCameraFraming();
    } else {
      this.selfSessionId = null;
      this.selfPosition = null;
      this.lastHeading = null;
    }
  }

  async enablePhysics() {
    const havok = await HavokPhysics();
    const plugin = new BABYLON.HavokPlugin(true, havok);
    this.scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), plugin);
  }

  async createEnvironment() {
    this.camera = new BABYLON.ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      1.18,
      CAMERA_RADIUS_FAR,
      new BABYLON.Vector3(0, 0, 0),
      this.scene,
    );
    this.camera.attachControl(this.canvas, true);
    this.cameraFocus = new BABYLON.TransformNode("camera-focus", this.scene);
    this.camera.lockedTarget = this.cameraFocus;
    this.camera.lowerBetaLimit = CAMERA_BETA_MIN;
    this.camera.upperBetaLimit = CAMERA_BETA_MAX;
    this.camera.lowerRadiusLimit = CAMERA_RADIUS_NEAR;
    this.camera.upperRadiusLimit = 16;
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.panningSensibility = 0;
    this.camera.inertia = 0.85;
    this.camera.radius = CAMERA_RADIUS_FAR;

    await this.preloadSkyPreset(WORLD_SKY_PRESET);
    this.applySkyPreset(WORLD_SKY_PRESET);

    const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.88;

    const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.55, -1, -0.25), this.scene);
    sun.position = new BABYLON.Vector3(12, 20, 8);
    sun.intensity = 1.35;

    const shadowGenerator = new BABYLON.ShadowGenerator(1024, sun);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 24;

    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 36, height: 36 }, this.scene);
    ground.receiveShadows = true;
    const groundMaterial = new BABYLON.StandardMaterial("ground-material", this.scene);
    groundMaterial.diffuseColor = new BABYLON.Color3(0.73, 0.79, 0.69);
    groundMaterial.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
    ground.material = groundMaterial;
    new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, { mass: 0, restitution: 0.1 }, this.scene);

    const groundDetail = BABYLON.MeshBuilder.CreateGround("ground-detail", { width: 35.4, height: 35.4 }, this.scene);
    groundDetail.position.y = 0.02;
    groundDetail.receiveShadows = true;
    const groundDetailMaterial = new BABYLON.StandardMaterial("ground-detail-material", this.scene);
    groundDetailMaterial.diffuseColor = new BABYLON.Color3(0.47, 0.58, 0.39);
    groundDetailMaterial.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
    groundDetailMaterial.alpha = 0.24;
    groundDetail.material = groundDetailMaterial;

    const platform = BABYLON.MeshBuilder.CreateBox("platform", { width: 8, height: 1, depth: 8 }, this.scene);
    platform.position.y = 0.5;
    platform.position.x = -10;
    platform.position.z = -10;
    platform.receiveShadows = true;
    const platformMaterial = new BABYLON.StandardMaterial("platform-material", this.scene);
    platformMaterial.diffuseColor = new BABYLON.Color3(0.87, 0.7, 0.52);
    platform.material = platformMaterial;
    new BABYLON.PhysicsAggregate(platform, BABYLON.PhysicsShapeType.BOX, { mass: 0 }, this.scene);

    for (let i = 0; i < 6; i += 1) {
      const crate = BABYLON.MeshBuilder.CreateBox(`crate-${i}`, { size: 1.4 }, this.scene);
      crate.position = new BABYLON.Vector3(-10 + (i % 2) * 1.6, 2 + i * 1.2, -10 + Math.floor(i / 2) * 1.6);
      crate.receiveShadows = true;
      shadowGenerator.addShadowCaster(crate);
      const material = new BABYLON.StandardMaterial(`crate-material-${i}`, this.scene);
      material.diffuseColor = new BABYLON.Color3(0.65, 0.42, 0.25);
      crate.material = material;
      new BABYLON.PhysicsAggregate(crate, BABYLON.PhysicsShapeType.BOX, { mass: 1, restitution: 0.2 }, this.scene);
    }
  }

  updateCameraFraming() {
    if (!this.camera || !this.cameraFocus) {
      return;
    }

    const trackedPosition = this.getTrackedPlayerPosition();
    if (!trackedPosition) {
      return;
    }

    const transitionFactor = BABYLON.Scalar.Clamp(
      (this.camera.beta - CAMERA_TRANSITION_BETA) / (CAMERA_BETA_MAX - CAMERA_TRANSITION_BETA),
      0,
      1,
    );
    const easedTransition = transitionFactor * transitionFactor * (3 - 2 * transitionFactor);
    const targetY = BABYLON.Scalar.Lerp(CAMERA_TARGET_Y_FAR, CAMERA_TARGET_Y_NEAR, easedTransition);
    const desiredRadius = BABYLON.Scalar.Lerp(CAMERA_RADIUS_FAR, CAMERA_RADIUS_NEAR, easedTransition);

    this.camera.radius = desiredRadius;
    this.cameraFocus.position.set(
      trackedPosition.x,
      trackedPosition.y + targetY,
      trackedPosition.z,
    );
  }

  getTrackedPlayerPosition() {
    if (this.selfSessionId) {
      const selfMesh = this.playerMeshes.get(this.selfSessionId);
      if (selfMesh) {
        return selfMesh.position;
      }
    }

    return this.selfPosition;
  }

  async preloadSkyPreset(skyKey) {
    const preset = SKY_PRESETS[skyKey] ?? SKY_PRESETS[WORLD_SKY_PRESET];

    await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Failed to preload sky asset: ${preset.file}`));
      image.src = preset.file;
    });
  }

  applySkyPreset(skyKey) {
    const preset = SKY_PRESETS[skyKey] ?? SKY_PRESETS[WORLD_SKY_PRESET];

    if (this.skyDome) {
      this.skyDome.dispose();
    }

    this.skyDome = new BABYLON.PhotoDome(
      "sky-dome",
      preset.file,
      {
        resolution: 32,
        size: 1200,
      },
      this.scene,
    );

    this.scene.clearColor = new BABYLON.Color4(0.72, 0.81, 0.92, 1);
  }

  createPlayerMesh(isSelf) {
    const mesh = BABYLON.MeshBuilder.CreateCapsule(`player-${this.playerMeshes.size}`, { radius: 0.65, height: 2.2 }, this.scene);
    const material = new BABYLON.StandardMaterial(`player-material-${this.playerMeshes.size}`, this.scene);
    material.diffuseColor = isSelf ? new BABYLON.Color3(0.19, 0.53, 0.95) : new BABYLON.Color3(0.91, 0.37, 0.2);
    material.emissiveColor = isSelf ? new BABYLON.Color3(0.03, 0.08, 0.18) : new BABYLON.Color3(0.15, 0.06, 0.02);
    mesh.material = material;
    mesh.receiveShadows = true;
    return mesh;
  }

  syncHeadingIntent() {
    if (!this.selfPosition || !this.camera) {
      return;
    }

    const cameraPosition = this.camera.position;
    const heading = Math.atan2(
      this.selfPosition.z - cameraPosition.z,
      this.selfPosition.x - cameraPosition.x,
    );
    const now = performance.now();

    if (this.lastHeading !== null) {
      const delta = Math.atan2(Math.sin(heading - this.lastHeading), Math.cos(heading - this.lastHeading));
      if (Math.abs(delta) < 0.04 && now - this.lastHeadingSentAt < 250) {
        return;
      }
    }

    this.lastHeading = heading;
    this.lastHeadingSentAt = now;
    this.onHeadingChange?.(heading);
  }
}
