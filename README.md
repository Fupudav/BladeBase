# BladeBase

Application communautaire de gestion de collection Beyblade X Hasbro.

## Deploiement GitHub Pages

Publier les fichiers a la racine de la branche GitHub Pages. A chaque livraison, incrementer `version.json` et `APP_VERSION` dans `service-worker.js` avec la meme valeur.

## Firebase Authentication

La configuration Firebase reelle ne doit pas etre committee. Pour le developpement local, copier `firebase-config.example.js` vers `firebase-config.js` puis renseigner les valeurs Firebase.

Pour GitHub Pages, utiliser le workflow GitHub Actions fourni et configurer :

- Secret `FIREBASE_API_KEY`
- Variable `FIREBASE_AUTH_DOMAIN`
- Variable `FIREBASE_PROJECT_ID`
- Variable `FIREBASE_STORAGE_BUCKET`
- Variable `FIREBASE_MESSAGING_SENDER_ID`
- Variable `FIREBASE_APP_ID`
- Variable `FIREBASE_MEASUREMENT_ID`

Dans Firebase Console, ajouter le domaine GitHub Pages dans Authentication > Settings > Authorized domains.

## Synchronisation Firestore

Les produits integres restent locaux dans `index.html`. Firestore ne stocke que les donnees utilisateur, sous l'utilisateur connecte :

- `users/{uid}/profile/main`
- `users/{uid}/data/collection`
- `users/{uid}/data/settings`
- `users/{uid}/data/customProducts`
- `users/{uid}/data/userPhotos`
- `users/{uid}/data/meta`

L'application affiche toujours la sauvegarde locale en premier, puis compare les dates locale/cloud apres connexion. Si les deux sauvegardes different, l'utilisateur peut choisir cloud, local ou fusion. Hors ligne, les changements restent en local et sont renvoyes au cloud quand la connexion revient.

Les photos personnelles restent locales si leur document Firestore depasse la limite pratique d'environ 900 Ko.

## Images produits

BladeBase ne charge plus de photos depuis Internet. Ajouter les images officielles dans `images/`, en priorite sous la forme `CODE.jpg` par exemple `G1536.jpg`.
