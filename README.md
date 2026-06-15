# BladeBase

Application communautaire de gestion de collection Beyblade X Hasbro.

## Deploiement GitHub Pages

Publier les fichiers a la racine de la branche GitHub Pages. A chaque livraison, incrementer `version.json` et `APP_VERSION` dans `service-worker.js` avec la meme valeur.

## Firebase Authentication

La configuration Firebase peut etre fournie par `firebase-config.js`, genere par GitHub Actions ou cree localement depuis `firebase-config.example.js`. Si ce fichier est absent sur GitHub Pages, BladeBase utilise une configuration publique de secours integree afin que Firebase Authentication reste disponible.

Pour GitHub Pages, utiliser le workflow GitHub Actions fourni et configurer :

- Secret `FIREBASE_API_KEY`
- Variable `FIREBASE_AUTH_DOMAIN`
- Variable `FIREBASE_PROJECT_ID`
- Variable `FIREBASE_STORAGE_BUCKET`
- Variable `FIREBASE_MESSAGING_SENDER_ID`
- Variable `FIREBASE_APP_ID`
- Variable `FIREBASE_MEASUREMENT_ID`

Dans Firebase Console, ajouter le domaine GitHub Pages et le domaine personnalise dans Authentication > Settings > Authorized domains. Restreindre la cle web aux domaines autorises dans Google Cloud Console, puis remplacer/rotater la cle si GitHub signale une ancienne exposition.

## Synchronisation Firestore

Les produits integres restent locaux dans `index.html`. Firestore ne stocke que les donnees utilisateur, sous l'utilisateur connecte :

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

BladeBase ne charge plus de photos depuis Internet. Ajouter les images officielles dans `images/`, en priorite sous la forme `CODE.jpg`, `CODE.png` ou `CODE.webp`, par exemple `G1536.jpg`.

Le workflow GitHub Pages regenere automatiquement `images/manifest.json` a chaque deploiement. Ce manifeste permet a l'application de ne demander que les fichiers qui existent et evite les rafales de requetes 404 sur GitHub Pages. Si le site est publie sans GitHub Actions, mettre aussi a jour `images/manifest.json`.
