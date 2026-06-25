import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const [key, inlineValue] = arg.slice(2).split("=");
  const nextValue = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  args.set(key, inlineValue ?? nextValue);
}

const apply = args.has("apply");
const credentialsPath = args.get("credentials") || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const productsPath = args.get("file") || "data/products-fallback.json";
const collectionName = args.get("collection") || "products";
const preferRest = args.has("prefer-rest") || process.env.FIRESTORE_PREFER_REST === "1";
const validTypes = new Set(["", "Attack", "Defense", "Stamina", "Balance", "Mixed"]);
const validGenerations = new Set(["x", "burst", "metal", "bakuten"]);
const partKindsByGeneration = {
  x: [
    { id: "blade", plural: "blades", max: 90 },
    { id: "ratchet", plural: "ratchets", max: 40 },
    { id: "bit", plural: "bits", max: 40 }
  ],
  bakuten: [
    { id: "attackRing", plural: "attackRings", max: 90 },
    { id: "weightDisk", plural: "weightDisks", max: 90 },
    { id: "bladeBase", plural: "bladeBases", max: 90 },
    { id: "bitChip", plural: "bitChips", max: 90 },
    { id: "spinGear", plural: "spinGears", max: 90 },
    { id: "supportPart", plural: "supportParts", max: 90 },
    { id: "engineGear", plural: "engineGears", max: 90 },
    { id: "runningCore", plural: "runningCores", max: 90 },
    { id: "accessory", plural: "accessories", max: 90 }
  ],
  metal: [
    { id: "faceBolt", plural: "faceBolts", max: 90 },
    { id: "energyRing", plural: "energyRings", max: 90 },
    { id: "fusionWheel", plural: "fusionWheels", max: 90 },
    { id: "spinTrack", plural: "spinTracks", max: 90 },
    { id: "performanceTip", plural: "performanceTips", max: 90 },
    { id: "accessory", plural: "accessories", max: 90 }
  ],
  burst: [
    { id: "layer", plural: "layers", max: 90 },
    { id: "disc", plural: "discs", max: 90 },
    { id: "driver", plural: "drivers", max: 90 },
    { id: "chip", plural: "chips", max: 90 },
    { id: "armor", plural: "armors", max: 90 },
    { id: "accessory", plural: "accessories", max: 90 }
  ]
};

function fail(message) {
  console.error(`Erreur: ${message}`);
  process.exit(1);
}

function requiredString(product, field) {
  return typeof product[field] === "string" && product[field].trim().length > 0;
}

function plainText(value, max = 500) {
  return String(value || "").replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizePartList(value, max = 90) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(raw.map((item) => plainText(item, max)).filter(Boolean))];
}

function makeProductParts(blades = [], ratchets = [], bits = [], source = "manual") {
  return {
    blades: normalizePartList(blades),
    ratchets: normalizePartList(ratchets, 40),
    bits: normalizePartList(bits, 40),
    source: plainText(source || "manual", 30)
  };
}

function partFieldValue(parts, definition) {
  return parts?.[definition.plural] ?? parts?.[definition.id] ?? parts?.[definition.id.toLowerCase()] ?? [];
}

function inferProductPartsFromName(name = "") {
  const base = plainText(name, 220)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+(Starter|Booster|Dual|Multipack|Battle|Deluxe|String|Launcher|Custom|Grip|Left-Spin|Set|Pack).*$/i, "")
    .trim();
  const combo = base.match(/^(.+?)\s+(\d+-\d+)\s*([A-Z]{1,3})$/);
  if (combo) return makeProductParts([combo[1]], [combo[2]], [combo[3]], "auto");
  if (/\s+and\s+/i.test(base)) return makeProductParts(base.split(/\s+and\s+/i), [], [], "auto");
  if (base && !/Beystadium|Launcher|Grip|Battle|Pack|Set|Beyblade|X-treme|Yggdrasil Team|Winder|Victory|Clip & Rip|Drop Attack|Sneak Attack|Xtreme/i.test(base)) {
    return makeProductParts([base], [], [], "auto");
  }
  return makeProductParts([], [], [], "auto");
}

function normalizeGeneration(value) {
  const raw = String(value || "x").trim().toLowerCase();
  if (raw === "beyblade-x") return "x";
  if (raw === "beyblade-burst" || raw === "bust") return "burst";
  if (raw === "metal-fight") return "metal";
  if (raw === "bakuten-shoot") return "bakuten";
  return raw || "x";
}

function normalizeProductParts(parts = {}, name = "", generation = "x") {
  const gen = normalizeGeneration(generation);
  const definitions = partKindsByGeneration[gen] || partKindsByGeneration.x;
  const normalized = { source: plainText(parts?.source || "manual", 30) };
  definitions.forEach((definition) => {
    normalized[definition.plural] = normalizePartList(partFieldValue(parts, definition), definition.max);
  });
  if (gen === "x") {
    normalized.blades = normalizePartList(parts?.blades ?? parts?.blade ?? normalized.blades);
    normalized.ratchets = normalizePartList(parts?.ratchets ?? parts?.ratchet ?? normalized.ratchets, 40);
    normalized.bits = normalizePartList(parts?.bits ?? parts?.bit ?? normalized.bits, 40);
    if (!normalized.blades.length && !normalized.ratchets.length && !normalized.bits.length && name && normalized.source !== "catalog") {
      return inferProductPartsFromName(name);
    }
  }
  return normalized;
}

function normalizeProduct(product) {
  const rawOrder = product.displayOrder ?? product.order;
  const displayOrder = rawOrder === "" || rawOrder === undefined ? NaN : Number(rawOrder);
  const generation = normalizeGeneration(product.generation || product.gen || product.series);
  const normalized = {
    id: String(product.id || product.code || product.name || "").trim(),
    generation,
    code: String(product.code || "").trim(),
    name: String(product.name || "").trim(),
    cat: String(product.cat || "").trim(),
    wave: String(product.wave || "").trim(),
    line: String(product.line || "").trim(),
    date: String(product.date || "").trim(),
    price: String(product.price || "").trim(),
    color: String(product.color || "").trim(),
    type: String(product.type || "").trim(),
    imagePath: String(product.imagePath || "").trim(),
    buyUrl: String(product.buyUrl || product.affiliateUrl || product.purchaseUrl || "").trim(),
    note: String(product.note || "").trim(),
    active: product.active === false ? false : true,
    parts: normalizeProductParts(product.parts, product.name, generation)
  };
  if (Number.isFinite(displayOrder)) normalized.displayOrder = displayOrder;
  return normalized;
}

async function loadJson(filePath) {
  const absolutePath = path.resolve(filePath);
  const content = await readFile(absolutePath, "utf8");
  return JSON.parse(content);
}

const rawProducts = await loadJson(productsPath);
if (!Array.isArray(rawProducts)) fail(`${productsPath} doit contenir un tableau JSON.`);

const products = rawProducts.map(normalizeProduct);
const ids = new Set();
const errors = [];

products.forEach((product, index) => {
  if (!requiredString(product, "id")) errors.push(`Produit #${index + 1}: id manquant.`);
  if (!requiredString(product, "name")) errors.push(`Produit #${index + 1}: name manquant.`);
  if (product.id && ids.has(product.id)) errors.push(`ID duplique: ${product.id}`);
  if (product.id) ids.add(product.id);
  if (!validTypes.has(product.type)) errors.push(`${product.id || `Produit #${index + 1}`}: type invalide "${product.type}".`);
  if (!validGenerations.has(product.generation)) errors.push(`${product.id || `Produit #${index + 1}`}: generation invalide "${product.generation}".`);
  const definitions = partKindsByGeneration[product.generation] || [];
  if (!product.parts || definitions.some((definition) => !Array.isArray(product.parts[definition.plural]))) {
    errors.push(`${product.id || `Produit #${index + 1}`}: parts invalide pour ${product.generation}.`);
  }
});

if (errors.length) {
  console.error(errors.slice(0, 20).join("\n"));
  if (errors.length > 20) console.error(`... ${errors.length - 20} erreur(s) supplementaire(s).`);
  fail("validation produits echouee.");
}

console.log(`Produits valides: ${products.length}`);
console.log(`Collection cible: ${collectionName}`);

if (!apply) {
  console.log("Mode simulation: aucun document n'a ete ecrit.");
  console.log("Ajoute --apply pour importer dans Firestore.");
  process.exit(0);
}

if (!credentialsPath) {
  fail("renseigne --credentials chemin\\vers\\service-account.json ou GOOGLE_APPLICATION_CREDENTIALS.");
}

const serviceAccount = await loadJson(credentialsPath);
initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
if (preferRest) db.settings({ preferRest: true });
const chunkSize = 450;
let written = 0;

for (let i = 0; i < products.length; i += chunkSize) {
  const batch = db.batch();
  const chunk = products.slice(i, i + chunkSize);
  chunk.forEach((product) => {
    batch.set(db.collection(collectionName).doc(product.id), product);
  });
  await batch.commit();
  written += chunk.length;
  console.log(`Importes: ${written}/${products.length}`);
}

console.log(`Import termine: ${written} produit(s) dans ${collectionName}.`);
