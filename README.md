# BladeBase

Application communautaire de gestion de collection Beyblade X Hasbro.

## Deploiement GitHub Pages

Publier les fichiers a la racine de la branche GitHub Pages. A chaque livraison, incrementer `version.json` et `APP_VERSION` dans `service-worker.js` avec la meme valeur.

## Firebase Authentication

La configuration Firebase est fournie par `firebase-config.js`, publie avec l'application afin que Firebase Authentication, Firestore utilisateur et Firestore produits/pieces restent disponibles sur GitHub Pages meme quand le site est deploye depuis la branche racine. `firebase-config.example.js` reste disponible comme modele pour un autre projet Firebase.

Pour GitHub Pages, utiliser le workflow GitHub Actions fourni et configurer :

- Secret `FIREBASE_API_KEY`
- Variable `FIREBASE_AUTH_DOMAIN`
- Variable `FIREBASE_PROJECT_ID`
- Variable `FIREBASE_STORAGE_BUCKET`
- Variable `FIREBASE_MESSAGING_SENDER_ID`
- Variable `FIREBASE_APP_ID`
- Variable `FIREBASE_MEASUREMENT_ID`

Dans Firebase Console, ajouter le domaine GitHub Pages et le domaine personnalise dans Authentication > Settings > Authorized domains. Restreindre la cle web aux domaines autorises dans Google Cloud Console, puis remplacer/rotater la cle si GitHub signale une ancienne exposition. Ne pas integrer la cle Firebase directement dans `index.html`.

Pour la connexion Google, verifier aussi que le fournisseur Google est active dans Firebase Authentication et que ces domaines sont autorises :

- `bladebase.fr`
- `www.bladebase.fr`
- `fupudav.github.io`

Le flux Google utilise directement une redirection sur mobile/PWA installee afin d'eviter les pages blanches liees aux popups. Sur ordinateur, il tente d'abord une fenetre popup, puis bascule vers une redirection quand le navigateur bloque la popup. Les logs de diagnostic sont desactives par defaut et peuvent etre actives avec `?authDebug=1` ou `localStorage.setItem('bladebase_auth_debug','1')`.

## Produits Firestore

Les produits sont charges depuis Firestore quand la collection publique `products` contient des documents. Chaque document doit garder le meme identifiant que l'ancien produit local (`code` quand il existe, sinon le nom nettoye) afin de conserver les collections utilisateur existantes.

Structure conseillee pour `products/{productId}` :

- `id`
- `code`
- `name`
- `cat`
- `wave`
- `date`
- `price`
- `color`
- `type`
- `imagePath`
- `note`
- `parts`

Le champ `parts` garde les sous-produits detectables sans creer encore de collection Firestore separee :

```json
{
  "blades": ["Sword Dran"],
  "ratchets": ["3-60"],
  "bits": ["F"],
  "source": "auto"
}
```

Les packs peuvent contenir plusieurs valeurs dans `blades`. Quand un produit Firestore n'a pas encore `parts`, BladeBase conserve une detection locale depuis le nom du produit.

Si Firestore est vide ou indisponible, BladeBase charge immediatement `data/products-fallback.json`.

Les pieces ont aussi leur propre collection publique :

- `parts/{partId}`

Structure conseillee pour `parts/{partId}` :

- `id`
- `type` (`blade`, `ratchet`, `bit`)
- `typeLabel`
- `name`
- `imagePath`
- `productIds`
- `productCodes`
- `productNames`
- `usageCount`
- `source`

Si Firestore `parts` est vide ou indisponible, BladeBase charge `data/parts-fallback.json`.

### Importer les produits dans Firestore

Ne pas creer les 119 produits a la main dans la console Firebase. Utiliser le script local :

```powershell
npm install
npm run import:products -- --credentials "C:\Users\rlope\Documents\bladebase-service-account.json"
```

La premiere commande installe l'outil Firebase Admin. La deuxieme commande fait une simulation et n'ecrit rien.

Pour importer vraiment les documents :

```powershell
npm run import:products -- --credentials "C:\Users\rlope\Documents\bladebase-service-account.json" --apply
```

Importer les pieces dans Firestore :

```powershell
npm run import:parts -- --credentials "C:\Users\rlope\Documents\bladebase-service-account.json"
npm run import:parts -- --credentials "C:\Users\rlope\Documents\bladebase-service-account.json" --apply
```

Le fichier de cle privee Firebase ne doit jamais etre ajoute a GitHub. Les noms `*service-account*.json` et `*firebase-adminsdk*.json` sont ignores par `.gitignore`.

Les regles Firestore doivent autoriser la lecture publique de `parts`, comme pour `products` :

```js
match /parts/{partId} {
  allow read: if true;
  allow write: if false;
}
```

## Admin produits

L'onglet Admin est masque par defaut. Pour l'activer dans l'interface, remplacer dans `index.html` :

```js
const ADMIN_UIDS = ["gVIZu796bSVTNEbb0lMFJD3i8tw1"];
```

par l'UID Firebase du compte autorise. Cette protection cote interface evite les actions accidentelles, mais la vraie securite doit aussi etre appliquee dans Firestore.

Regles conseillees pour autoriser l'ecriture de `products` uniquement aux UID admin :

```js
function isAdmin() {
  return request.auth != null
         && request.auth.uid in ["gVIZu796bSVTNEbb0lMFJD3i8tw1"];
}

match /products/{productId} {
  allow read: if true;
  allow create, update, delete: if isAdmin();
}

match /parts/{partId} {
  allow read: if true;
  allow create, update, delete: if isAdmin();
}
```

Solution plus robuste a terme : utiliser des custom claims Firebase (`admin: true`) au lieu d'une liste d'UID dupliquee cote interface et cote regles.

## Synchronisation Firestore utilisateur

Les donnees utilisateur restent stockees sous l'utilisateur connecte :

- `users/{uid}/profile/main`
- `users/{uid}/data/collection`
- `users/{uid}/data/settings`
- `users/{uid}/data/customProducts`
- `users/{uid}/data/userPhotos`
- `users/{uid}/userPhotos/{productId}`
- `users/{uid}/data/meta`

L'application affiche toujours la sauvegarde locale en premier, puis compare les dates locale/cloud apres connexion. Si les deux sauvegardes different, l'utilisateur peut choisir cloud, local ou fusion. Hors ligne, les changements restent en local et sont renvoyes au cloud quand la connexion revient.

Les photos personnelles sont indexees dans `data/userPhotos` et stockees par produit dans `userPhotos/{productId}` afin d'eviter la limite d'un document Firestore unique.

## Images produits

BladeBase ne charge plus de photos depuis Internet. Pour les produits, l'ordre utilise est `imagePath` depuis Firestore, puis `images/CODE.webp`, `images/CODE.jpg`, `images/CODE.jpeg`, `images/CODE.png`, puis le placeholder. Ajouter les images officielles dans `images/`, par exemple `G1536.webp` ou `G1536.jpg`.

Pour les pieces, placer les images dans :

- `images/parts/blades/`
- `images/parts/ratchets/`
- `images/parts/bits/`

Le nom recommande est l'ID de la piece, par exemple :

- `images/parts/blades/blade-sword-dran.jpg`
- `images/parts/ratchets/ratchet-3-60.jpg`
- `images/parts/bits/bit-f.jpg`

Le workflow GitHub Pages regenere automatiquement `images/manifest.json` a chaque deploiement, y compris pour les sous-dossiers. Ce manifeste permet a l'application de ne demander que les fichiers qui existent et evite les rafales de requetes 404 sur GitHub Pages. Si le site est publie sans GitHub Actions, mettre aussi a jour `images/manifest.json`.
