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
const partsPath = args.get("file") || "data/parts-fallback.json";
const collectionName = args.get("collection") || "parts";
const partKindsByGeneration = {
  x: ["blade", "ratchet", "bit"],
  bakuten: ["attackRing", "weightDisk", "bladeBase", "bitChip", "spinGear", "supportPart", "engineGear", "runningCore", "accessory"],
  metal: ["faceBolt", "energyRing", "fusionWheel", "spinTrack", "performanceTip", "accessory"],
  burst: ["layer", "disc", "driver", "chip", "armor", "accessory"]
};
const partTypeAliases = new Map([
  ["attackring", "attackRing"], ["attackrings", "attackRing"],
  ["weightdisk", "weightDisk"], ["weightdisks", "weightDisk"],
  ["bladebase", "bladeBase"], ["bladebases", "bladeBase"],
  ["bitchip", "bitChip"], ["bitchips", "bitChip"],
  ["spingear", "spinGear"], ["spingears", "spinGear"],
  ["supportpart", "supportPart"], ["supportparts", "supportPart"],
  ["enginegear", "engineGear"], ["enginegears", "engineGear"],
  ["runningcore", "runningCore"], ["runningcores", "runningCore"],
  ["facebolt", "faceBolt"], ["facebolts", "faceBolt"],
  ["energyring", "energyRing"], ["energyrings", "energyRing"],
  ["fusionwheel", "fusionWheel"], ["fusionwheels", "fusionWheel"],
  ["spintrack", "spinTrack"], ["spintracks", "spinTrack"],
  ["performancetip", "performanceTip"], ["performancetips", "performanceTip"]
]);

function fail(message) {
  console.error(`Erreur: ${message}`);
  process.exit(1);
}

function cleanText(value, max = 500) {
  return String(value || "").replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeGeneration(value) {
  const raw = cleanText(value || "x", 60).toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = new Map([["beyblade-x", "x"], ["beyblade-burst", "burst"], ["bust", "burst"], ["metal-fight", "metal"], ["bakuten-shoot", "bakuten"]]);
  const generation = aliases.get(raw) || raw;
  return partKindsByGeneration[generation] ? generation : "x";
}

function normalizePartKind(value, generation) {
  const raw = cleanText(value, 80);
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  const alias = partTypeAliases.get(key) || raw;
  return partKindsByGeneration[generation].includes(alias) ? alias : "";
}
function cleanList(value, max = 160) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(raw.map((item) => cleanText(item, max)).filter(Boolean))];
}

function normalizePart(part) {
  const generation = normalizeGeneration(part.generation || part.gen);
  const rawType = normalizePartKind(part.type, generation);
  const type = rawType || partKindsByGeneration[generation][0];
  const productIds = cleanList(part.productIds, 180);
  return {
    id: cleanText(part.id || `${generation === "x" ? "" : `${generation}-`}${type}-${part.name}`, 180),
    generation,
    type,
    typeLabel: cleanText(part.typeLabel || type, 60),
    name: cleanText(part.name, 120),
    imagePath: cleanText(part.imagePath, 260),
    productIds,
    productCodes: cleanList(part.productCodes, 80),
    productNames: cleanList(part.productNames, 220),
    usageCount: Number.isFinite(Number(part.usageCount)) ? Number(part.usageCount) : productIds.length,
    source: cleanText(part.source || "products", 40)
  };
}async function loadJson(filePath) {
  const absolutePath = path.resolve(filePath);
  const content = await readFile(absolutePath, "utf8");
  return JSON.parse(content);
}

const rawParts = await loadJson(partsPath);
if (!Array.isArray(rawParts)) fail(`${partsPath} doit contenir un tableau JSON.`);

const parts = rawParts.map(normalizePart);
const ids = new Set();
const errors = [];

parts.forEach((part, index) => {
  if (!part.id) errors.push(`Piece #${index + 1}: id manquant.`);
  if (!part.name) errors.push(`Piece #${index + 1}: name manquant.`);
  if (!partKindsByGeneration[part.generation]?.includes(part.type)) errors.push(`${part.id || `Piece #${index + 1}`}: type invalide "${part.type}" pour ${part.generation}.`);
  if (part.id && ids.has(part.id)) errors.push(`ID duplique: ${part.id}`);
  if (part.id) ids.add(part.id);
});

if (errors.length) {
  console.error(errors.slice(0, 20).join("\n"));
  if (errors.length > 20) console.error(`... ${errors.length - 20} erreur(s) supplementaire(s).`);
  fail("validation pieces echouee.");
}

console.log(`Pieces valides: ${parts.length}`);
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
const chunkSize = 450;
let written = 0;

for (let i = 0; i < parts.length; i += chunkSize) {
  const batch = db.batch();
  const chunk = parts.slice(i, i + chunkSize);
  chunk.forEach((part) => {
    batch.set(db.collection(collectionName).doc(part.id), part);
  });
  await batch.commit();
  written += chunk.length;
  console.log(`Importees: ${written}/${parts.length}`);
}

console.log(`Import termine: ${written} piece(s) dans ${collectionName}.`);
