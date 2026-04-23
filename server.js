const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const Redis = require("ioredis");
const { Server } = require("socket.io");
const {
  BOARD_POINTS,
  TILES,
  SECTORS,
  ROLE_ORDER,
  ROLES,
  CARD_LIBRARY,
  GLOBAL_EVENTS,
  MARKET_INDEX_TABLE,
  VP_TABLE,
  B2B_OFFER_TYPES,
  TOKEN_COLORS,
  TOKEN_BADGES,
  CEO_AVATARS,
} = require("./game-data");

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 4173);
const FRONTEND_URL = normalizeBaseUrl(process.env.FRONTEND_URL || "");
const PUBLIC_BACKEND_URL = normalizeBaseUrl(process.env.PUBLIC_BACKEND_URL || "");
const SESSION_STORE_DRIVER = String(
  process.env.SESSION_STORE_DRIVER || (process.env.REDIS_URL ? "redis" : "memory"),
)
  .trim()
  .toLowerCase();
const REDIS_URL = String(process.env.REDIS_URL || "").trim();
const REDIS_SESSION_KEY = String(process.env.REDIS_SESSION_KEY || "city-venture:session:v1").trim();
const LEGACY_SAVE_PATHS = [
  process.env.LEGACY_SAVE_PATH
    ? path.resolve(process.env.LEGACY_SAVE_PATH)
    : path.join(__dirname, "session-store.json"),
  path.join(__dirname, ".data", "session-store.json"),
];
const NEGOTIATION_SECONDS = clamp(Number(process.env.NEGOTIATION_SECONDS) || 45, 1, 300);
const MAX_LOG_ITEMS = 80;
const MAX_TOKEN_IMAGE_CHARS = 420000;
const HOST_LOGIN_USERNAME = String(process.env.HOST_LOGIN_USERNAME || "admin").trim();
const HOST_LOGIN_PASSWORD = String(process.env.HOST_LOGIN_PASSWORD || "cityventure123");
const EVENT_RATE_LIMITS = Object.freeze({
  "host:login": { limit: 8, windowMs: 30000 },
  "host:logout": { limit: 8, windowMs: 30000 },
  "host:create-session": { limit: 3, windowMs: 30000 },
  "host:reset-session": { limit: 3, windowMs: 30000 },
  "host:start-game": { limit: 6, windowMs: 30000 },
  "host:update-seat-role": { limit: 24, windowMs: 30000 },
  "player:join": { limit: 8, windowMs: 30000 },
  "player:update-profile": { limit: 24, windowMs: 30000 },
  "player:action": { limit: 80, windowMs: 30000 },
  "contract:propose": { limit: 12, windowMs: 30000 },
  "contract:respond": { limit: 12, windowMs: 30000 },
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

let room = null;
const socketAuth = new Map();
const socketRateBuckets = new Map();
let redisClient = null;
let memoryRoomRaw = null;
let persistQueue = Promise.resolve();

// Serve frontend static files
app.use("/frontend", express.static(path.join(__dirname, "frontend")));

app.get("/", (_req, res) => {
  res.redirect("/frontend/");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    store: SESSION_STORE_DRIVER,
    sessionId: room?.sessionId || null,
    status: room?.status || "empty",
  });
});

bootstrap().catch((error) => {
  console.error("No se pudo iniciar el backend", error);
  process.exit(1);
});

async function bootstrap() {
  await initializeSessionStore();
  await migrateLegacySaveIfNeeded();
  room = await loadRoom();

  server.listen(PORT, () => {
    const urls = getBaseUrls(PORT);
    const frontendUrls = getFrontendBaseUrls();
    console.log(`City Venture backend running (store: ${SESSION_STORE_DRIVER})`);
    urls.forEach((url) => console.log(`- backend ${url}`));
    frontendUrls.forEach((url) => console.log(`- frontend ${url}`));
  });

  setInterval(() => {
    try {
      closeNegotiationByTimer();
    } catch (error) {
      console.error("No se pudo cerrar la ventana B2B por temporizador", error);
    }
  }, 1000);
}

function usingRedisStore() {
  return SESSION_STORE_DRIVER === "redis";
}

async function initializeSessionStore() {
  if (!usingRedisStore()) {
    if (SESSION_STORE_DRIVER !== "memory") {
      throw new Error(`SESSION_STORE_DRIVER invalido: ${SESSION_STORE_DRIVER}. Usa \"redis\" o \"memory\".`);
    }
    return;
  }
  if (!REDIS_URL) {
    throw new Error("Falta REDIS_URL para usar SESSION_STORE_DRIVER=redis.");
  }

  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  await redisClient.ping();
}

async function readRoomRawFromStore() {
  if (usingRedisStore()) {
    return redisClient.get(REDIS_SESSION_KEY);
  }
  return memoryRoomRaw;
}

async function writeRoomRawToStore(raw) {
  if (usingRedisStore()) {
    await redisClient.set(REDIS_SESSION_KEY, raw);
    return;
  }
  memoryRoomRaw = raw;
}

async function deleteRoomFromStore() {
  if (usingRedisStore()) {
    await redisClient.del(REDIS_SESSION_KEY);
    return;
  }
  memoryRoomRaw = null;
}

async function migrateLegacySaveIfNeeded() {
  const existing = await readRoomRawFromStore();
  if (existing) {
    return;
  }

  const legacyPath = LEGACY_SAVE_PATHS.find((candidate, index, array) => {
    if (!candidate) {
      return false;
    }
    return fs.existsSync(candidate) && array.indexOf(candidate) === index;
  });

  if (!legacyPath) {
    return;
  }

  try {
    const legacyRaw = fs.readFileSync(legacyPath, "utf8");
    const parsed = JSON.parse(legacyRaw);
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    await writeRoomRawToStore(JSON.stringify(parsed));
    console.log(`Sesion antigua importada automaticamente: ${legacyPath} -> ${SESSION_STORE_DRIVER}`);
  } catch (error) {
    console.error(`No se pudo migrar la sesion antigua desde ${legacyPath}`, error);
  }
}

async function loadRoom() {
  const raw = await readRoomRawFromStore();
  if (!raw) {
    return null;
  }

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    parsed.players = parsed.players || [];
    parsed.log = parsed.log || [];
    parsed.contracts = parsed.contracts || [];
    parsed.board = parsed.board || createBoardState();
    parsed.deck = parsed.deck || shuffle([...CARD_LIBRARY.map((card) => card.id)]);
    parsed.discard = parsed.discard || [];
    parsed.turn = parsed.turn || { phase: "idle", message: "Sin partida activa." };
    parsed.activeEvent = parsed.activeEvent || null;
    parsed.round = parsed.round || 1;
    parsed.turnCounter = parsed.turnCounter || 1;
    parsed.currentPlayerIndex = parsed.currentPlayerIndex || 0;
    parsed.status = parsed.status || "lobby";
    // New fields
    parsed.sectorDomains = parsed.sectorDomains || {};
    parsed.marketIndex = parsed.marketIndex || { id: "stable", name: "Estable", multiplier: 1.0, roll: null };
    parsed.acceptedContractsCount = parsed.acceptedContractsCount || {};
    parsed.sectorPatents = parsed.sectorPatents || {};
    parsed.opaHostilUsed = parsed.opaHostilUsed || {};
    delete parsed.hostSecret;
    delete parsed.hostClaimCode;

    parsed.players = parsed.players.map((player, index) => ({
      ...buildSeat(index, player.roleId || ROLE_ORDER[index]),
      ...player,
      socketIds: [],
      joinedAt: player.joinedAt || null,
      lastSeenAt: player.lastSeenAt || null,
      hand: player.hand || [],
      exclusiveTargets: player.exclusiveTargets || [],
      softwarePassiveReady: player.softwarePassiveReady !== false,
      softwareCancelsLeft: Number.isInteger(player.softwareCancelsLeft) ? player.softwareCancelsLeft : 2,
      tokenImage: player.tokenImage || "",
      tokenBadge: player.tokenBadge || TOKEN_BADGES[index % TOKEN_BADGES.length],
      avatarId: player.avatarId || CEO_AVATARS[index % CEO_AVATARS.length].id,
      // Rivalry
      rivalId: player.rivalId || null,
      rivalRevealed: player.rivalRevealed || false,
      rivalDefeated: player.rivalDefeated || false,
      // Bankruptcy buffer
      loans: player.loans || [],
      collaterals: player.collaterals || [],
      // Headhunting
      copiedPassiveRoleId: player.copiedPassiveRoleId || null,
      copiedPassiveTurn: player.copiedPassiveTurn || 0,
      // Startup boom
      startupBoomTileId: player.startupBoomTileId || null,
      startupBoomUntilRound: player.startupBoomUntilRound || 0,
      // Term contracts
      termContracts: player.termContracts || [],
    }));

    return parsed;
  } catch (error) {
    console.error("No se pudo cargar la sesion desde el store", error);
    return null;
  }
}

function persistRoom() {
  const snapshot = room
    ? JSON.stringify({
        ...room,
        players: room.players.map(({ socketIds, ...player }) => ({
          ...player,
          connected: socketIds.length > 0,
        })),
      })
    : null;

  persistQueue = persistQueue
    .then(async () => {
      if (snapshot === null) {
        await deleteRoomFromStore();
        return;
      }
      await writeRoomRawToStore(snapshot);
    })
    .catch((error) => {
      console.error("No se pudo persistir la sesion", error);
    });
}

function createSession(playerCount) {
  const totalPlayers = clamp(Number(playerCount) || 2, 2, 6);
  const players = Array.from({ length: totalPlayers }, (_, index) =>
    buildSeat(index, ROLE_ORDER[index % ROLE_ORDER.length]),
  );

  room = {
    sessionId: randomCode(6),
    createdAt: new Date().toISOString(),
    status: "lobby",
    playerCount: totalPlayers,
    players,
    currentPlayerIndex: 0,
    round: 1,
    turnCounter: 1,
    board: createBoardState(),
    deck: shuffle([...CARD_LIBRARY.map((card) => card.id)]),
    discard: [],
    contracts: [],
    log: [],
    activeEvent: null,
    turn: {
      phase: "lobby",
      message: "Comparte los enlaces y espera a los CEOs.",
      lastRoll: null,
      marketRoll: null,
      rentPreview: null,
      tileId: null,
      negotiationEndsAt: null,
      energyDiscountApplied: false,
      outsourcerId: null,
    },
    winnerId: null,
    // New systems
    sectorDomains: {},
    marketIndex: { id: "stable", name: "Estable", multiplier: 1.0, roll: null },
    acceptedContractsCount: {},
    sectorPatents: {},
    opaHostilUsed: {},
  };

  addLog("Sesion creada. Lobby listo para invitar jugadores.");
  persistRoom();
  return room;
}

function buildSeat(index, roleId) {
  return {
    id: `player-${index + 1}`,
    seatNumber: index + 1,
    joinToken: randomToken(10),
    name: `CEO ${index + 1}`,
    roleId,
    color: TOKEN_COLORS[index % TOKEN_COLORS.length],
    tokenBadge: TOKEN_BADGES[index % TOKEN_BADGES.length],
    tokenImage: "",
    avatarId: CEO_AVATARS[index % CEO_AVATARS.length].id,
    joinedAt: null,
    lastSeenAt: null,
    socketIds: [],
    position: 0,
    credits: 500,
    connections: roleId === "relations" ? 2 : 0,
    skipTurns: 0,
    hand: [],
    softwarePassiveReady: true,
    softwareCancelsLeft: 2,
    strategicDiceUsed: false,
    industrialRemoteBuyUsed: false,
    energyRentDiscountReady: roleId === "energy",
    logisticsAdjustReady: roleId === "logistics",
    creativeExtendReady: roleId === "creative",
    financialDoubleReady: roleId === "financial",
    financialDoubleArmed: false,
    networkingExtraReady: roleId === "relations",
    networkingExtraArmed: false,
    nextDebtPayerId: null,
    halfNextRent: false,
    exclusiveTargets: [],
    connectionRentSkipRound: 0,
    connectionIncomeBoostRound: 0,
    // Rivalry
    rivalId: null,
    rivalRevealed: false,
    rivalDefeated: false,
    // Bankruptcy buffer
    loans: [],
    collaterals: [],
    // Headhunting
    copiedPassiveRoleId: null,
    copiedPassiveTurn: 0,
    // Startup boom
    startupBoomTileId: null,
    startupBoomUntilRound: 0,
    // Term contracts
    termContracts: [],
  };
}

function createBoardState() {
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

function resetGameplayState() {
  if (!room) {
    return;
  }
  room.status = "playing";
  room.currentPlayerIndex = 0;
  room.round = 1;
  room.turnCounter = 1;
  room.board = createBoardState();
  room.deck = shuffle([...CARD_LIBRARY.map((card) => card.id)]);
  room.discard = [];
  room.contracts = [];
  room.log = [];
  room.activeEvent = null;
  room.winnerId = null;
  room.sectorDomains = {};
  room.marketIndex = { id: "stable", name: "Estable", multiplier: 1.0, roll: null };
  room.acceptedContractsCount = {};
  room.sectorPatents = {};
  room.opaHostilUsed = {};

  room.players.forEach((player, index) => {
    const roleId = player.roleId || ROLE_ORDER[index % ROLE_ORDER.length];
    Object.assign(player, {
      position: 0,
      credits: 500,
      connections: roleId === "relations" ? 2 : 0,
      skipTurns: 0,
      hand: [],
      softwarePassiveReady: true,
      softwareCancelsLeft: 2,
      strategicDiceUsed: false,
      industrialRemoteBuyUsed: false,
      energyRentDiscountReady: roleId === "energy",
      logisticsAdjustReady: roleId === "logistics",
      creativeExtendReady: roleId === "creative",
      financialDoubleReady: roleId === "financial",
      financialDoubleArmed: false,
      networkingExtraReady: roleId === "relations",
      networkingExtraArmed: false,
      nextDebtPayerId: null,
      halfNextRent: false,
      exclusiveTargets: [],
      connectionRentSkipRound: 0,
      connectionIncomeBoostRound: 0,
      rivalId: null,
      rivalRevealed: false,
      rivalDefeated: false,
      loans: [],
      collaterals: [],
      copiedPassiveRoleId: null,
      copiedPassiveTurn: 0,
      startupBoomTileId: null,
      startupBoomUntilRound: 0,
      termContracts: [],
    });
    room.acceptedContractsCount[player.id] = 0;
    room.opaHostilUsed[player.id] = false;
  });

  // Each player draws 1 secret card at game start
  room.players.forEach((player) => {
    const cardId = drawCardId();
    if (cardId) {
      addCardToHand(player.id, cardId);
    }
  });

  addLog("La partida comienza. Cada jugador arranca con 500 monedas y 1 Carta Suerte.");

  // Check if we need rivalry declaration phase
  room.turn = {
    phase: "declare_rival",
    message: "Cada jugador debe declarar su rival secreto.",
    lastRoll: null,
    marketRoll: null,
    rentPreview: null,
    tileId: null,
    negotiationEndsAt: null,
    energyDiscountApplied: false,
    outsourcerId: null,
  };
  persistRoom();
  broadcastState();
}

function addLog(message) {
  if (!room) {
    return;
  }
  room.log.unshift(message);
  room.log = room.log.slice(0, MAX_LOG_ITEMS);
}

function randomCode(length) {
  return crypto.randomBytes(length).toString("hex").slice(0, length).toUpperCase();
}

function randomToken(length) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shuffle(array) {
  const clone = [...array];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function getBaseUrls(port) {
  const urls = [`http://localhost:${port}`];
  const networks = os.networkInterfaces();
  for (const entries of Object.values(networks)) {
    (entries || []).forEach((entry) => {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    });
  }
  return [...new Set(urls)];
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/\/+$/, "");
}

function getFrontendBaseUrls() {
  if (FRONTEND_URL) {
    return [FRONTEND_URL];
  }
  return getBaseUrls(PORT).map((url) => {
    try {
      const parsed = new URL(url);
      parsed.pathname = "/frontend";
      return normalizeBaseUrl(parsed.toString());
    } catch {
      return url;
    }
  });
}

function getPublicBackendBaseUrl() {
  if (PUBLIC_BACKEND_URL) {
    return PUBLIC_BACKEND_URL;
  }
  const backendUrls = getBaseUrls(PORT);
  return backendUrls.find((url) => !url.includes("localhost")) || backendUrls[0];
}

function getRole(roleId) {
  return ROLES[roleId];
}

function getCard(cardId) {
  return CARD_LIBRARY.find((card) => card.id === cardId);
}

function getPlayer(playerId) {
  return room?.players.find((player) => player.id === playerId) || null;
}

function getCurrentPlayer() {
  return room?.players[room.currentPlayerIndex] || null;
}

function getTileByIndex(index) {
  return TILES.find((tile) => tile.index === index);
}

function getTileById(tileId) {
  return TILES.find((tile) => tile.id === tileId);
}

function getPropertyState(tileId) {
  return room?.board?.[tileId] || null;
}

function getPlayerProperties(playerId) {
  return TILES.filter((tile) => {
    if (tile.kind !== "property") {
      return false;
    }
    const property = getPropertyState(tile.id);
    return property?.owners.some((owner) => owner.playerId === playerId);
  });
}

function getSoloOwnedProperties(playerId) {
  return TILES.filter((tile) => {
    if (tile.kind !== "property") {
      return false;
    }
    const property = getPropertyState(tile.id);
    return property?.owners.length === 1 && property.owners[0].playerId === playerId;
  });
}

function getFreeProperties() {
  return TILES.filter((tile) => tile.kind === "property" && getPropertyState(tile.id)?.owners.length === 0);
}

// ─── VENTURE POINTS ───────────────────────────────────────────
function calculateVenturePoints(playerId) {
  const player = getPlayer(playerId);
  if (!player) return 0;

  let vp = 0;
  const breakdown = {};

  // Credits VP: 1 per 500 credits, max 4
  const creditsVP = Math.min(VP_TABLE.maxCreditsVP, Math.floor(player.credits / VP_TABLE.creditsPerVP));
  vp += creditsVP;
  breakdown.credits = creditsVP;

  // Connections VP: 1 per connection, max 5
  const connectionsVP = Math.min(VP_TABLE.maxConnectionsVP, player.connections);
  vp += connectionsVP;
  breakdown.connections = connectionsVP;

  // Sector domination VP: 2 per dominated sector
  const dominatedSectors = getDominatedSectorsByPlayer(playerId);
  const sectorVP = dominatedSectors.length * VP_TABLE.sectorDominationVP;
  vp += sectorVP;
  breakdown.sectors = sectorVP;

  // Rivalry VP
  if (player.rivalDefeated) {
    vp += VP_TABLE.rivalryVP;
    breakdown.rivalry = VP_TABLE.rivalryVP;
  }

  // B2B contracts VP
  const contractCount = room.acceptedContractsCount?.[playerId] || 0;
  if (contractCount >= VP_TABLE.b2bContractsNeeded) {
    vp += VP_TABLE.b2bContractsVP;
    breakdown.b2b = VP_TABLE.b2bContractsVP;
  }

  return { total: vp, breakdown };
}

function canBuildTower(player) {
  const vpData = calculateVenturePoints(player.id);
  return vpData.total >= VP_TABLE.ventureTowerMinVP && player.credits >= 2000 && player.connections >= 5;
}

// ─── SECTOR DOMINATION ───────────────────────────────────────
function getDominatedSectorsByPlayer(playerId) {
  const result = [];
  for (const [sectorName, tileIds] of Object.entries(SECTORS)) {
    const ownsAll = tileIds.every((tileId) => {
      const property = getPropertyState(tileId);
      return property && property.owners.some((o) => o.playerId === playerId);
    });
    if (ownsAll) {
      result.push(sectorName);
    }
  }
  return result;
}

function refreshSectorDomains() {
  if (!room) return;
  const newDomains = {};
  for (const [sectorName, tileIds] of Object.entries(SECTORS)) {
    // Check if any single player owns all 4 properties in this sector
    const candidatePlayers = room.players.map((p) => p.id);
    for (const pid of candidatePlayers) {
      const ownsAll = tileIds.every((tileId) => {
        const property = getPropertyState(tileId);
        return property && property.owners.some((o) => o.playerId === pid);
      });
      if (ownsAll) {
        // Check if sector domination was broken by joint venture
        const hasJointVenture = tileIds.some((tileId) => {
          const property = getPropertyState(tileId);
          return property && property.owners.length > 1;
        });
        if (!hasJointVenture) {
          newDomains[sectorName] = pid;
        }
        break;
      }
    }
  }

  // Log changes
  for (const [sector, ownerId] of Object.entries(newDomains)) {
    if (room.sectorDomains[sector] !== ownerId) {
      const owner = getPlayer(ownerId);
      addLog(`${owner.name} activa Dominio de Sector en ${sector}!`);
    }
  }
  for (const [sector, oldOwnerId] of Object.entries(room.sectorDomains)) {
    if (!newDomains[sector]) {
      const oldOwner = getPlayer(oldOwnerId);
      if (oldOwner) {
        addLog(`${oldOwner.name} pierde el Dominio de ${sector}.`);
      }
    }
  }

  room.sectorDomains = newDomains;
}

function getSectorDomainOwner(sectorName) {
  return room?.sectorDomains?.[sectorName] || null;
}

// ─── MARKET INDEX ─────────────────────────────────────────────
function rollMarketIndex() {
  const roll = randomDie();
  const entry = MARKET_INDEX_TABLE.find((e) => e.roll.includes(roll));
  room.marketIndex = {
    id: entry.id,
    name: entry.name,
    multiplier: entry.multiplier,
    roll,
    description: entry.description,
  };
  addLog(`Indice de Mercado: dado ${roll} → ${entry.name} (rentas x${entry.multiplier}).`);
}

function getGlobalRentMultiplier() {
  let multiplier = room?.marketIndex?.multiplier || 1;
  // Also apply active event multiplier if any
  if (room?.activeEvent?.roundMultiplier) {
    multiplier *= room.activeEvent.roundMultiplier;
  }
  return multiplier;
}

// ─── BANKRUPTCY BUFFER ────────────────────────────────────────
function processLoansAndCollaterals() {
  if (!room) return;
  room.players.forEach((player) => {
    // Process loan interest
    player.loans.forEach((loan) => {
      if (loan.active) {
        player.credits -= loan.interest;
        addLog(`${player.name} paga ${loan.interest} creditos de interes por prestamo.`);
      }
    });

    // Check collaterals
    player.collaterals = player.collaterals.filter((col) => {
      col.turnsRemaining -= 1;
      if (col.turnsRemaining <= 0 && col.active) {
        // Transfer property to creditor
        const property = getPropertyState(col.tileId);
        if (property) {
          property.owners = [{ playerId: col.creditorId, share: 1 }];
          const creditor = getPlayer(col.creditorId);
          addLog(`${player.name} no pago a tiempo. ${getTileById(col.tileId).name} pasa a ${creditor?.name || "acreedor"}.`);
        }
        return false;
      }
      return true;
    });

    // Enforce minimum 50 credits
    if (player.credits < 50) {
      player.credits = 50;
    }
  });
}

function applyBankruptcyBuffer(player) {
  // Never go below 50. If can't pay, enter bankruptcy options phase
  if (player.credits < 50) {
    player.credits = 50;
  }
}

// ─── VICTORY CHECKS ──────────────────────────────────────────
function checkAlternativeVictories() {
  if (!room || room.status !== "playing") return null;

  // 1. Conquest: dominate 3 sectors
  for (const player of room.players) {
    const dominated = getDominatedSectorsByPlayer(player.id);
    if (dominated.length >= VP_TABLE.conquestSectors) {
      return { winnerId: player.id, type: "conquest", message: `${player.name} domina ${dominated.length} sectores y gana por Conquista de Sector!` };
    }
  }

  // 2. Network Magnate: 8+ connections
  for (const player of room.players) {
    if (player.connections >= VP_TABLE.networkMagnateConnections) {
      return { winnerId: player.id, type: "magnate", message: `${player.name} alcanza ${player.connections} conexiones y gana como Magnate de Red!` };
    }
  }

  // 3. Venture Points: 10 VP
  for (const player of room.players) {
    const vpData = calculateVenturePoints(player.id);
    if (vpData.total >= VP_TABLE.victoryVP) {
      return { winnerId: player.id, type: "venture_points", message: `${player.name} alcanza ${vpData.total} Venture Points y gana la partida!` };
    }
  }

  // 4. Elimination: only solvent player
  const solventPlayers = room.players.filter((p) => p.credits > 50 || getPlayerProperties(p.id).length > 0);
  if (solventPlayers.length === 1 && room.players.length > 1) {
    return { winnerId: solventPlayers[0].id, type: "elimination", message: `${solventPlayers[0].name} es el unico jugador solvente y gana por eliminacion!` };
  }

  return null;
}

function applyVictory(victoryResult) {
  if (!victoryResult) return false;
  room.status = "finished";
  room.winnerId = victoryResult.winnerId;
  room.turn.phase = "finished";
  room.turn.message = victoryResult.message;
  addLog(victoryResult.message);
  persistRoom();
  broadcastState();
  return true;
}

function formatCredits(amount) {
  return `${Math.round(amount)} creditos`;
}

function awardCredits(playerId, amount, reason) {
  const player = getPlayer(playerId);
  if (!player) {
    return;
  }
  let finalAmount = amount;
  if (player.roleId === "financial" || player.copiedPassiveRoleId === "financial") {
    finalAmount = Math.ceil(finalAmount * 1.1);
  }
  if (player.financialDoubleArmed) {
    finalAmount *= 2;
    player.financialDoubleArmed = false;
  }
  player.credits += finalAmount;
  addLog(`${player.name} recibe ${formatCredits(finalAmount)} por ${reason}.`);
}

function spendCredits(playerId, amount, reason, options = {}) {
  const player = getPlayer(playerId);
  if (!player) {
    return;
  }
  let finalAmount = amount;
  if ((options.isTax || options.isNegativeEvent) && (player.roleId === "energy" || player.copiedPassiveRoleId === "energy")) {
    finalAmount = Math.max(0, finalAmount - 20);
  }
  player.credits -= finalAmount;
  addLog(`${player.name} paga ${formatCredits(finalAmount)} por ${reason}.`);

  // Apply bankruptcy buffer — never below 50
  if (player.credits < 50) {
    const deficit = 50 - player.credits;
    // Try to auto-liquidate properties first
    applyDebtRestructure(player, reason);
    // After liquidation, still enforce minimum
    applyBankruptcyBuffer(player);
  } else {
    applyDebtRestructure(player, reason);
  }
}

function applyDebtRestructure(player, reason) {
  if (player.credits >= 50) {
    return;
  }

  const liquidable = getSoloOwnedProperties(player.id).sort((left, right) => right.price - left.price);
  while (player.credits < 50 && liquidable.length > 0) {
    const tile = liquidable.shift();
    const property = getPropertyState(tile.id);
    if (!property || property.owners.length !== 1 || property.owners[0].playerId !== player.id) {
      continue;
    }
    property.owners = [];
    const recoveredCredits = Math.ceil(tile.price * 0.6);
    player.credits += recoveredCredits;
    addLog(`${player.name} liquida ${tile.name} y recupera ${formatCredits(recoveredCredits)} por insolvencia (${reason}).`);
  }

  // Bankruptcy buffer: never below 50
  if (player.credits < 50) {
    player.credits = 50;
    player.skipTurns = Math.max(player.skipTurns, 1);
    addLog(`${player.name} entra en reestructuracion: saldo minimo 50 creditos y pierde 1 turno.`);
  }
}

function gainConnections(playerId, amount, reason) {
  const player = getPlayer(playerId);
  if (!player) {
    return;
  }
  player.connections += amount;
  addLog(`${player.name} gana ${amount} conexion(es) por ${reason}.`);
}

function getPurchasePrice(playerId, basePrice) {
  const player = getPlayer(playerId);
  if (!player) {
    return basePrice;
  }
  return (player.roleId === "industrial" || player.copiedPassiveRoleId === "industrial")
    ? Math.ceil(basePrice * 0.8)
    : basePrice;
}

function drawCardId() {
  if (room.deck.length === 0) {
    room.deck = shuffle([...room.discard]);
    room.discard = [];
  }
  return room.deck.shift();
}

function addCardToHand(playerId, cardId) {
  const player = getPlayer(playerId);
  if (!player || !cardId) {
    return;
  }
  const card = getCard(cardId);

  // Alliance cards don't count toward hand limit
  const nonAllianceCards = player.hand.filter((h) => {
    const c = getCard(h.cardId);
    return c && c.category !== "Alianza";
  });

  // If hand is full (3 non-alliance cards) and new card is Event, activate immediately
  if (nonAllianceCards.length >= 3 && card && card.category === "Evento") {
    addLog(`${player.name} roba ${card.title} con la mano llena. Se activa inmediatamente.`);
    activateEventCard(playerId, cardId);
    return;
  }

  // If hand is full and card is not Alliance, discard oldest non-alliance
  if (nonAllianceCards.length >= 3 && card && card.category !== "Alianza") {
    const oldest = nonAllianceCards[0];
    discardCardInstance(player, oldest.instanceId);
    addLog(`${player.name} descarta una carta por exceder el limite de mano.`);
  }

  player.hand.push({
    instanceId: randomToken(12),
    cardId,
    drawnAtTurn: room.turnCounter,
  });
  addLog(`${player.name} roba una Connect Card para su mano.`);
}

function activateEventCard(playerId, cardId) {
  const card = getCard(cardId);
  if (!card) return;
  const player = getPlayer(playerId);
  const bonusCredits = room.activeEvent?.cardBonusCredits || 0;

  switch (card.id) {
    case "economic-crisis":
      room.players.forEach((entry) =>
        spendCredits(entry.id, 50, "Crisis Economica", { isNegativeEvent: true }),
      );
      break;
    case "market-boom":
      room.activeEvent = {
        id: "market-boom-card",
        name: "Boom del Mercado",
        description: "Las rentas se duplican por 1 ronda debido a una Connect Card.",
        roundMultiplier: 2,
        createdRound: room.round,
        remainingRounds: 1,
      };
      break;
    case "global-innovation":
      room.players.forEach((entry) => gainConnections(entry.id, 1, "Innovacion Global"));
      break;
    default:
      break;
  }
  room.discard.push(cardId);
}

function discardCardInstance(player, instanceId) {
  const cardIndex = player.hand.findIndex((item) => item.instanceId === instanceId);
  if (cardIndex === -1) {
    return null;
  }
  const [removed] = player.hand.splice(cardIndex, 1);
  room.discard.push(removed.cardId);
  return removed;
}

function startTurn() {
  const player = getCurrentPlayer();
  if (!player) {
    return;
  }

  // Clear headhunting copied passive if expired
  if (player.copiedPassiveRoleId && player.copiedPassiveTurn < room.turnCounter) {
    player.copiedPassiveRoleId = null;
    player.copiedPassiveTurn = 0;
  }

  player.energyRentDiscountReady = player.roleId === "energy";
  player.logisticsAdjustReady = player.roleId === "logistics";
  player.creativeExtendReady = player.roleId === "creative";
  player.financialDoubleReady = player.roleId === "financial";
  player.financialDoubleArmed = false;
  player.networkingExtraReady = player.roleId === "relations";
  player.networkingExtraArmed = false;

  room.turn = {
    phase: "await_roll",
    message: `${player.name} debe lanzar el dado principal.`,
    lastRoll: null,
    marketRoll: null,
    rentPreview: null,
    tileId: null,
    negotiationEndsAt: null,
    energyDiscountApplied: false,
    outsourcerId: null,
  };

  if (player.skipTurns > 0) {
    player.skipTurns -= 1;
    room.turn.phase = "skip_turn";
    room.turn.message = `${player.name} pierde este turno.`;
    addLog(`${player.name} pierde el turno por un efecto previo.`);
    persistRoom();
    broadcastState();
    return;
  }

  if (player.connections >= 3) {
    awardCredits(player.id, 50, "bono por red de contactos");
  }

  // Sector domination bonus: +50 credits per dominated sector at turn start
  const dominatedSectors = getDominatedSectorsByPlayer(player.id);
  if (dominatedSectors.length > 0) {
    const domBonus = dominatedSectors.length * 50;
    awardCredits(player.id, domBonus, `dominio de ${dominatedSectors.join(", ")}`);
  }

  // Check victory conditions
  const victoryResult = checkAlternativeVictories();
  if (victoryResult) {
    applyVictory(victoryResult);
    return;
  }

  if (canBuildTower(player)) {
    room.turn.phase = "victory_ready";
    room.turn.message = `${player.name} ya puede construir la Venture Tower.`;
  }

  persistRoom();
  broadcastState();
}

function advancePlayerIndex() {
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
}

function tickPropertyDurations() {
  Object.values(room.board).forEach((property) => {
    if (property.protectedTurns > 0 && property.protectionCreatedOnTurn < room.turnCounter) {
      property.protectedTurns -= 1;
    }
    if (property.franchiseTurns > 0 && property.franchiseCreatedOnTurn < room.turnCounter) {
      property.franchiseTurns -= 1;
    }
  });

  // Tick sector patents
  for (const [sector, patent] of Object.entries(room.sectorPatents)) {
    if (patent.remainingRounds > 0) {
      patent.remainingRounds -= 1;
      if (patent.remainingRounds <= 0) {
        addLog(`La Patente sobre ${sector} ha expirado.`);
        delete room.sectorPatents[sector];
      }
    }
  }

  // Tick startup boom effects
  room.players.forEach((player) => {
    if (player.startupBoomTileId && room.round > player.startupBoomUntilRound) {
      player.startupBoomTileId = null;
      player.startupBoomUntilRound = 0;
    }
  });
}

function processRoundChange() {
  if (room.currentPlayerIndex !== 0) {
    return;
  }
  room.round += 1;

  // Process loans and collaterals at start of each round
  processLoansAndCollaterals();

  // Rivalry check: compare credits at end of round
  room.players.forEach((player) => {
    if (player.rivalId && !player.rivalDefeated) {
      const rival = getPlayer(player.rivalId);
      if (rival && player.credits > rival.credits) {
        gainConnections(player.id, 1, "superar a su rival en creditos");
        if (!player.rivalRevealed) {
          player.rivalRevealed = true;
          addLog(`La rivalidad de ${player.name} hacia ${rival.name} ha sido revelada!`);
        }
      }
    }
  });

  if (room.activeEvent && room.activeEvent.createdRound < room.round) {
    room.activeEvent.remainingRounds -= 1;
    if (room.activeEvent.remainingRounds <= 0) {
      addLog(`El evento "${room.activeEvent.name}" termina.`);
      room.activeEvent = null;
    }
  }

  // Market Index: roll every 3 rounds (round 3, 6, 9...)
  if ((room.round - 1) % 3 === 0 && room.round > 1) {
    rollMarketIndex();
  }

  // Check alternative victories after round change
  const victoryResult = checkAlternativeVictories();
  if (victoryResult) {
    applyVictory(victoryResult);
  }
}

function buildTower(playerId) {
  const player = getPlayer(playerId);
  if (!player || !canBuildTower(player)) {
    throw new Error("Aun no cumples las condiciones para la Venture Tower.");
  }
  const vpData = calculateVenturePoints(playerId);
  room.status = "finished";
  room.winnerId = player.id;
  room.turn.phase = "finished";
  room.turn.message = `${player.name} construyo la Venture Tower con ${vpData.total + VP_TABLE.ventureTowerVP} VP y gano la partida.`;
  addLog(`${player.name} gana City Venture con ${player.connections} conexiones activas y ${vpData.total + VP_TABLE.ventureTowerVP} Venture Points.`);
  persistRoom();
  broadcastState();
}

function movePlayer(player, steps, sourceLabel) {
  const previousPosition = player.position;
  const nextPosition = modulo(previousPosition + steps, TILES.length);
  if (steps > 0 && previousPosition + steps >= TILES.length) {
    awardCredits(player.id, 100, "paso por Start");
  }
  player.position = nextPosition;
  addLog(`${player.name} se mueve ${Math.abs(steps)} casilla(s) hasta ${getTileByIndex(nextPosition).name}.`);
  if (sourceLabel) {
    addLog(sourceLabel);
  }
}

function resolveCurrentTile() {
  const player = getCurrentPlayer();
  const tile = getTileByIndex(player.position);
  room.turn.tileId = tile.id;
  room.turn.marketRoll = null;
  room.turn.rentPreview = null;
  room.turn.energyDiscountApplied = false;

  if (tile.kind === "property") {
    const property = getPropertyState(tile.id);

    // Check if sector is patented (can't buy)
    const sectorPatent = room.sectorPatents[tile.sector];
    const isPatented = sectorPatent && sectorPatent.remainingRounds > 0 && sectorPatent.ownerId !== player.id;

    if (property.owners.length === 0) {
      if (isPatented) {
        startNegotiationPhase(`${tile.name} esta protegida por una Patente. No puedes comprarla.`);
        return;
      }
      room.turn.phase = "property_offer";
      room.turn.message = `${tile.name} esta libre. Puedes comprarla por ${formatCredits(getPurchasePrice(player.id, tile.price))}.`;
      persistRoom();
      broadcastState();
      return;
    }

    if (property.owners.some((owner) => owner.playerId === player.id)) {
      startNegotiationPhase(`Caes en ${tile.name}, una propiedad que ya controlas.`);
      return;
    }

    // Rivalry effect: if landing on rival's property, roll market dice twice and take worst
    const isRivalProperty = player.rivalId && property.owners.some((o) => o.playerId === player.rivalId);
    if (isRivalProperty) {
      room.turn.rivalMarketPenalty = true;
      if (!player.rivalRevealed) {
        player.rivalRevealed = true;
        addLog(`La rivalidad de ${player.name} hacia ${getPlayer(player.rivalId)?.name} ha sido revelada!`);
      }
    } else {
      room.turn.rivalMarketPenalty = false;
    }

    // Sector domination: if another player dominates this sector, they also collect rent
    const domainOwner = getSectorDomainOwner(tile.sector);
    if (domainOwner && domainOwner !== player.id) {
      room.turn.sectorDomainOwnerId = domainOwner;
    } else {
      room.turn.sectorDomainOwnerId = null;
    }

    room.turn.phase = "market_roll";
    room.turn.message = `Debes lanzar el dado de mercado para definir la renta en ${tile.name}.`;
    persistRoom();
    broadcastState();
    return;
  }

  if (tile.kind === "connect") {
    const cardId = drawCardId();
    addCardToHand(player.id, cardId);
    startNegotiationPhase(`${player.name} entra a una casilla Connect y suma una carta a su mano.`);
    return;
  }

  if (tile.kind === "tax") {
    spendCredits(player.id, tile.amount, tile.name, { isTax: true });
    startNegotiationPhase(`${player.name} pago el impuesto urbano.`);
    return;
  }

  if (tile.kind === "subsidy") {
    awardCredits(player.id, tile.amount, tile.name);
    startNegotiationPhase(`${player.name} recibio el subsidio del gobierno.`);
    return;
  }

  if (tile.kind === "audit") {
    player.skipTurns += 1;
    startNegotiationPhase(`${player.name} recibio una auditoria y perdera el siguiente turno.`);
    return;
  }

  startNegotiationPhase(`${player.name} vuelve a Start y puede negociar.`);
}

function startNegotiationPhase(message) {
  room.turn.phase = "negotiation";
  room.turn.message = message;
  room.turn.negotiationEndsAt = Date.now() + NEGOTIATION_SECONDS * 1000;
  persistRoom();
  broadcastState();
}

function calculateRentPreview(tileId, payerId, marketRoll, options = {}) {
  const tile = getTileById(tileId);
  const property = getPropertyState(tileId);
  const payer = getPlayer(payerId);
  const multiplier = marketRoll <= 2 ? 0.5 : marketRoll <= 4 ? 1 : 2;
  const levelMultiplier = [1, 1, 1.5, 2.5][(property.level || 1)]; // Level 1=x1, 2=x1.5, 3=x2.5
  let total = Math.ceil(tile.baseRent * multiplier * levelMultiplier * getGlobalRentMultiplier());

  if (property.franchiseTurns > 0) {
    total *= 2;
  }

  // Startup Boom effect: triple rent for cheapest property
  const ownerWithBoom = room.players.find((p) =>
    p.startupBoomTileId === tileId && room.round <= p.startupBoomUntilRound
  );
  if (ownerWithBoom && property.owners.some((o) => o.playerId === ownerWithBoom.id)) {
    total *= 3;
  }

  const hasExclusive = room.players.some(
    (candidate) =>
      candidate.exclusiveTargets.includes(payerId) &&
      property.owners.some((owner) => owner.playerId === candidate.id),
  );
  if (hasExclusive) {
    total *= 2;
  }

  if (payer.halfNextRent || options.useEnergyDiscount) {
    total = Math.ceil(total / 2);
  }

  return {
    total,
    baseRent: tile.baseRent,
    marketLabel: marketRoll <= 2 ? "renta baja" : marketRoll <= 4 ? "renta normal" : "renta alta",
  };
}

function endTurn() {
  expirePendingContracts("cambio de turno");
  tickPropertyDurations();
  refreshSectorDomains();
  room.turnCounter += 1;
  advancePlayerIndex();
  processRoundChange();

  // Check victory after round processing
  if (room.status === "finished") return;

  startTurn();
}

function closeNegotiationByTimer() {
  if (!room || room.status !== "playing") {
    return;
  }
  if (room.turn.phase !== "negotiation" || !room.turn.negotiationEndsAt) {
    return;
  }
  if (Date.now() < room.turn.negotiationEndsAt) {
    return;
  }
  addLog("El Mercado Negro expiro y el turno avanza automaticamente.");
  endTurn();
}

function modulo(value, length) {
  return ((value % length) + length) % length;
}

function ensureCurrentPlayer(playerId) {
  const player = getPlayer(playerId);
  if (!player || getCurrentPlayer()?.id !== playerId) {
    throw new Error("No es tu turno.");
  }
  return player;
}

function runTurnAction(playerId, action, payload = {}) {
  if (room.status !== "playing") {
    throw new Error("La partida no esta activa.");
  }

  // Declare rival can be done by any player during declare_rival phase
  if (action === "declare-rival") {
    if (room.turn.phase !== "declare_rival") {
      throw new Error("No es momento de declarar rival.");
    }
    const player = getPlayer(playerId);
    if (!player) throw new Error("Jugador no encontrado.");
    const targetId = payload.targetPlayerId;
    if (!targetId || targetId === playerId) throw new Error("Debes elegir un rival valido.");
    const target = getPlayer(targetId);
    if (!target) throw new Error("Rival no encontrado.");
    player.rivalId = targetId;
    addLog(`${player.name} ha declarado su rival secreto.`);

    // Check if all players have declared their rival
    const allDeclared = room.players.every((p) => p.rivalId !== null);
    if (allDeclared) {
      addLog("Todos los jugadores han declarado su rival secreto. La partida comienza!");
      startTurn();
    } else {
      persistRoom();
      broadcastState();
    }
    return;
  }

  // Skip rival: allows skipping rival declaration
  if (action === "skip-rival") {
    if (room.turn.phase !== "declare_rival") {
      throw new Error("No es momento de declarar rival.");
    }
    const player = getPlayer(playerId);
    if (!player) throw new Error("Jugador no encontrado.");
    // Set a dummy rival (no rival)
    if (!player.rivalId) {
      player.rivalId = "__none__";
      addLog(`${player.name} decide no tener rival.`);
    }
    const allDeclared = room.players.every((p) => p.rivalId !== null);
    if (allDeclared) {
      addLog("Todos los jugadores han declarado. La partida comienza!");
      startTurn();
    } else {
      persistRoom();
      broadcastState();
    }
    return;
  }

  // Take loan during bankruptcy
  if (action === "take-loan") {
    const player = getPlayer(playerId);
    if (!player) throw new Error("Jugador no encontrado.");
    player.loans.push({
      id: randomCode(6),
      amount: 200,
      interest: 30,
      active: true,
      takenAtRound: room.round,
    });
    player.credits += 200;
    addLog(`${player.name} toma un prestamo de 200 creditos (interes: 30/ronda).`);
    persistRoom();
    broadcastState();
    return;
  }

  // Offer collateral
  if (action === "offer-collateral") {
    const player = getPlayer(playerId);
    if (!player) throw new Error("Jugador no encontrado.");
    const tileId = payload.tileId;
    const creditorId = payload.creditorId;
    if (!tileId || !creditorId) throw new Error("Datos de garantia incompletos.");
    ensureSoloOwnedProperty(player.id, tileId);
    player.collaterals.push({
      tileId,
      creditorId,
      turnsRemaining: 3,
      active: true,
    });
    addLog(`${player.name} ofrece ${getTileById(tileId).name} como garantia a ${getPlayer(creditorId)?.name || "acreedor"}.`);
    persistRoom();
    broadcastState();
    return;
  }

  const player = ensureCurrentPlayer(playerId);

  switch (action) {
    case "roll-die": {
      if (room.turn.phase !== "await_roll" && room.turn.phase !== "victory_ready") {
        throw new Error("No puedes lanzar el dado ahora.");
      }
      if (room.turn.phase === "victory_ready" && canBuildTower(player) && payload.forceBuild) {
        buildTower(player.id);
        return;
      }
      const rawRoll = randomDie();
      const movement = rawRoll + ((player.roleId === "logistics" || player.copiedPassiveRoleId === "logistics") ? 1 : 0);
      movePlayer(
        player,
        movement,
        `${player.name} lanzo ${rawRoll}${(player.roleId === "logistics" || player.copiedPassiveRoleId === "logistics") ? " y avanzo 1 extra por Logistica." : "."}`,
      );
      room.turn.lastRoll = {
        rawRoll,
        movement,
        label: (player.roleId === "logistics" || player.copiedPassiveRoleId === "logistics") ? `${rawRoll} + 1` : `${rawRoll}`,
      };
      if ((player.roleId === "logistics" || player.copiedPassiveRoleId === "logistics") && player.logisticsAdjustReady) {
        room.turn.phase = "movement_adjust";
        room.turn.message = "Puedes ajustar la ruta en 1 casilla.";
        persistRoom();
        broadcastState();
        return;
      }
      resolveCurrentTile();
      return;
    }
    case "adjust-route": {
      if (room.turn.phase !== "movement_adjust") {
        throw new Error("No puedes ajustar movimiento ahora.");
      }
      const delta = clamp(Number(payload.delta) || 0, -1, 1);
      if (delta !== 0) {
        movePlayer(player, delta, `${player.name} ajusta su ruta ${delta > 0 ? "hacia adelante" : "hacia atras"} 1 casilla.`);
      }
      player.logisticsAdjustReady = false;
      resolveCurrentTile();
      return;
    }
    case "buy-property": {
      if (room.turn.phase !== "property_offer") {
        throw new Error("No hay una propiedad disponible para comprar.");
      }
      const tile = getTileById(room.turn.tileId);
      const cost = getPurchasePrice(player.id, tile.price);
      spendCredits(player.id, cost, `compra de ${tile.name}`);
      getPropertyState(tile.id).owners = [{ playerId: player.id, share: 1 }];
      addLog(`${player.name} compra ${tile.name}.`);
      refreshSectorDomains();
      startNegotiationPhase(`${player.name} ya controla ${tile.name}.`);
      return;
    }
    case "skip-property": {
      if (room.turn.phase !== "property_offer") {
        throw new Error("No hay una propiedad pendiente.");
      }
      startNegotiationPhase("La propiedad queda libre para futuras rondas.");
      return;
    }
    case "roll-market": {
      if (room.turn.phase !== "market_roll") {
        throw new Error("No toca dado de mercado.");
      }
      let marketRoll = randomDie();

      // Rivalry penalty: roll twice, take worst
      if (room.turn.rivalMarketPenalty) {
        const secondRoll = randomDie();
        const worse = Math.max(marketRoll, secondRoll); // Higher roll = higher rent = worse for payer
        addLog(`Penalizacion de rivalidad: dados ${marketRoll} y ${secondRoll}, se usa el peor (${worse}).`);
        marketRoll = worse;
      }

      room.turn.marketRoll = marketRoll;
      room.turn.rentPreview = calculateRentPreview(room.turn.tileId, player.id, marketRoll, {
        useEnergyDiscount: room.turn.energyDiscountApplied,
      });
      addLog(`Dado de mercado: ${marketRoll} (${room.turn.rentPreview.marketLabel}).`);
      persistRoom();
      broadcastState();
      return;
    }
    case "reroll-market": {
      if (room.turn.phase !== "market_roll" || !room.turn.marketRoll) {
        throw new Error("Primero debes lanzar el dado de mercado.");
      }
      spendCredits(player.id, 50, "repeticion del dado de mercado");
      room.turn.marketRoll = null;
      room.turn.rentPreview = null;
      persistRoom();
      broadcastState();
      return;
    }
    case "energy-rent-discount": {
      if (room.turn.phase !== "market_roll" || player.roleId !== "energy" || !player.energyRentDiscountReady) {
        throw new Error("Ese descuento no esta disponible.");
      }
      player.energyRentDiscountReady = false;
      room.turn.energyDiscountApplied = true;
      if (room.turn.marketRoll) {
        room.turn.rentPreview = calculateRentPreview(room.turn.tileId, player.id, room.turn.marketRoll, {
          useEnergyDiscount: true,
        });
      }
      persistRoom();
      broadcastState();
      return;
    }
    case "skip-rent-with-connections": {
      if (room.turn.phase !== "market_roll" || player.connections < 5 || player.connectionRentSkipRound === room.round) {
        throw new Error("No puedes saltar esta renta.");
      }
      player.connectionRentSkipRound = room.round;
      startNegotiationPhase(`${player.name} uso su red de conexiones para evitar la renta.`);
      return;
    }
    case "pay-rent": {
      if (room.turn.phase !== "market_roll" || !room.turn.rentPreview) {
        throw new Error("La renta aun no esta definida.");
      }
      payRent(player);
      return;
    }
    case "arm-financial-double": {
      if (player.roleId !== "financial" || !player.financialDoubleReady) {
        throw new Error("Esa habilidad no esta lista.");
      }
      player.financialDoubleReady = false;
      player.financialDoubleArmed = true;
      addLog(`${player.name} activa duplicacion financiera para su proximo ingreso.`);
      persistRoom();
      broadcastState();
      return;
    }
    case "arm-networking-bonus": {
      if (player.roleId !== "relations" || !player.networkingExtraReady) {
        throw new Error("Ese bono no esta listo.");
      }
      player.networkingExtraReady = false;
      player.networkingExtraArmed = true;
      addLog(`${player.name} activa su conexion extra para el siguiente contrato.`);
      persistRoom();
      broadcastState();
      return;
    }
    case "extend-negotiation": {
      if (room.turn.phase !== "negotiation" || player.roleId !== "creative" || !player.creativeExtendReady) {
        throw new Error("No puedes extender la fase B2B ahora.");
      }
      player.creativeExtendReady = false;
      room.turn.negotiationEndsAt = (room.turn.negotiationEndsAt || Date.now()) + 30000;
      addLog(`${player.name} extiende el Mercado Negro 30 segundos.`);
      persistRoom();
      broadcastState();
      return;
    }
    case "remote-buy-property": {
      if (player.roleId !== "industrial" || player.industrialRemoteBuyUsed) {
        throw new Error("La compra remota ya fue usada.");
      }
      const tile = getTileById(payload.tileId);
      if (!tile || tile.kind !== "property" || getPropertyState(tile.id).owners.length > 0) {
        throw new Error("Esa propiedad no esta libre.");
      }
      // Check patent
      const patent = room.sectorPatents[tile.sector];
      if (patent && patent.remainingRounds > 0 && patent.ownerId !== player.id) {
        throw new Error("Esa propiedad esta protegida por una Patente.");
      }
      spendCredits(player.id, getPurchasePrice(player.id, tile.price), `compra remota de ${tile.name}`);
      getPropertyState(tile.id).owners = [{ playerId: player.id, share: 1 }];
      player.industrialRemoteBuyUsed = true;
      addLog(`${player.name} realiza una compra remota sobre ${tile.name}.`);
      refreshSectorDomains();
      persistRoom();
      broadcastState();
      return;
    }
    case "play-card": {
      if (room.turn.phase !== "negotiation" && room.turn.phase !== "victory_ready") {
        throw new Error("Las cartas solo pueden jugarse en el Mercado Negro.");
      }
      playCardFromHand(player, payload);
      return;
    }
    case "upgrade-property": {
      // Player lands on own property and pays to upgrade it (level 1 -> 2 -> 3)
      if (room.turn.phase !== "negotiation" && room.turn.phase !== "victory_ready") {
        throw new Error("Solo puedes mejorar propiedades durante el Mercado Negro.");
      }
      const upgradeTile = getTileById(payload.tileId);
      if (!upgradeTile || upgradeTile.kind !== "property") throw new Error("Propiedad invalida.");
      const upgradeProp = getPropertyState(upgradeTile.id);
      const isOwner = upgradeProp.owners.some((o) => o.playerId === player.id);
      if (!isOwner) throw new Error("No eres dueno de esa propiedad.");
      const currentLevel = upgradeProp.level || 1;
      if (currentLevel >= 3) throw new Error("Esta propiedad ya esta al maximo nivel.");
      const upgradeCost = currentLevel === 1 ? Math.ceil(upgradeTile.price * 0.5) : Math.ceil(upgradeTile.price * 0.75);
      spendCredits(player.id, upgradeCost, `mejora de ${upgradeTile.name} a nivel ${currentLevel + 1}`);
      upgradeProp.level = currentLevel + 1;
      const levelEmojis = ["", "🏠", "🏹", "🌌"];
      addLog(`${player.name} mejoro ${upgradeTile.name} a ${levelEmojis[currentLevel + 1]} Nivel ${currentLevel + 1}! Renta base aumenta.`);
      persistRoom();
      broadcastState();
      return;
    }
    case "end-turn": {
      if (!["negotiation", "skip_turn", "victory_ready"].includes(room.turn.phase)) {
        throw new Error("Todavia hay acciones pendientes antes de cerrar el turno.");
      }
      endTurn();
      return;
    }
    default:
      throw new Error("Accion desconocida.");
  }
}

function payRent(payer) {
  const tile = getTileById(room.turn.tileId);
  const property = getPropertyState(tile.id);
  const owners = property.owners.map((owner) => ({ ...owner }));
  let payerId = payer.id;

  if (payer.nextDebtPayerId) {
    payerId = payer.nextDebtPayerId;
    payer.nextDebtPayerId = null;
    addLog(`${getPlayer(payerId).name} cubre la deuda de ${payer.name} por Outsourcing.`);
  }

  if (payer.halfNextRent) {
    payer.halfNextRent = false;
  }

  spendCredits(payerId, room.turn.rentPreview.total, `renta en ${tile.name}`);

  owners.forEach((owner) => {
    let shareAmount = Math.ceil(room.turn.rentPreview.total * owner.share);
    const ownerPlayer = getPlayer(owner.playerId);

    if (property.nextRentDoubleOwnerId === owner.playerId) {
      shareAmount *= 2;
      property.nextRentDoubleOwnerId = null;
    }

    if (ownerPlayer.connections >= 7 && ownerPlayer.connectionIncomeBoostRound !== room.round) {
      shareAmount *= 2;
      ownerPlayer.connectionIncomeBoostRound = room.round;
      addLog(`${ownerPlayer.name} duplica su ingreso por tener 7 conexiones activas.`);
    }

    awardCredits(owner.playerId, shareAmount, `renta cobrada en ${tile.name}`);
  });

  // Sector domination rent: domain owner also collects
  if (room.turn.sectorDomainOwnerId) {
    const domOwner = getPlayer(room.turn.sectorDomainOwnerId);
    if (domOwner && !owners.some((o) => o.playerId === domOwner.id)) {
      const domRent = Math.ceil(room.turn.rentPreview.total * 0.3);
      awardCredits(domOwner.id, domRent, `dominio de sector ${tile.sector}`);
    }
  }

  room.players.forEach((candidate) => {
    candidate.exclusiveTargets = candidate.exclusiveTargets.filter(
      (targetId) => !(targetId === payer.id && owners.some((owner) => owner.playerId === candidate.id)),
    );
  });

  startNegotiationPhase(`${payer.name} completo el pago de renta en ${tile.name}.`);
}

function randomDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function playCardFromHand(player, payload) {
  const removed = discardCardInstance(player, payload.instanceId);
  if (!removed) {
    throw new Error("No encuentro esa carta en tu mano.");
  }
  const card = getCard(removed.cardId);
  const bonusCredits = room.activeEvent?.cardBonusCredits || 0;

  switch (card.id) {
    case "resource-optimization":
      player.halfNextRent = true;
      addLog(`${player.name} activa Optimizacion de Recursos.`);
      break;
    case "premium-connection":
      awardCredits(player.id, 100 + bonusCredits, "Conexion Premium");
      gainConnections(player.id, 1, "Conexion Premium");
      break;
    case "business-subsidy":
      awardCredits(player.id, 150 + bonusCredits, "Subsidio Empresarial");
      break;
    case "economic-crisis":
      room.players.forEach((entry) =>
        spendCredits(entry.id, 50, "Crisis Economica", { isNegativeEvent: true }),
      );
      break;
    case "market-boom":
      room.activeEvent = {
        id: "market-boom-card",
        name: "Boom del Mercado",
        description: "Las rentas se duplican por 1 ronda debido a una Connect Card.",
        roundMultiplier: 2,
        createdRound: room.round,
        remainingRounds: 1,
      };
      break;
    case "global-innovation":
      room.players.forEach((entry) => gainConnections(entry.id, 1, "Innovacion Global"));
      break;
    case "rapid-expansion":
      movePlayer(player, 3, `${player.name} juega Expansion Rapida y avanza 3 casillas.`);
      resolveCurrentTile();
      return;
    case "outsourcing":
      ensureTargetPlayer(payload.targetPlayerId);
      player.nextDebtPayerId = payload.targetPlayerId;
      addLog(`${getPlayer(payload.targetPlayerId).name} pagara la proxima deuda de ${player.name}.`);
      break;
    case "tech-innovation":
      ensureOwnedProperty(player.id, payload.targetTileId);
      getPropertyState(payload.targetTileId).protectedTurns = 2;
      getPropertyState(payload.targetTileId).protectionCreatedOnTurn = room.turnCounter;
      addLog(`${player.name} protege ${getTileById(payload.targetTileId).name} durante 2 turnos.`);
      break;
    case "joint-venture": {
      ensureTargetPlayer(payload.partnerPlayerId);
      const partner = getPlayer(payload.partnerPlayerId);
      const tile = getTileById(payload.targetTileId);
      if (!tile || tile.kind !== "property" || getPropertyState(tile.id).owners.length > 0) {
        throw new Error("La propiedad elegida para Joint Venture no esta libre.");
      }
      spendCredits(player.id, Math.ceil(getPurchasePrice(player.id, tile.price) / 2), `Joint Venture en ${tile.name}`);
      spendCredits(partner.id, Math.ceil(getPurchasePrice(partner.id, tile.price) / 2), `Joint Venture en ${tile.name}`);
      getPropertyState(tile.id).owners = [
        { playerId: player.id, share: 0.5 },
        { playerId: partner.id, share: 0.5 },
      ];
      addLog(`${player.name} y ${partner.name} compran ${tile.name} como Joint Venture.`);
      // Joint Venture can break sector domination
      refreshSectorDomains();
      break;
    }
    case "strategic-alliance":
      ensureTargetPlayer(payload.targetPlayerId);
      gainConnections(player.id, 1, "Alianza Estrategica");
      gainConnections(payload.targetPlayerId, 1, "Alianza Estrategica");
      break;
    case "exclusive-contract":
      ensureTargetPlayer(payload.targetPlayerId);
      player.exclusiveTargets.push(payload.targetPlayerId);
      addLog(`${getPlayer(payload.targetPlayerId).name} pagara renta doble en la proxima propiedad de ${player.name}.`);
      break;
    case "merge": {
      const sourceTile = ensureSoloOwnedProperty(player.id, payload.sourceTileId);
      const targetTile = getTileById(payload.targetUpgradeTileId);
      if (!targetTile || targetTile.kind !== "property" || getPropertyState(targetTile.id).owners.length > 0 || targetTile.price <= sourceTile.price) {
        throw new Error("Fusion necesita una propiedad libre de mayor valor.");
      }
      const difference = Math.max(0, getPurchasePrice(player.id, targetTile.price) - sourceTile.price);
      spendCredits(player.id, difference, `Fusion hacia ${targetTile.name}`);
      getPropertyState(sourceTile.id).owners = [];
      getPropertyState(targetTile.id).owners = [{ playerId: player.id, share: 1 }];
      addLog(`${player.name} fusiona ${sourceTile.name} hacia ${targetTile.name}.`);
      refreshSectorDomains();
      break;
    }
    case "franchise":
      ensureOwnedProperty(player.id, payload.targetTileId);
      getPropertyState(payload.targetTileId).franchiseTurns = 2;
      getPropertyState(payload.targetTileId).franchiseCreatedOnTurn = room.turnCounter;
      addLog(`${player.name} convierte ${getTileById(payload.targetTileId).name} en una franquicia temporal.`);
      break;
    case "cyberattack":
      ensureTargetPlayer(payload.targetPlayerId);
      if (handleAttackDefense(payload.targetPlayerId, "Ciberataque")) {
        break;
      }
      getPlayer(payload.targetPlayerId).skipTurns += 1;
      addLog(`${getPlayer(payload.targetPlayerId).name} perdera su siguiente turno.`);
      break;
    case "financial-hack":
      ensureTargetPlayer(payload.targetPlayerId);
      if (handleAttackDefense(payload.targetPlayerId, "Hackeo Financiero")) {
        break;
      }
      spendCredits(payload.targetPlayerId, 100, "Hackeo Financiero");
      awardCredits(player.id, 100, "Hackeo Financiero");
      break;
    case "extreme-audit": {
      ensureTargetPlayer(payload.targetPlayerId);
      if (handleAttackDefense(payload.targetPlayerId, "Auditoria Extrema")) {
        break;
      }
      const targetProperties = getPlayerProperties(payload.targetPlayerId).length;
      if (targetProperties > 3) {
        spendCredits(payload.targetPlayerId, 50, "Auditoria Extrema", { isNegativeEvent: true });
      } else {
        addLog(`${getPlayer(payload.targetPlayerId).name} supera la auditoria sin sancion.`);
      }
      break;
    }
    case "smart-investment":
      ensureOwnedProperty(player.id, payload.targetTileId);
      getPropertyState(payload.targetTileId).nextRentDoubleOwnerId = player.id;
      addLog(`${player.name} duplicara la proxima renta de ${getTileById(payload.targetTileId).name}.`);
      break;

    // ─── NEW CARDS ──────────────────────────────────────────
    case "headhunting": {
      ensureTargetPlayer(payload.targetPlayerId);
      const targetPlayer = getPlayer(payload.targetPlayerId);
      player.copiedPassiveRoleId = targetPlayer.roleId;
      player.copiedPassiveTurn = room.turnCounter + 1; // Lasts for 1 turn
      addLog(`${player.name} usa Headhunting y copia la habilidad pasiva de ${targetPlayer.name} (${targetPlayer.roleId}) por 1 turno.`);
      break;
    }
    case "patente": {
      const sectorName = payload.sectorName;
      if (!SECTORS[sectorName]) {
        throw new Error("Sector no valido.");
      }
      room.sectorPatents[sectorName] = {
        ownerId: player.id,
        remainingRounds: 2,
        createdAtRound: room.round,
      };
      addLog(`${player.name} patenta el sector ${sectorName}. Nadie puede comprar propiedades libres en ese sector por 2 rondas.`);
      break;
    }
    case "startup-boom": {
      const cheapest = getPlayerProperties(player.id).sort((a, b) => a.price - b.price)[0];
      if (!cheapest) {
        throw new Error("Necesitas al menos una propiedad para Startup Boom.");
      }
      player.startupBoomTileId = cheapest.id;
      player.startupBoomUntilRound = room.round + 1;
      addLog(`${player.name} activa Startup Boom en ${cheapest.name}. Genera triple renta por 1 ronda.`);
      break;
    }
    case "data-breach": {
      ensureTargetPlayer(payload.targetPlayerId);
      const target = getPlayer(payload.targetPlayerId);
      if (handleAttackDefense(payload.targetPlayerId, "Data Breach")) {
        break;
      }
      // Reveal hand and discard one card
      if (target.hand.length > 0) {
        // Discard the first card (or a specified one)
        const discardIndex = payload.discardIndex ? clamp(Number(payload.discardIndex), 0, target.hand.length - 1) : 0;
        const discarded = target.hand[discardIndex];
        const discardedCard = getCard(discarded.cardId);
        discardCardInstance(target, discarded.instanceId);
        addLog(`Data Breach: ${target.name} pierde ${discardedCard?.title || "una carta"} de su mano.`);
        // Target draws a new card
        const newCardId = drawCardId();
        if (newCardId) {
          addCardToHand(target.id, newCardId);
        }
      } else {
        addLog(`Data Breach: ${target.name} no tiene cartas en mano.`);
      }
      break;
    }
    case "opa-hostil": {
      if (room.opaHostilUsed[player.id]) {
        throw new Error("Solo puedes usar OPA Hostil una vez por partida.");
      }
      const targetTileId = payload.targetTileId;
      const tile = getTileById(targetTileId);
      if (!tile || tile.kind !== "property") {
        throw new Error("Propiedad objetivo invalida.");
      }
      const property = getPropertyState(targetTileId);
      if (!property || property.owners.length !== 1 || property.owners[0].playerId === player.id) {
        throw new Error("OPA Hostil solo funciona contra propiedades de un unico dueno rival.");
      }
      const targetOwner = getPlayer(property.owners[0].playerId);
      if (handleAttackDefense(targetOwner.id, "OPA Hostil")) {
        room.opaHostilUsed[player.id] = true;
        break;
      }
      const hostilePrice = Math.ceil(tile.price * 1.5);
      spendCredits(player.id, hostilePrice, `OPA Hostil sobre ${tile.name}`);
      awardCredits(targetOwner.id, hostilePrice, `compensacion OPA Hostil por ${tile.name}`);
      property.owners = [{ playerId: player.id, share: 1 }];
      room.opaHostilUsed[player.id] = true;
      addLog(`${player.name} ejecuta OPA Hostil y adquiere ${tile.name} de ${targetOwner.name} por ${formatCredits(hostilePrice)}.`);
      refreshSectorDomains();
      break;
    }
    case "networking-event": {
      // All players gain +2 connections
      room.players.forEach((entry) => gainConnections(entry.id, 2, "Networking Event"));
      addLog(`${player.name} activa Networking Event. Todos ganan +2 conexiones.`);
      break;
    }
    default:
      throw new Error("Carta no soportada.");
  }

  persistRoom();
  broadcastState();
}

function handleAttackDefense(targetPlayerId, attackName) {
  const target = getPlayer(targetPlayerId);
  if (!target || (target.roleId !== "software" && target.copiedPassiveRoleId !== "software")) {
    return false;
  }
  if (target.softwarePassiveReady) {
    target.softwarePassiveReady = false;
    addLog(`${target.name} bloquea ${attackName} con su defensa pasiva.`);
    return true;
  }
  if (target.softwareCancelsLeft > 0) {
    target.softwareCancelsLeft -= 1;
    addLog(`${target.name} cancela ${attackName} con su habilidad activa.`);
    return true;
  }
  return false;
}

function ensureTargetPlayer(playerId) {
  const player = getPlayer(playerId);
  if (!player) {
    throw new Error("Jugador objetivo invalido.");
  }
  return player;
}

function ensureOwnedProperty(playerId, tileId) {
  const property = getPropertyState(tileId);
  if (!property || !property.owners.some((owner) => owner.playerId === playerId)) {
    throw new Error("Debes elegir una propiedad propia.");
  }
  return getTileById(tileId);
}

function ensureSoloOwnedProperty(playerId, tileId) {
  const property = getPropertyState(tileId);
  if (!property || property.owners.length !== 1 || property.owners[0].playerId !== playerId) {
    throw new Error("Debes elegir una propiedad propia sin socios.");
  }
  return getTileById(tileId);
}

function proposeContract(playerId, payload) {
  const actor = ensureCurrentPlayer(playerId);
  if (room.turn.phase !== "negotiation" && room.turn.phase !== "victory_ready") {
    throw new Error("Los contratos solo se crean en la fase B2B.");
  }
  const target = ensureTargetPlayer(payload.targetPlayerId);
  if (target.id === actor.id) {
    throw new Error("No puedes enviarte un contrato a ti mismo.");
  }

  const offerCredits = Math.max(0, Number(payload.offerCredits) || 0);
  const requestCredits = Math.max(0, Number(payload.requestCredits) || 0);
  const offerPropertyId = payload.offerPropertyId || "";
  const requestPropertyId = payload.requestPropertyId || "";
  const offerType = payload.offerType || "commercial";
  const noAttackTurns = clamp(Number(payload.noAttackTurns) || 0, 0, 5);

  if (offerPropertyId) {
    ensureSoloOwnedProperty(actor.id, offerPropertyId);
  }
  if (requestPropertyId) {
    ensureSoloOwnedProperty(target.id, requestPropertyId);
  }

  room.contracts.unshift({
    id: randomCode(10),
    fromPlayerId: actor.id,
    toPlayerId: target.id,
    type: String(payload.type || "Acuerdo B2B").slice(0, 80),
    offerType,
    message: String(payload.message || "").slice(0, 280),
    offerCredits,
    requestCredits,
    offerPropertyId,
    requestPropertyId,
    noAttackTurns,
    createdAt: new Date().toISOString(),
    createdRound: room.round,
    status: "pending",
  });
  room.contracts = room.contracts.slice(0, 40);
  addLog(`${actor.name} envia un contrato a ${target.name}.`);
  persistRoom();
  broadcastState();
}

function expirePendingContracts(reason) {
  const pending = room.contracts.filter((contract) => contract.status === "pending");
  if (!pending.length) {
    return;
  }
  const respondedAt = new Date().toISOString();
  pending.forEach((contract) => {
    contract.status = "expired";
    contract.respondedAt = respondedAt;
    contract.expireReason = reason;
  });
  addLog(`Se vencieron ${pending.length} contrato(s) pendientes por ${reason}.`);
}

function respondContract(playerId, contractId, accept) {
  const contract = room.contracts.find((entry) => entry.id === contractId);
  if (!contract || contract.status !== "pending") {
    throw new Error("Ese contrato ya no esta disponible.");
  }
  if (contract.toPlayerId !== playerId) {
    throw new Error("Ese contrato no te pertenece.");
  }
  if (!["negotiation", "victory_ready"].includes(room.turn.phase)) {
    throw new Error("No hay una ventana B2B activa para responder ese contrato.");
  }
  if (getCurrentPlayer()?.id !== contract.fromPlayerId || contract.createdRound !== room.round) {
    throw new Error("El contrato ya expiro porque termino el turno del emisor.");
  }

  const actor = getPlayer(contract.fromPlayerId);
  const target = getPlayer(contract.toPlayerId);

  if (!accept) {
    contract.status = "rejected";
    contract.respondedAt = new Date().toISOString();
    addLog(`${target.name} rechaza el contrato de ${actor.name}.`);
    persistRoom();
    broadcastState();
    return;
  }

  if (contract.offerCredits > 0 && actor.credits < contract.offerCredits) {
    throw new Error(`${actor.name} ya no tiene creditos suficientes para honrar la oferta.`);
  }
  if (contract.requestCredits > 0 && target.credits < contract.requestCredits) {
    throw new Error("No tienes creditos suficientes para aceptar ese contrato.");
  }
  if (contract.offerPropertyId) {
    ensureSoloOwnedProperty(actor.id, contract.offerPropertyId);
  }
  if (contract.requestPropertyId) {
    ensureSoloOwnedProperty(target.id, contract.requestPropertyId);
  }

  if (contract.offerCredits > 0) {
    spendCredits(actor.id, contract.offerCredits, `contrato con ${target.name}`);
    awardCredits(target.id, contract.offerCredits, `contrato con ${actor.name}`);
  }
  if (contract.requestCredits > 0) {
    spendCredits(target.id, contract.requestCredits, `contrato con ${actor.name}`);
    awardCredits(actor.id, contract.requestCredits, `contrato con ${target.name}`);
  }

  if (contract.offerPropertyId && contract.requestPropertyId) {
    const actorOwners = getPropertyState(contract.offerPropertyId).owners;
    const targetOwners = getPropertyState(contract.requestPropertyId).owners;
    getPropertyState(contract.offerPropertyId).owners = targetOwners;
    getPropertyState(contract.requestPropertyId).owners = actorOwners;
  } else if (contract.offerPropertyId) {
    getPropertyState(contract.offerPropertyId).owners = [{ playerId: target.id, share: 1 }];
  } else if (contract.requestPropertyId) {
    getPropertyState(contract.requestPropertyId).owners = [{ playerId: actor.id, share: 1 }];
  }

  // Term contract: no attack promise
  if (contract.offerType === "term-contract" && contract.noAttackTurns > 0) {
    actor.termContracts.push({ targetId: target.id, turnsRemaining: contract.noAttackTurns });
    target.termContracts.push({ targetId: actor.id, turnsRemaining: contract.noAttackTurns });
    addLog(`${actor.name} y ${target.name} firman un pacto de no agresion por ${contract.noAttackTurns} turnos.`);
  }

  awardContractBonus(actor, target);

  // Track accepted contracts for VP
  room.acceptedContractsCount[actor.id] = (room.acceptedContractsCount[actor.id] || 0) + 1;
  room.acceptedContractsCount[target.id] = (room.acceptedContractsCount[target.id] || 0) + 1;

  contract.status = "accepted";
  contract.respondedAt = new Date().toISOString();
  addLog(`${target.name} acepta el contrato de ${actor.name}.`);

  refreshSectorDomains();
  persistRoom();
  broadcastState();
}

function awardContractBonus(actor, target) {
  awardCredits(actor.id, 50, "trato B2B aceptado");
  awardCredits(target.id, 50, "trato B2B aceptado");
  gainConnections(actor.id, 1, "trato B2B aceptado");
  gainConnections(target.id, 1, "trato B2B aceptado");

  if (actor.roleId === "creative" || actor.copiedPassiveRoleId === "creative") {
    awardCredits(actor.id, 20, "bono creativo");
  }
  if (target.roleId === "creative" || target.copiedPassiveRoleId === "creative") {
    awardCredits(target.id, 20, "bono creativo");
  }

  if (actor.networkingExtraArmed) {
    actor.networkingExtraArmed = false;
    gainConnections(actor.id, 1, "habilidad de Relaciones");
  }
  if (target.networkingExtraArmed) {
    target.networkingExtraArmed = false;
    gainConnections(target.id, 1, "habilidad de Relaciones");
  }
}

function updateProfile(playerId, payload = {}) {
  const player = getPlayer(playerId);
  if (!player) {
    throw new Error("Jugador no encontrado.");
  }

  if (typeof payload.name === "string") {
    player.name = payload.name.trim().slice(0, 24) || player.name;
  }
  if (typeof payload.color === "string" && /^#([0-9A-Fa-f]{6})$/.test(payload.color)) {
    player.color = payload.color;
  }
  if (typeof payload.tokenBadge === "string") {
    player.tokenBadge = payload.tokenBadge.trim().slice(0, 4).toUpperCase() || player.tokenBadge;
  }
  if (typeof payload.avatarId === "string" && CEO_AVATARS.some((avatar) => avatar.id === payload.avatarId)) {
    player.avatarId = payload.avatarId;
  }
  if (room?.status === "lobby" && typeof payload.roleId === "string" && ROLES[payload.roleId]) {
    player.roleId = payload.roleId;
    player.connections = payload.roleId === "relations" ? 2 : 0;
  }
  if (typeof payload.tokenImage === "string") {
    if (payload.tokenImage.length === 0) {
      player.tokenImage = "";
    } else if (payload.tokenImage.startsWith("data:image/") && payload.tokenImage.length <= MAX_TOKEN_IMAGE_CHARS) {
      player.tokenImage = payload.tokenImage;
    }
  }

  player.joinedAt = player.joinedAt || new Date().toISOString();
  player.lastSeenAt = new Date().toISOString();
  persistRoom();
  broadcastState();
}

function getAuth(socket) {
  return socketAuth.get(socket.id) || { mode: "guest", playerId: null, hostAuthorized: false };
}

function setHostAuth(socket) {
  socketAuth.set(socket.id, { mode: "host", playerId: null, hostAuthorized: true });
}

function setPlayerAuth(socket, playerId) {
  socketAuth.set(socket.id, { mode: "player", playerId, hostAuthorized: false });
}

function clearSocketPresence(socket) {
  if (!room) {
    socketAuth.delete(socket.id);
    socketRateBuckets.delete(socket.id);
    return;
  }
  room.players.forEach((player) => {
    player.socketIds = player.socketIds.filter((socketId) => socketId !== socket.id);
    if (player.socketIds.length === 0) {
      player.lastSeenAt = new Date().toISOString();
    }
  });
  socketAuth.delete(socket.id);
  socketRateBuckets.delete(socket.id);
}

function assertSocketRateLimit(socket, eventName) {
  const config = EVENT_RATE_LIMITS[eventName];
  if (!config) {
    return;
  }

  const now = Date.now();
  let socketBucket = socketRateBuckets.get(socket.id);
  if (!socketBucket) {
    socketBucket = new Map();
    socketRateBuckets.set(socket.id, socketBucket);
  }

  let eventBucket = socketBucket.get(eventName);
  if (!eventBucket || now - eventBucket.windowStart >= config.windowMs) {
    eventBucket = {
      windowStart: now,
      count: 0,
    };
    socketBucket.set(eventName, eventBucket);
  }

  eventBucket.count += 1;
  if (eventBucket.count > config.limit) {
    throw new Error("Demasiadas solicitudes. Espera unos segundos e intenta de nuevo.");
  }
}

function joinPlayerByToken(socket, joinToken) {
  if (!room) {
    throw new Error("No hay una sesion activa.");
  }
  const player = room.players.find((entry) => entry.joinToken === joinToken);
  if (!player) {
    throw new Error("Ese enlace de jugador ya no es valido.");
  }
  player.joinedAt = player.joinedAt || new Date().toISOString();
  player.lastSeenAt = new Date().toISOString();
  if (!player.socketIds.includes(socket.id)) {
    player.socketIds.push(socket.id);
  }
  setPlayerAuth(socket, player.id);
  persistRoom();
  broadcastState();
}

function hostJoinLinks() {
  if (!room) {
    return [];
  }
  const baseUrls = getFrontendBaseUrls();
  const preferredBase = baseUrls.find((url) => !url.includes("localhost")) || baseUrls[0];
  const backendQuery = `backend=${encodeURIComponent(getPublicBackendBaseUrl())}`;
  return room.players.map((player) => ({
    playerId: player.id,
    seatNumber: player.seatNumber,
    name: player.name,
    url: `${preferredBase}/?join=${player.joinToken}&${backendQuery}`,
    altUrls: baseUrls.map((base) => `${base}/?join=${player.joinToken}&${backendQuery}`),
  }));
}

function serializePublicPlayer(player, viewerPlayerId) {
  const role = getRole(player.roleId);
  const isSelf = viewerPlayerId === player.id;
  const vpData = calculateVenturePoints(player.id);
  return {
    id: player.id,
    seatNumber: player.seatNumber,
    name: player.name,
    roleId: player.roleId,
    color: player.color,
    tokenBadge: player.tokenBadge,
    tokenImage: player.tokenImage,
    avatarId: player.avatarId,
    roleName: role.name,
    roleSector: role.sector,
    position: player.position,
    credits: player.credits,
    connections: player.connections,
    skipTurns: player.skipTurns,
    connected: player.socketIds.length > 0,
    joined: Boolean(player.joinedAt),
    propertyIds: getPlayerProperties(player.id).map((tile) => tile.id),
    handCount: player.hand.length,
    strategicDiceUsed: player.strategicDiceUsed,
    creativeExtendReady: player.creativeExtendReady,
    financialDoubleReady: player.financialDoubleReady,
    networkingExtraReady: player.networkingExtraReady,
    industrialRemoteBuyUsed: player.industrialRemoteBuyUsed,
    energyRentDiscountReady: player.energyRentDiscountReady,
    // New fields
    venturePoints: vpData.total,
    vpBreakdown: vpData.breakdown,
    rivalId: player.rivalRevealed ? player.rivalId : null,
    rivalRevealed: player.rivalRevealed,
    rivalDefeated: player.rivalDefeated,
    hasRivalDeclared: player.rivalId !== null,
    loans: player.loans,
    collaterals: player.collaterals,
    dominatedSectors: getDominatedSectorsByPlayer(player.id),
  };
}

function serializeRoomFor(socket) {
  const auth = getAuth(socket);
  const viewerPlayer = auth.playerId ? getPlayer(auth.playerId) : null;
  const currentPlayer = room ? getCurrentPlayer() : null;

  if (!room) {
    return {
      mode: auth.hostAuthorized ? "host" : "landing",
      session: null,
      host: {
        urls: getBaseUrls(PORT),
      },
    };
  }

  const publicPlayers = room.players.map((player) => serializePublicPlayer(player, auth.playerId));
  const tiles = TILES.map((tile) => ({
    ...tile,
    owners: tile.kind === "property" ? getPropertyState(tile.id).owners : [],
    protectedTurns: tile.kind === "property" ? getPropertyState(tile.id).protectedTurns : 0,
    franchiseTurns: tile.kind === "property" ? getPropertyState(tile.id).franchiseTurns : 0,
  }));

  const session = {
    id: room.sessionId,
    status: room.status,
    round: room.round,
    turnCounter: room.turnCounter,
    currentPlayerId: currentPlayer?.id || null,
    currentPlayerName: currentPlayer?.name || null,
    winnerId: room.winnerId,
    log: room.log,
    activeEvent: room.activeEvent,
    turn: room.turn,
    players: publicPlayers,
    tiles,
    boardPoints: BOARD_POINTS,
    freePropertyIds: getFreeProperties().map((tile) => tile.id),
    contractsSummary: room.contracts.slice(0, 20).map((contract) => ({
      id: contract.id,
      fromPlayerId: contract.fromPlayerId,
      toPlayerId: contract.toPlayerId,
      type: contract.type,
      offerType: contract.offerType,
      status: contract.status,
      createdAt: contract.createdAt,
    })),
    // New systems
    marketIndex: room.marketIndex,
    sectorDomains: room.sectorDomains,
    sectorPatents: room.sectorPatents,
    sectors: SECTORS,
    vpTable: VP_TABLE,
    b2bOfferTypes: B2B_OFFER_TYPES,
  };

  const payload = {
    mode: auth.hostAuthorized ? "host" : auth.playerId ? "player" : "guest",
    session,
    host: {
      urls: getFrontendBaseUrls(),
      backendUrls: getBaseUrls(PORT),
      canCreate: true,
      loginRequired: true,
      defaultUsername: HOST_LOGIN_USERNAME,
      isAuthenticated: auth.hostAuthorized,
      joinLinks: auth.hostAuthorized ? hostJoinLinks() : [],
    },
    catalog: {
      roles: Object.values(ROLES),
      cards: CARD_LIBRARY,
      avatars: CEO_AVATARS,
      tokenBadges: TOKEN_BADGES,
      sectors: SECTORS,
    },
    self: null,
  };

  if (viewerPlayer) {
    const selfVP = calculateVenturePoints(viewerPlayer.id);
    payload.self = {
      id: viewerPlayer.id,
      joinToken: viewerPlayer.joinToken,
      isCurrentPlayer: currentPlayer?.id === viewerPlayer.id,
      role: getRole(viewerPlayer.roleId),
      hand: viewerPlayer.hand.map((cardInstance) => ({
        instanceId: cardInstance.instanceId,
        ...getCard(cardInstance.cardId),
      })),
      previewCard:
        viewerPlayer.roleId === "strategic" && room.deck[0]
          ? getCard(room.deck[0])
          : null,
      incomingContracts: room.contracts.filter(
        (contract) => contract.toPlayerId === viewerPlayer.id && contract.status === "pending",
      ),
      outgoingContracts: room.contracts.filter(
        (contract) => contract.fromPlayerId === viewerPlayer.id && contract.status === "pending",
      ),
      properties: getPlayerProperties(viewerPlayer.id),
      soloProperties: getSoloOwnedProperties(viewerPlayer.id),
      canBuildTower: canBuildTower(viewerPlayer),
      venturePoints: selfVP.total,
      vpBreakdown: selfVP.breakdown,
      // Rivalry
      rivalId: viewerPlayer.rivalId,
      rivalRevealed: viewerPlayer.rivalRevealed,
      rivalDefeated: viewerPlayer.rivalDefeated,
      // Bankruptcy
      loans: viewerPlayer.loans,
      collaterals: viewerPlayer.collaterals,
      // Sectors
      dominatedSectors: getDominatedSectorsByPlayer(viewerPlayer.id),
      acceptedContracts: room.acceptedContractsCount?.[viewerPlayer.id] || 0,
    };
  }

  return payload;
}

function broadcastState() {
  for (const socket of io.sockets.sockets.values()) {
    socket.emit("state:update", serializeRoomFor(socket));
  }
}

io.on("connection", (socket) => {
  socket.emit("state:update", serializeRoomFor(socket));

  socket.on("host:login", ({ username, password } = {}) => {
    try {
      assertSocketRateLimit(socket, "host:login");
      const providedUsername = String(username || "").trim();
      const providedPassword = String(password || "");
      if (providedUsername !== HOST_LOGIN_USERNAME || providedPassword !== HOST_LOGIN_PASSWORD) {
        throw new Error("Usuario o contrasena de host invalidos.");
      }
      setHostAuth(socket);
      socket.emit("toast", { type: "success", message: "Sesion de host iniciada." });
      socket.emit("state:update", serializeRoomFor(socket));
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("host:logout", () => {
    try {
      assertSocketRateLimit(socket, "host:logout");
      socketAuth.delete(socket.id);
      socket.emit("toast", { type: "success", message: "Sesion de host cerrada." });
      socket.emit("state:update", serializeRoomFor(socket));
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("host:create-session", ({ playerCount }) => {
    try {
      assertSocketRateLimit(socket, "host:create-session");
      const auth = getAuth(socket);
      if (!auth.hostAuthorized) {
        throw new Error("Debes iniciar sesion de host para crear o reemplazar sesiones.");
      }
      const created = createSession(playerCount);
      setHostAuth(socket);
      socket.emit("session:created", { ok: true, sessionId: created.sessionId });
      broadcastState();
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("host:reset-session", () => {
    try {
      assertSocketRateLimit(socket, "host:reset-session");
      const auth = getAuth(socket);
      if (!auth.hostAuthorized) {
        throw new Error("Solo el host puede reiniciar la sesion.");
      }
      room = null;
      persistRoom();
      broadcastState();
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("host:start-game", () => {
    try {
      assertSocketRateLimit(socket, "host:start-game");
      const auth = getAuth(socket);
      if (!auth.hostAuthorized || !room) {
        throw new Error("Solo el host puede iniciar.");
      }
      if (room.status !== "lobby") {
        throw new Error("La partida ya fue iniciada.");
      }
      if (room.players.some((player) => !player.joinedAt)) {
        throw new Error("Aun faltan jugadores por entrar con su enlace.");
      }
      resetGameplayState();
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("host:update-seat-role", ({ playerId, roleId }) => {
    try {
      assertSocketRateLimit(socket, "host:update-seat-role");
      const auth = getAuth(socket);
      if (!auth.hostAuthorized || !room || room.status !== "lobby") {
        throw new Error("Solo puedes editar roles en lobby.");
      }
      if (!ROLES[roleId]) {
        throw new Error("Rol no valido.");
      }
      const seat = getPlayer(playerId);
      if (!seat) {
        throw new Error("No existe ese asiento.");
      }
      seat.roleId = roleId;
      seat.connections = roleId === "relations" ? 2 : 0;
      persistRoom();
      broadcastState();
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("player:join", ({ joinToken }) => {
    try {
      assertSocketRateLimit(socket, "player:join");
      joinPlayerByToken(socket, joinToken);
      socket.emit("joined", { joinToken });
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("player:update-profile", (payload) => {
    try {
      assertSocketRateLimit(socket, "player:update-profile");
      const auth = getAuth(socket);
      if (!auth.playerId) {
        throw new Error("Debes entrar con tu enlace de jugador.");
      }
      updateProfile(auth.playerId, payload);
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("player:action", ({ action, payload }) => {
    try {
      assertSocketRateLimit(socket, "player:action");
      const auth = getAuth(socket);
      if (!auth.playerId) {
        throw new Error("Debes entrar con tu enlace de jugador.");
      }
      runTurnAction(auth.playerId, action, payload);
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("contract:propose", (payload) => {
    try {
      assertSocketRateLimit(socket, "contract:propose");
      const auth = getAuth(socket);
      if (!auth.playerId) {
        throw new Error("Debes entrar con tu enlace de jugador.");
      }
      proposeContract(auth.playerId, payload);
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("contract:respond", ({ contractId, accept }) => {
    try {
      assertSocketRateLimit(socket, "contract:respond");
      const auth = getAuth(socket);
      if (!auth.playerId) {
        throw new Error("Debes entrar con tu enlace de jugador.");
      }
      respondContract(auth.playerId, contractId, Boolean(accept));
    } catch (error) {
      socket.emit("toast", { type: "error", message: error.message });
    }
  });

  socket.on("disconnect", () => {
    clearSocketPresence(socket);
    persistRoom();
    broadcastState();
  });
});
