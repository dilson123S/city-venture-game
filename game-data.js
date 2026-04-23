const BOARD_POINTS = [
  { x: 12.5, y: 87.5 },
  { x: 25, y: 87.5 },
  { x: 37.5, y: 87.5 },
  { x: 50, y: 87.5 },
  { x: 62.5, y: 87.5 },
  { x: 75, y: 87.5 },
  { x: 87.5, y: 87.5 },
  { x: 87.5, y: 75 },
  { x: 87.5, y: 62.5 },
  { x: 87.5, y: 50 },
  { x: 87.5, y: 37.5 },
  { x: 87.5, y: 25 },
  { x: 87.5, y: 12.5 },
  { x: 75, y: 12.5 },
  { x: 62.5, y: 12.5 },
  { x: 50, y: 12.5 },
  { x: 37.5, y: 12.5 },
  { x: 25, y: 12.5 },
  { x: 12.5, y: 12.5 },
  { x: 12.5, y: 25 },
  { x: 12.5, y: 37.5 },
  { x: 12.5, y: 50 },
  { x: 12.5, y: 62.5 },
  { x: 12.5, y: 75 },
];

const TILES = [
  { id: "start", index: 0, name: "🏁 Salida", kind: "start", description: "Gana 100 monedas al pasar." },
  { id: "solar", index: 1, name: "Planta Solar", kind: "property", sector: "Energia", price: 100, baseRent: 20 },
  { id: "batteries", index: 2, name: "Fabrica de Robots", kind: "property", sector: "Energia", price: 120, baseRent: 24 },
  { id: "card-north", index: 3, name: "🃏 Carta Suerte", kind: "connect", description: "Roba una Carta Suerte." },
  { id: "drones", index: 4, name: "Drones Veloces", kind: "property", sector: "Logistica", price: 130, baseRent: 26 },
  { id: "autonomous", index: 5, name: "Taxi Volador", kind: "property", sector: "Logistica", price: 150, baseRent: 30 },
  { id: "urban-tax", index: 6, name: "💸 Multa!", kind: "tax", amount: 50, description: "Pierdes 50 monedas." },
  { id: "app", index: 7, name: "App Viral", kind: "property", sector: "Software", price: 160, baseRent: 32 },
  { id: "database", index: 8, name: "Servidor Secreto", kind: "property", sector: "Software", price: 180, baseRent: 36 },
  { id: "card-east", index: 9, name: "🃏 Carta Suerte", kind: "connect", description: "Roba una Carta Suerte." },
  { id: "agency", index: 10, name: "Estudio de Memes", kind: "property", sector: "Creativo", price: 190, baseRent: 38 },
  { id: "studio", index: 11, name: "Canal de Videos", kind: "property", sector: "Creativo", price: 210, baseRent: 42 },
  { id: "audit", index: 12, name: "🕳️ Trampa!", kind: "audit", description: "Caiste en una trampa, pierdes 1 turno." },
  { id: "grid", index: 13, name: "Torre de Energia", kind: "property", sector: "Energia", price: 220, baseRent: 44 },
  { id: "smart-energy", index: 14, name: "Reactor Futurista", kind: "property", sector: "Energia", price: 240, baseRent: 48 },
  { id: "card-south", index: 15, name: "🃏 Carta Suerte", kind: "connect", description: "Roba una Carta Suerte." },
  { id: "distribution", index: 16, name: "Almacen Gigante", kind: "property", sector: "Logistica", price: 250, baseRent: 50 },
  { id: "global-logistics", index: 17, name: "Nave Espacial", kind: "property", sector: "Logistica", price: 270, baseRent: 54 },
  { id: "subsidy", index: 18, name: "🎁 Premio Secreto", kind: "subsidy", amount: 100, description: "Ganas 100 monedas!" },
  { id: "ai", index: 19, name: "IA Superpoderosa", kind: "property", sector: "Software", price: 280, baseRent: 56 },
  { id: "cybersecurity", index: 20, name: "Escudo Digital", kind: "property", sector: "Software", price: 300, baseRent: 60 },
  { id: "card-west", index: 21, name: "🃏 Carta Suerte", kind: "connect", description: "Roba una Carta Suerte." },
  { id: "production", index: 22, name: "Estudio Viral", kind: "property", sector: "Creativo", price: 320, baseRent: 64 },
  { id: "global-brand", index: 23, name: "Marca Legendaria", kind: "property", sector: "Creativo", price: 340, baseRent: 68 },
];

const SECTORS = {
  Energia: ["solar", "batteries", "grid", "smart-energy"],
  Logistica: ["drones", "autonomous", "distribution", "global-logistics"],
  Software: ["app", "database", "ai", "cybersecurity"],
  Creativo: ["agency", "studio", "production", "global-brand"],
};

const ROLE_ORDER = [
  "energy",
  "software",
  "logistics",
  "creative",
  "financial",
  "strategic",
  "relations",
  "industrial",
];

const ROLES = {
  energy: {
    id: "energy",
    name: "⚡ El Energizador",
    emoji: "⚡",
    sector: "Energia",
    theme: "from-cyan",
    passive: "Pagas 20 monedas menos en multas y trampas.",
    active: "Una vez por turno pagas solo la MITAD de una renta.",
    superpower: "Escudo de Energía",
    superpowerEmoji: "🛡️",
  },
  software: {
    id: "software",
    name: "💻 El Hacker",
    emoji: "💻",
    sector: "Software",
    theme: "from-indigo",
    passive: "Bloqueas el primer ataque que recibas GRATIS.",
    active: "Tienes 2 escudos que pueden bloquear ataques de cartas.",
    superpower: "Anti-Hackeo",
    superpowerEmoji: "🔐",
  },
  logistics: {
    id: "logistics",
    name: "🚀 El Velocista",
    emoji: "🚀",
    sector: "Logistica",
    theme: "from-sky",
    passive: "Siempre avanzas 1 casilla extra al lanzar el dado.",
    active: "Una vez por turno puedes ajustar tu ruta 1 casilla.",
    superpower: "Turbo Boost",
    superpowerEmoji: "💨",
  },
  creative: {
    id: "creative",
    name: "🎨 El Influencer",
    emoji: "🎨",
    sector: "Creativo",
    theme: "from-rose",
    passive: "Ganas 20 monedas extra por cada alianza aceptada.",
    active: "Puedes extender el Mercado Negro 30 segundos.",
    superpower: "Viral Boost",
    superpowerEmoji: "🌟",
  },
  financial: {
    id: "financial",
    name: "💰 El Millonario",
    emoji: "💰",
    sector: "Capital",
    theme: "from-amber",
    passive: "Recibes 10% extra en TODOS tus ingresos.",
    active: "Una vez por turno duplicas tu siguiente ingreso.",
    superpower: "Lluvia de Dinero",
    superpowerEmoji: "🤑",
  },
  strategic: {
    id: "strategic",
    name: "🧠 El Genio",
    emoji: "🧠",
    sector: "Planeacion",
    theme: "from-glass",
    passive: "Ves la siguiente Carta Suerte antes de robarla.",
    active: "Una vez en el juego puedes elegir el numero de tu dado.",
    superpower: "Dado Cargado",
    superpowerEmoji: "🎲",
  },
  relations: {
    id: "relations",
    name: "🤝 El Popular",
    emoji: "🤝",
    sector: "Networking",
    theme: "from-lime",
    passive: "Empiezas con 2 conexiones adicionales.",
    active: "Una vez por turno ganas 1 conexion extra al cerrar un trato.",
    superpower: "Red de Amigos",
    superpowerEmoji: "👥",
  },
  industrial: {
    id: "industrial",
    name: "🤖 El Robot",
    emoji: "🤖",
    sector: "Expansion",
    theme: "from-orange",
    passive: "Pagas 20% menos al comprar propiedades.",
    active: "Una vez en el juego puedes comprar una propiedad desde cualquier casilla.",
    superpower: "Compra Remota",
    superpowerEmoji: "📡",
  },
};

// 28 cartas — Ataque(8), Suerte(8), Trampa(6), Evento(6)
const CARD_LIBRARY = [
  // --- ATAQUE (8) — ¡Fastidia a tus amigos! ---
  { id: "financial-hack",    title: "💸 ¡Hackeo!",           category: "Ataque",  text: "Roba 100 monedas directamente de la billetera de un rival.", target: "player" },
  { id: "cyberattack",       title: "😴 Dormilón",           category: "Ataque",  text: "Un jugador se queda dormido y pierde su siguiente turno.", target: "player" },
  { id: "data-breach",       title: "👁️ Espía",              category: "Ataque",  text: "Mira las cartas de un rival y descarta 1 de las suyas.", target: "player" },
  { id: "opa-hostil",        title: "😈 Robo Forzado",       category: "Ataque",  text: "Compra una propiedad rival a la fuerza pagando 1.5x su precio.", target: "hostile-takeover" },
  { id: "exclusive-contract",title: "🚫 Zona Prohibida",    category: "Ataque",  text: "Un rival paga renta DOBLE la próxima vez que caiga en tu propiedad.", target: "player" },
  { id: "extreme-audit",     title: "🕵️ Inspector",         category: "Ataque",  text: "Si un rival tiene más de 3 propiedades, pierde 100 monedas.", target: "player" },
  { id: "headhunting",       title: "🎭 Disfraz",            category: "Ataque",  text: "Copias el superpoder de un rival durante 1 turno.", target: "player" },
  { id: "outsourcing",       title: "🙃 Trampolín",          category: "Ataque",  text: "Obliga a un rival a pagar tu próxima deuda.", target: "player" },

  // --- SUERTE (8) — ¡Genial para ti! ---
  { id: "resource-optimization", title: "🎉 Día Gratis",    category: "Suerte",  text: "La próxima renta que pagues es GRATIS.", target: "self", immediate: true },
  { id: "premium-connection",    title: "💎 Jackpot",        category: "Suerte",  text: "Ganas 100 monedas y 1 conexión ahora mismo.", target: "self", immediate: true },
  { id: "business-subsidy",      title: "🏦 Préstamo",       category: "Suerte",  text: "Recibes 150 monedas del banco.", target: "self", immediate: true },
  { id: "rapid-expansion",       title: "✈️ Teletransporte", category: "Suerte",  text: "Avanzas 3 casillas ahora mismo.", target: "self", immediate: true },
  { id: "startup-boom",          title: "🚀 Boom!",          category: "Suerte",  text: "Tu propiedad más barata genera TRIPLE renta por 1 ronda.", target: "self", immediate: true },
  { id: "smart-investment",      title: "📈 Inversión",      category: "Suerte",  text: "Tu próxima propiedad genera renta doble.", target: "owned-property" },
  { id: "franchise",             title: "⭐ Franquicia",     category: "Suerte",  text: "Duplica la renta de una propiedad tuya por 2 turnos.", target: "owned-property" },
  { id: "tech-innovation",       title: "🔒 Escudo",         category: "Suerte",  text: "Protege una propiedad tuya durante 2 turnos.", target: "owned-property" },

  // --- TRAMPA (6) — ¡Oh no, mala suerte! ---
  { id: "economic-crisis",  title: "💀 Crisis Total",        category: "Trampa",  text: "¡Todos pierden 50 monedas! Nadie se salva.", target: "global", immediate: true },
  { id: "patente",           title: "🚷 Zona Bloqueada",     category: "Trampa",  text: "Nadie puede comprar propiedades de un sector por 2 rondas.", target: "sector" },
  { id: "merge",             title: "🔀 Intercambio",        category: "Trampa",  text: "Cambias una propiedad tuya por una libre de mayor valor pagando la diferencia.", target: "merge" },
  { id: "joint-venture",     title: "🤝 Sociedad Forzada",  category: "Trampa",  text: "Compra una propiedad libre junto a otro jugador y la comparten.", target: "joint-venture" },
  { id: "strategic-alliance",title: "🤜 Alianza",           category: "Trampa",  text: "Tú y otro jugador ganan 1 conexión cada uno.", target: "player" },
  { id: "networking-event", title: "🎊 Fiesta!",            category: "Trampa",  text: "¡Todos ganan 2 conexiones! Requiere acuerdo de la mayoría.", target: "global", immediate: true },

  // --- EVENTO GLOBAL (6) — Cambia las reglas del juego ---
  { id: "market-boom",       title: "🔥 Mercado en llamas", category: "Evento",  text: "Las rentas se DUPLICAN para todos por 1 ronda.", target: "global", immediate: true },
  { id: "global-innovation", title: "🌍 Innovación Global", category: "Evento",  text: "Todos ganan 1 conexión.", target: "global", immediate: true },
];

// Reemplaza GLOBAL_EVENTS — ahora el Índice de Mercado
const MARKET_INDEX_TABLE = [
  { roll: [1, 2], id: "recession", name: "Recesion", multiplier: 0.8, description: "Rentas -20%. El mercado esta en recesion." },
  { roll: [3, 4], id: "stable", name: "Estable", multiplier: 1.0, description: "Rentas normales. Mercado estable." },
  { roll: [5, 6], id: "boom", name: "Auge", multiplier: 1.3, description: "Rentas +30%. El mercado esta en auge." },
];

// Mantener para backwards compat
const GLOBAL_EVENTS = [
  { id: "city-crisis", name: "Crisis Urbana", description: "Todos los jugadores pierden 70 creditos por una caida del mercado." },
  { id: "market-boom", name: "Boom del Mercado", description: "Todas las rentas se duplican hasta la proxima ronda." },
  { id: "innovation-wave", name: "Ola de Innovacion", description: "Las Connect Cards positivas entregan 50 creditos extra por 1 ronda." },
];

const VP_TABLE = {
  creditsPerVP: 500,      // cada 500 créditos = +1 VP
  maxCreditsVP: 4,        // máximo 4 VP por créditos
  connectionsPerVP: 1,    // cada conexión activa = +1 VP
  maxConnectionsVP: 5,    // máximo 5 VP por conexiones
  sectorDominationVP: 2,  // dominar un sector completo = +2 VP
  ventureTowerVP: 3,      // construir Venture Tower = +3 VP
  ventureTowerMinVP: 6,   // necesitas 6+ VP para construir Tower
  rivalryVP: 1,           // ganar rivalidad = +1 VP
  b2bContractsVP: 1,      // cerrar 3+ contratos B2B = +1 VP
  b2bContractsNeeded: 3,  // contratos necesarios para VP
  victoryVP: 10,          // victoria a 10 VP
  conquestSectors: 3,     // dominación de 3 sectores = victoria alternativa
  networkMagnateConnections: 8, // 8+ conexiones = victoria alternativa
};

const B2B_OFFER_TYPES = [
  { id: "commercial", name: "Acuerdo Comercial", description: "Creditos por creditos", components: "credits-credits", bonus: "+1 conexion" },
  { id: "property-pact", name: "Pacto de Propiedad", description: "Propiedad por propiedad o creditos", components: "property-mixed", bonus: "+1 conexion" },
  { id: "network-alliance", name: "Alianza de Red", description: "Conexion por proteccion o ventaja", components: "connection-protection", bonus: "+50 creditos bono de amistad" },
  { id: "term-contract", name: "Contrato a Plazo", description: "Promesa de no atacar por N turnos", components: "promise", bonus: "Romperlo cuesta 100 creditos penalizacion" },
];

const TOKEN_COLORS = ["#55efff", "#44f0c7", "#86a8ff", "#ff9ac7", "#ffcc6e", "#ff7f78"];

const TOKEN_BADGES = ["CV", "AI", "DX", "HQ", "VC", "GT", "NX", "LX", "PX", "QF"];

const CEO_AVATARS = [
  { id: "city-architect", name: "City Architect", badge: "CA", accent: "#55efff" },
  { id: "deal-maker", name: "Deal Maker", badge: "DM", accent: "#44f0c7" },
  { id: "market-hunter", name: "Market Hunter", badge: "MH", accent: "#ff9ac7" },
  { id: "data-chief", name: "Data Chief", badge: "DC", accent: "#86a8ff" },
  { id: "venture-pilot", name: "Venture Pilot", badge: "VP", accent: "#ffcc6e" },
  { id: "network-forge", name: "Network Forge", badge: "NF", accent: "#d0ff8e" },
  { id: "urban-strategist", name: "Urban Strategist", badge: "US", accent: "#b8f4ff" },
  { id: "capital-shaper", name: "Capital Shaper", badge: "CS", accent: "#ffb86b" },
];

module.exports = {
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
};
