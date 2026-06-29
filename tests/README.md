# BladeBase tests

BladeBase uses a small smoke test suite to catch breaking changes before a pull request is merged.

Run every test:

```bash
npm run test
```

Run the smoke suite explicitly:

```bash
npm run test:smoke
```

The current suite is intentionally fast and read-only. It checks critical files, main views, PWA assets, Firebase wiring, Firestore fallback wiring and JavaScript syntax. It does not connect to Firebase Auth, does not read or write Firestore data, and does not modify local user storage.
