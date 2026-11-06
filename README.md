# DoubleDoIt — Todo Tablets

A two-column to-do list that syncs across devices.

- **DUE**: tasks with a date, grouped into Overdue / Today / Tomorrow / This Week / Later
- **GENERAL**: everything else, with sort and shuffle options
- Google sign-in, real-time sync (Firebase Auth + Firestore), works offline
- Installable on a phone home screen
- `/dashboard`: a big, live, view-only screen that stays awake

Live: https://doubledoit.web.app

## Layout

```
public/              ← the website (this is what gets deployed)
  index.html         main app
  dashboard.html     wall/dashboard screen
  scroll.html        help page
  js/firebase.js     Firebase config, auth, and data helpers
  js/tasks.js        date/grouping/sorting logic (no DOM, no Firebase)
  js/app.js          main app UI
  js/dashboard.js    dashboard UI
  sw.js              offline cache for the app shell
firestore.rules      database security rules (each user sees only their own tasks)
firebase.json        hosting + rules config
assets-src/          original full-size images
legacy-neocities/    the old localStorage-only version, for reference
```

No build step: edit files in `public/` and deploy.

## Run locally

```bash
python3 -m http.server 5050 --directory public
```

Then open http://localhost:5050 (Google sign-in works on localhost).

## Deploy

```bash
firebase deploy
```

## Data model

`users/{uid}/tasks/{taskId}`:

| field | type | notes |
|---|---|---|
| title | string | required, ≤ 300 chars |
| notes | string | |
| section | `"due"` \| `"general"` | which column |
| due | `"YYYY-MM-DD"` \| null | local date |
| dueTime | `"HH:MM"` \| null | optional |
| estMinutes | number \| null | |
| completed | bool | |
| completedAt, createdAt, updatedAt | ms timestamps | |
