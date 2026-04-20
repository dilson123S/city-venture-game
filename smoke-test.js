const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { io } = require("socket.io-client");
const { TILES, CARD_LIBRARY } = require("./game-data");

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEMP_LEGACY_SAVE_PATH = path.join(__dirname, "session-store.legacy.test.json");
const LEGACY_SESSION_ID = "LGCY01";
const HOST_USERNAME = "admin";
const HOST_PASSWORD = "cityventure123";

async function main() {
  cleanTempFiles();
  writeLegacySessionFixture();

  const serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(PORT),
      SESSION_STORE_DRIVER: "memory",
      LEGACY_SAVE_PATH: TEMP_LEGACY_SAVE_PATH,
      NEGOTIATION_SECONDS: "4",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  serverProcess.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  serverProcess.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    await waitForHealth();
    await assertLegacyMigrationLoaded();
    await assertStaticSecurity();

    const host = createClient();
    const hostState = trackState(host);
    host.emit("host:login", { username: HOST_USERNAME, password: HOST_PASSWORD });
    await waitFor(() => hostState.current?.mode === "host" && hostState.current?.session?.id === LEGACY_SESSION_ID);
    host.emit("host:reset-session");
    await waitFor(() => hostState.current?.session === null);

    host.emit("host:create-session", { playerCount: 2 });
    await waitFor(() => hostState.current?.mode === "host" && hostState.current?.session?.status === "lobby");
    const originalSessionId = hostState.current.session.id;

    const failedLoginClient = createClient();
    const failedLoginState = trackState(failedLoginClient);
    failedLoginClient.emit("host:login", { username: HOST_USERNAME, password: "bad-password" });
    await waitFor(() =>
      String(failedLoginState.lastToast?.message || "").includes("invalidos"),
    );
    failedLoginClient.close();

    const intruder = createClient();
    const intruderState = trackState(intruder);
    await waitFor(() => intruderState.current?.session?.id === originalSessionId);
    intruder.emit("host:create-session", { playerCount: 6 });
    await waitFor(() =>
      String(intruderState.lastToast?.message || "").includes("iniciar sesion de host"),
    );
    await delay(200);
    if (hostState.current?.session?.id !== originalSessionId) {
      throw new Error("La sesion fue reemplazada por un socket no autorizado.");
    }
    intruder.close();

    const flooder = createClient();
    const flooderState = trackState(flooder);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      flooder.emit("player:join", { joinToken: "token-invalido" });
    }
    await waitFor(() =>
      String(flooderState.lastToast?.message || "").includes("Demasiadas solicitudes"),
    );
    flooder.close();

    const joinLinks = hostState.current.host.joinLinks;
    const joinTokenOne = new URL(joinLinks[0].url).searchParams.get("join");
    const joinTokenTwo = new URL(joinLinks[1].url).searchParams.get("join");

    const playerOne = createClient();
    const playerTwo = createClient();
    const playerOneState = trackState(playerOne);
    const playerTwoState = trackState(playerTwo);

    playerOne.emit("player:join", { joinToken: joinTokenOne });
    playerTwo.emit("player:join", { joinToken: joinTokenTwo });

    await waitFor(() => playerOneState.current?.mode === "player" && playerTwoState.current?.mode === "player");

    playerOne.emit("player:update-profile", { name: "Alpha Labs", tokenBadge: "AL" });
    playerTwo.emit("player:update-profile", { name: "Beta Freight", tokenBadge: "BF" });
    await waitFor(() => {
      const players = hostState.current?.session?.players || [];
      return players.some((player) => player.name === "Alpha Labs") && players.some((player) => player.name === "Beta Freight");
    });

    host.emit("host:start-game");
    await waitFor(() => playerOneState.current?.session?.turn?.phase === "await_roll");

    await playTurnUntilNegotiation(playerOne, playerOneState);

    playerOne.emit("contract:propose", {
      targetPlayerId: "player-2",
      type: "Acuerdo B2B",
      message: "Contrato que debe expirar por tiempo",
      offerCredits: 0,
      requestCredits: 0,
    });

    await waitFor(() => (playerTwoState.current?.self?.incomingContracts || []).length > 0);
    const expiredContractId = playerTwoState.current.self.incomingContracts[0].id;

    await waitFor(() => {
      const summary = hostState.current?.session?.contractsSummary || [];
      return summary.some((contract) => contract.id === expiredContractId && contract.status === "expired");
    });
    await waitFor(() => hostState.current?.session?.currentPlayerId === "player-2");

    playerTwo.emit("contract:respond", { contractId: expiredContractId, accept: true });
    await waitFor(() =>
      String(playerTwoState.lastToast?.message || "").includes("no esta disponible"),
    );

    await playTurnUntilNegotiation(playerTwo, playerTwoState);

    playerTwo.emit("contract:propose", {
      targetPlayerId: "player-1",
      type: "Acuerdo B2B",
      message: "Contrato vigente para validar aceptacion",
      offerCredits: 0,
      requestCredits: 0,
    });

    await waitFor(() => (playerOneState.current?.self?.incomingContracts || []).length > 0);
    const activeContractId = playerOneState.current.self.incomingContracts[0].id;
    playerOne.emit("contract:respond", { contractId: activeContractId, accept: true });

    await waitFor(() => {
      const playerA = playerOneState.current?.session?.players?.find((player) => player.id === "player-1");
      const playerB = playerTwoState.current?.session?.players?.find((player) => player.id === "player-2");
      return playerA?.connections >= 1 && playerB?.connections >= 1;
    });

    playerOne.close();
    playerTwo.close();
    host.close();

    console.log("Smoke test OK");
  } catch (error) {
    console.error("Smoke test failed");
    console.error(error);
    console.error(serverOutput);
    process.exitCode = 1;
  } finally {
    serverProcess.kill();
    cleanTempFiles();
  }
}

function createClient() {
  return io(BASE_URL, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 8000,
  });
}

function trackState(socket) {
  const bucket = { current: null };
  socket.on("state:update", (view) => {
    bucket.current = view;
  });
  socket.on("toast", (toast) => {
    bucket.lastToast = toast;
  });
  return bucket;
}

async function assertStaticSecurity() {
  const blocked = [
    "/index.html",
    "/script.js",
    "/styles.css",
    "/server.js",
    "/session-store.test.json",
    "/session-store.legacy.test.json",
    "/.data/session-store.test.json",
    "/package.json",
  ];
  for (const route of blocked) {
    const response = await fetch(`${BASE_URL}${route}`);
    if (response.status !== 404) {
      throw new Error(`Ruta sensible expuesta: ${route} (status ${response.status})`);
    }
  }
}

async function assertLegacyMigrationLoaded() {
  const response = await fetch(`${BASE_URL}/health`);
  const payload = await response.json();
  if (payload.sessionId !== LEGACY_SESSION_ID || payload.status !== "lobby") {
    throw new Error("No se cargo la sesion legado desde migration automatica.");
  }
  if (payload.store !== "memory") {
    throw new Error(`Store inesperado durante prueba: ${payload.store}`);
  }
}

function writeLegacySessionFixture() {
  const legacyRoom = {
    sessionId: LEGACY_SESSION_ID,
    createdAt: new Date().toISOString(),
    status: "lobby",
    playerCount: 2,
    players: [
      {
        id: "player-1",
        seatNumber: 1,
        joinToken: "legacy-join-1",
        name: "Legacy One",
        roleId: "energy",
        color: "#55efff",
        tokenBadge: "L1",
        tokenImage: "",
        avatarId: "city-architect",
        position: 0,
        credits: 500,
        connections: 0,
      },
      {
        id: "player-2",
        seatNumber: 2,
        joinToken: "legacy-join-2",
        name: "Legacy Two",
        roleId: "software",
        color: "#44f0c7",
        tokenBadge: "L2",
        tokenImage: "",
        avatarId: "deal-maker",
        position: 0,
        credits: 500,
        connections: 0,
      },
    ],
    currentPlayerIndex: 0,
    round: 1,
    turnCounter: 1,
    board: createLegacyBoardState(),
    deck: CARD_LIBRARY.map((card) => card.id),
    discard: [],
    contracts: [],
    log: ["Sesion legado lista para migrar."],
    activeEvent: null,
    turn: {
      phase: "lobby",
      message: "Sesion legado importada.",
      lastRoll: null,
      marketRoll: null,
      rentPreview: null,
      tileId: null,
      negotiationEndsAt: null,
      energyDiscountApplied: false,
      outsourcerId: null,
    },
    winnerId: null,
  };

  fs.writeFileSync(TEMP_LEGACY_SAVE_PATH, JSON.stringify(legacyRoom, null, 2), "utf8");
}

function createLegacyBoardState() {
  return Object.fromEntries(
    TILES.filter((tile) => tile.kind === "property").map((tile) => [
      tile.id,
      {
        owners: [],
        protectedTurns: 0,
        protectionCreatedOnTurn: 0,
        franchiseTurns: 0,
        franchiseCreatedOnTurn: 0,
        nextRentDoubleOwnerId: null,
      },
    ]),
  );
}

function cleanTempFiles() {
  for (const filePath of [TEMP_LEGACY_SAVE_PATH]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

async function playTurnUntilNegotiation(playerSocket, playerState) {
  await waitFor(() =>
    Boolean(playerState.current?.self?.isCurrentPlayer) &&
    Boolean(playerState.current?.session?.turn?.phase),
  );

  let phase = playerState.current.session.turn.phase;
  if (phase === "await_roll" || phase === "victory_ready") {
    playerSocket.emit("player:action", { action: "roll-die", payload: {} });
    await waitFor(() => {
      const nextPhase = playerState.current?.session?.turn?.phase;
      return nextPhase && nextPhase !== "await_roll" && nextPhase !== "victory_ready";
    });
    phase = playerState.current.session.turn.phase;
  }

  if (phase === "movement_adjust") {
    playerSocket.emit("player:action", { action: "adjust-route", payload: { delta: 0 } });
    await waitFor(() => playerState.current?.session?.turn?.phase !== "movement_adjust");
    phase = playerState.current.session.turn.phase;
  }

  if (phase === "property_offer") {
    playerSocket.emit("player:action", { action: "buy-property", payload: {} });
  } else if (phase === "market_roll") {
    if (!playerState.current.session.turn.marketRoll) {
      playerSocket.emit("player:action", { action: "roll-market", payload: {} });
      await waitFor(() => Boolean(playerState.current?.session?.turn?.rentPreview));
    }
    playerSocket.emit("player:action", { action: "pay-rent", payload: {} });
  }

  await waitFor(() => playerState.current?.session?.turn?.phase === "negotiation");
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // keep waiting
    }
    await delay(200);
  }
  throw new Error("Server did not start in time");
}

async function waitFor(predicate) {
  const started = Date.now();
  while (Date.now() - started < 12000) {
    if (predicate()) {
      return;
    }
    await delay(100);
  }
  throw new Error("Condition timeout");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
