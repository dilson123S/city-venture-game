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
  { id: "start", index: 0, name: "Start", kind: "start", description: "Gana 100 creditos al pasar." },
  { id: "solar", index: 1, name: "Planta Solar", kind: "property", sector: "Energia", price: 100, baseRent: 20 },
  { id: "batteries", index: 2, name: "Baterias Inteligentes", kind: "property", sector: "Energia", price: 120, baseRent: 24 },
  { id: "card-north", index: 3, name: "Connect Card", kind: "connect", description: "Roba una carta Connect." },
  { id: "drones", index: 4, name: "Drones de Entrega", kind: "property", sector: "Logistica", price: 130, baseRent: 26 },
  { id: "autonomous", index: 5, name: "Transporte Autonomo", kind: "property", sector: "Logistica", price: 150, baseRent: 30 },
  { id: "urban-tax", index: 6, name: "Impuesto Urbano", kind: "tax", amount: 50, description: "Pierdes 50 creditos." },
  { id: "app", index: 7, name: "App Movil", kind: "property", sector: "Software", price: 160, baseRent: 32 },
  { id: "database", index: 8, name: "Base de Datos", kind: "property", sector: "Software", price: 180, baseRent: 36 },
  { id: "card-east", index: 9, name: "Connect Card", kind: "connect", description: "Roba una carta Connect." },
  { id: "agency", index: 10, name: "Agencia Publicitaria", kind: "property", sector: "Creativo", price: 190, baseRent: 38 },
  { id: "studio", index: 11, name: "Estudio de Diseno", kind: "property", sector: "Creativo", price: 210, baseRent: 42 },
  { id: "audit", index: 12, name: "Auditoria Empresarial", kind: "audit", description: "Pierdes 1 turno." },
  { id: "grid", index: 13, name: "Red Electrica", kind: "property", sector: "Energia", price: 220, baseRent: 44 },
  { id: "smart-energy", index: 14, name: "Energia Inteligente", kind: "property", sector: "Energia", price: 240, baseRent: 48 },
  { id: "card-south", index: 15, name: "Connect Card", kind: "connect", description: "Roba una carta Connect." },
  { id: "distribution", index: 16, name: "Centro de Distribucion", kind: "property", sector: "Logistica", price: 250, baseRent: 50 },
  { id: "global-logistics", index: 17, name: "Logistica Global", kind: "property", sector: "Logistica", price: 270, baseRent: 54 },
  { id: "subsidy", index: 18, name: "Subsidio del Gobierno", kind: "subsidy", amount: 100, description: "Ganas 100 creditos." },
  { id: "ai", index: 19, name: "Inteligencia Artificial", kind: "property", sector: "Software", price: 280, baseRent: 56 },
  { id: "cybersecurity", index: 20, name: "Ciberseguridad", kind: "property", sector: "Software", price: 300, baseRent: 60 },
  { id: "card-west", index: 21, name: "Connect Card", kind: "connect", description: "Roba una carta Connect." },
  { id: "production", index: 22, name: "Productora Digital", kind: "property", sector: "Creativo", price: 320, baseRent: 64 },
  { id: "global-brand", index: 23, name: "Marca Global", kind: "property", sector: "Creativo", price: 340, baseRent: 68 },
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
    name: "CEO de Energia",
    sector: "Energia",
    theme: "from-cyan",
    passive: "Paga 20 creditos menos en impuestos y eventos negativos.",
    active: "Una vez por turno puede pagar solo la mitad de una renta.",
  },
  software: {
    id: "software",
    name: "CEO de Software",
    sector: "Software",
    theme: "from-indigo",
    passive: "Bloquea el primer ataque que recibe y conserva 2 cancelaciones activas.",
    active: "Sus dos cancelaciones pueden anular ataques posteriores.",
  },
  logistics: {
    id: "logistics",
    name: "CEO de Logistica",
    sector: "Logistica",
    theme: "from-sky",
    passive: "Siempre avanza una casilla adicional.",
    active: "Una vez por turno puede ajustar la ruta en 1 casilla.",
  },
  creative: {
    id: "creative",
    name: "CEO Creativo",
    sector: "Creativo",
    theme: "from-rose",
    passive: "Gana 20 creditos extra por cada contrato aceptado.",
    active: "Puede extender la ventana B2B 30 segundos una vez por turno.",
  },
  financial: {
    id: "financial",
    name: "CEO Financiero",
    sector: "Capital",
    theme: "from-amber",
    passive: "Recibe 10 por ciento extra en todos sus ingresos.",
    active: "Una vez por turno duplica su siguiente ingreso.",
  },
  strategic: {
    id: "strategic",
    name: "CEO Estrategico",
    sector: "Planeacion",
    theme: "from-glass",
    passive: "Ve la siguiente Connect Card antes de robar.",
    active: "Una vez por partida fija el valor de su dado principal.",
  },
  relations: {
    id: "relations",
    name: "CEO de Relaciones",
    sector: "Networking",
    theme: "from-lime",
    passive: "Empieza con 2 conexiones adicionales.",
    active: "Una vez por turno gana una conexion extra al cerrar un trato.",
  },
  industrial: {
    id: "industrial",
    name: "CEO Industrial",
    sector: "Expansion",
    theme: "from-orange",
    passive: "Paga 20 por ciento menos al comprar propiedades.",
    active: "Una vez por partida puede comprar una propiedad libre desde cualquier casilla.",
  },
};

// 24 cartas totales — Estrategia(4), Alianza(4), Expansion(4), Ataque(5), Economia(4), Evento(3)
const CARD_LIBRARY = [
  // --- Estrategia (4) ---
  { id: "outsourcing", title: "Outsourcing", category: "Estrategia", text: "Otro jugador paga tu proxima deuda.", target: "player" },
  { id: "tech-innovation", title: "Innovacion Tecnologica", category: "Estrategia", text: "Protege una propiedad tuya durante 2 turnos.", target: "owned-property" },
  { id: "resource-optimization", title: "Optimizacion de Recursos", category: "Estrategia", text: "La proxima renta que pagues costara la mitad.", target: "self", immediate: true },
  { id: "headhunting", title: "Headhunting", category: "Estrategia", text: "Copia la habilidad pasiva de un rival durante 1 turno. No puedes usarla el mismo turno que la robas.", target: "player" },

  // --- Alianza (4) ---
  { id: "joint-venture", title: "Joint Venture", category: "Alianza", text: "Compra una propiedad libre con otro jugador.", target: "joint-venture" },
  { id: "strategic-alliance", title: "Alianza Estrategica", category: "Alianza", text: "Tu y otro jugador ganan una conexion.", target: "player" },
  { id: "exclusive-contract", title: "Contrato Exclusivo", category: "Alianza", text: "Un rival pagara renta doble en tu siguiente propiedad.", target: "player" },
  { id: "networking-event", title: "Networking Event", category: "Alianza", text: "Todos los jugadores ganan +2 conexiones. Requiere consenso mayoritario.", target: "global", immediate: true },

  // --- Expansion (4) ---
  { id: "merge", title: "Fusion", category: "Expansion", text: "Cambias una propiedad tuya por una libre de mayor valor pagando la diferencia.", target: "merge" },
  { id: "rapid-expansion", title: "Expansion Rapida", category: "Expansion", text: "Avanza 3 casillas ahora mismo.", target: "self", immediate: true },
  { id: "franchise", title: "Franquicia", category: "Expansion", text: "Duplica los ingresos de una propiedad durante 2 turnos.", target: "owned-property" },
  { id: "patente", title: "Patente", category: "Expansion", text: "Protege un sector completo: nadie puede comprar propiedades en ese sector durante 2 rondas. Solo afecta propiedades sin dueno.", target: "sector" },

  // --- Ataque (5) ---
  { id: "cyberattack", title: "Ciberataque", category: "Ataque", text: "Un jugador pierde su siguiente turno.", target: "player" },
  { id: "financial-hack", title: "Hackeo Financiero", category: "Ataque", text: "Roba 100 creditos a un rival.", target: "player" },
  { id: "extreme-audit", title: "Auditoria Extrema", category: "Ataque", text: "Un jugador pierde 50 creditos si controla mas de 3 propiedades.", target: "player" },
  { id: "data-breach", title: "Data Breach", category: "Ataque", text: "Obliga a un jugador a mostrar su mano. Puedes descartar 1 de sus cartas. El afectado roba una nueva.", target: "player" },
  { id: "opa-hostil", title: "OPA Hostil", category: "Ataque", text: "Compra forzada: paga 1.5x el precio base de una propiedad rival y la obtienes. Solo 1 por partida.", target: "hostile-takeover" },

  // --- Economia (4) ---
  { id: "smart-investment", title: "Inversion Inteligente", category: "Economia", text: "Duplica la siguiente renta de una propiedad tuya.", target: "owned-property" },
  { id: "premium-connection", title: "Conexion Premium", category: "Economia", text: "Ganas 100 creditos y 1 conexion.", target: "self", immediate: true },
  { id: "business-subsidy", title: "Subsidio Empresarial", category: "Economia", text: "Recibes 150 creditos.", target: "self", immediate: true },
  { id: "startup-boom", title: "Startup Boom", category: "Economia", text: "Tu propiedad mas barata genera el triple de renta durante 1 ronda. Ideal para jugadores rezagados.", target: "self", immediate: true },

  // --- Evento (3) ---
  { id: "economic-crisis", title: "Crisis Economica", category: "Evento", text: "Todos pierden 50 creditos.", target: "global", immediate: true },
  { id: "market-boom", title: "Boom del Mercado", category: "Evento", text: "Las rentas se duplican por 1 ronda.", target: "global", immediate: true },
  { id: "global-innovation", title: "Innovacion Global", category: "Evento", text: "Todos ganan una conexion.", target: "global", immediate: true },
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
