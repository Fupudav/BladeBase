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
const validTypes = new Set(["", "Attack", "Defense", "Stamina", "Balance", "Mixed"]);

function fail(message) {
  console.error(`Erreur: ${message}`);
  process.exit(1);
}

function requiredString(product, field) {
  return typeof product[field] === "string" && product[field].trim().length > 0;
}

function normalizeProduct(product) {
  return {
    id: String(product.id || product.code || product.name || "").trim(),
    code: String(product.code || "").trim(),
    name: String(product.name || "").trim(),
    cat: String(product.cat || "").trim(),
    wave: String(product.wave || "").trim(),
    date: String(product.date || "").trim(),
    price: String(product.price || "").trim(),
    color: String(product.color || "").trim(),
    type: String(product.type || "").trim(),
    imagePath: String(product.imagePath || "").trim(),
    note: String(product.note || "").trim()
  };
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
